import crypto from "crypto";
import { prisma } from "../../utils/prisma";
import { AppError } from "../../utils/errors";
import { PDFDocument, PDFFont, PDFPage, StandardFonts } from "pdf-lib";

type AuditRequester = {
  id: string;
  role?: string;
  status?: string;
};

type Integrity = "live" | "sealed" | "match" | "mismatch";

export interface AuditPdfResult {
  pdf: Buffer;
  digest: string;
  recordedDigest: string | null;
  integrity: Integrity;
}

const PAGE_MARGIN = 50;
const BOTTOM_MARGIN = 56;

function parseOptionIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * 摘要只覆盖「记录内容」本身：投票元信息 + 按序号排序的全部 ballot。
 * 字段顺序固定、时间统一 ISO，保证同一份数据每次算出的值一致。
 */
function canonicalPayload(
  vote: {
    id: string;
    title: string;
    description: string | null;
    creatorId: string;
    allowMultiple: boolean;
    startAt: Date;
    endAt: Date;
    options: { id: string; text: string; order: number }[];
  },
  ballots: {
    sequenceNumber: number;
    pseudonym: string;
    optionIds: unknown;
    submittedAt: Date;
  }[]
): string {
  return JSON.stringify({
    version: 1,
    vote: {
      id: vote.id,
      title: vote.title,
      description: vote.description ?? null,
      creatorId: vote.creatorId,
      allowMultiple: vote.allowMultiple,
      startAt: vote.startAt.toISOString(),
      endAt: vote.endAt.toISOString(),
      options: [...vote.options]
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
        .map((option) => ({
          id: option.id,
          text: option.text,
          order: option.order,
        })),
    },
    ballots: [...ballots]
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
      .map((ballot) => ({
        sequenceNumber: ballot.sequenceNumber,
        pseudonym: ballot.pseudonym,
        optionIds: parseOptionIds(ballot.optionIds),
        submittedAt: ballot.submittedAt.toISOString(),
      })),
  });
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

const clean = (text: string) => String(text).replace(/[^\x20-\x7E]/g, "?");

export const auditService = {
  async assertCanAccess(voteId: string, requester: AuditRequester) {
    const vote = await prisma.vote.findUnique({
      where: { id: voteId },
      select: { id: true, creatorId: true, endAt: true },
    });
    if (!vote) {
      throw new AppError("Vote not found", 404);
    }
    if (requester.role === "ADMIN") return;
    if (vote.creatorId === requester.id) return;

    const participated = await prisma.userVoteHistory.findUnique({
      where: { userId_voteId: { userId: requester.id, voteId } },
      select: { userId: true },
    });
    if (participated) return;

    // 其他人：投票结束后才允许查看全量记录，且必须是已通过实名审核的用户
    if (new Date() >= vote.endAt) {
      if (requester.status === "APPROVED") return;
      throw new AppError("需要实名审核通过后才能下载全量记录", 403);
    }

    throw new AppError(
      "投票结束前，仅创建者与参与过本场投票的用户可以下载全量记录",
      403
    );
  },

  async generateAuditPdf(
    voteId: string,
    requester: AuditRequester
  ): Promise<AuditPdfResult> {
    await this.assertCanAccess(voteId, requester);

    const vote = await prisma.vote.findUnique({
      where: { id: voteId },
      include: { options: true, ballots: true },
    });

    if (!vote) {
      throw new AppError("Vote not found", 404);
    }

    const ballots = [...vote.ballots].sort(
      (a, b) => a.sequenceNumber - b.sequenceNumber
    );
    const digest = sha256(canonicalPayload(vote, ballots));

    // 摘要只在投票结束后固定：进行中的投票记录本来就会持续增长，
    // 此时封存摘要会在每次新增投票时产生「被篡改」的误报。
    let recordedDigest = vote.auditHash;
    let recordedAt = vote.auditRecordedAt;
    let integrity: Integrity;

    if (!recordedDigest) {
      if (new Date() < vote.endAt) {
        integrity = "live";
      } else {
        recordedDigest = digest;
        recordedAt = new Date();
        // 并发首次导出时只让第一个写入生效
        await prisma.vote.updateMany({
          where: { id: vote.id, auditHash: null },
          data: { auditHash: digest, auditRecordedAt: recordedAt },
        });
        const sealed = await prisma.vote.findUnique({
          where: { id: vote.id },
          select: { auditHash: true, auditRecordedAt: true },
        });
        recordedDigest = sealed?.auditHash ?? digest;
        recordedAt = sealed?.auditRecordedAt ?? recordedAt;
        integrity = recordedDigest === digest ? "sealed" : "mismatch";
      }
    } else {
      integrity = recordedDigest === digest ? "match" : "mismatch";
    }

    const pdf = await renderPdf({
      vote,
      ballots,
      digest,
      recordedDigest,
      recordedAt,
      integrity,
    });

    return { pdf, digest, recordedDigest, integrity };
  },
};

async function renderPdf(input: {
  vote: {
    id: string;
    title: string;
    description: string | null;
    creatorId: string;
    allowMultiple: boolean;
    startAt: Date;
    endAt: Date;
    options: { id: string; text: string; order: number }[];
  };
  ballots: {
    sequenceNumber: number;
    pseudonym: string;
    optionIds: unknown;
    submittedAt: Date;
  }[];
  digest: string;
  recordedDigest: string | null;
  recordedAt: Date | null;
  integrity: Integrity;
}): Promise<Buffer> {
  const { vote, ballots, digest, recordedDigest, recordedAt, integrity } = input;

  const pdfDoc = await PDFDocument.create();
  const font: PDFFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold: PDFFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdfDoc.addPage();
  let y = page.getSize().height - PAGE_MARGIN;

  const newPage = () => {
    page = pdfDoc.addPage();
    y = page.getSize().height - PAGE_MARGIN;
  };

  const write = (
    text: string,
    options: { size?: number; bold?: boolean; gap?: number; x?: number } = {}
  ) => {
    const size = options.size ?? 10;
    const gap = options.gap ?? size + 4;
    if (y - gap < BOTTOM_MARGIN) newPage();
    page.drawText(clean(text), {
      x: options.x ?? PAGE_MARGIN,
      y,
      size,
      font: options.bold ? bold : font,
    });
    y -= gap;
  };

  write(`Vote Audit Export`, { size: 18, bold: true, gap: 24 });
  write(`Vote: ${vote.title}`, { size: 12, bold: true });
  write(`Vote ID: ${vote.id}`);
  write(`Creator ID: ${vote.creatorId}`);
  write(`Start (UTC): ${vote.startAt.toISOString()}`);
  write(`End (UTC): ${vote.endAt.toISOString()}`);
  write(`Mode: ${vote.allowMultiple ? "Multiple choice" : "Single choice"}`);
  y -= 6;

  write(`Options`, { size: 12, bold: true, gap: 16 });
  for (const option of [...vote.options].sort((a, b) => a.order - b.order)) {
    write(`  ${option.order + 1}. ${option.text}`);
  }
  y -= 6;

  const optionCounts = new Map<string, number>();
  for (const option of vote.options) optionCounts.set(option.id, 0);
  for (const ballot of ballots) {
    for (const id of parseOptionIds(ballot.optionIds)) {
      if (optionCounts.has(id)) {
        optionCounts.set(id, (optionCounts.get(id) ?? 0) + 1);
      }
    }
  }

  write(`Summary`, { size: 12, bold: true, gap: 16 });
  write(`Total ballots: ${ballots.length}`);
  for (const option of [...vote.options].sort((a, b) => a.order - b.order)) {
    write(`  ${option.text}: ${optionCounts.get(option.id) ?? 0}`);
  }
  y -= 6;

  write(`Integrity`, { size: 12, bold: true, gap: 16 });
  const integrityLabel: Record<Integrity, string> = {
    live: "LIVE - vote still running, no sealed digest yet",
    sealed: "SEALED - digest recorded on this export",
    match: "MATCH - records unchanged since the sealed digest",
    mismatch: "MISMATCH - records changed since the sealed digest",
  };
  write(`Status: ${integrityLabel[integrity]}`, {
    size: 10,
    bold: integrity === "mismatch",
  });
  write(`Content digest (SHA-256):`);
  for (const chunk of chunkText(digest, 64)) {
    write(`  ${chunk}`, { x: PAGE_MARGIN + 10 });
  }
  if (recordedDigest && recordedDigest !== digest) {
    write(`Sealed digest (SHA-256):`);
    for (const chunk of chunkText(recordedDigest, 64)) {
      write(`  ${chunk}`, { x: PAGE_MARGIN + 10 });
    }
  }
  if (recordedAt) {
    write(`Sealed at (UTC): ${recordedAt.toISOString()}`);
  } else {
    write(`Sealed at (UTC): not sealed yet`);
  }
  y -= 6;

  write(`Records (ordered by sequence number)`, { size: 12, bold: true, gap: 16 });
  write(`Seq | Pseudonym | Submitted at (UTC) | Options`, { size: 9, bold: true, gap: 14 });

  const optionText = new Map(vote.options.map((option) => [option.id, option.text]));

  for (const ballot of ballots) {
    const labels = parseOptionIds(ballot.optionIds)
      .map((id) => optionText.get(id) ?? id)
      .join(", ");
    const line = `${ballot.sequenceNumber} | ${ballot.pseudonym} | ${ballot.submittedAt.toISOString()} | ${labels || "-"}`;
    write(line.substring(0, 110), { size: 8, gap: 12 });
  }

  if (ballots.length === 0) {
    write(`No ballots recorded.`, { size: 9 });
  }

  // 页脚：页码 + 摘要前缀，方便核对打印件
  const pages = pdfDoc.getPages();
  pages.forEach((current, index) => {
    current.drawText(
      clean(
        `Page ${index + 1} / ${pages.length}  |  digest ${digest.slice(0, 16)}...`
      ),
      { x: PAGE_MARGIN, y: 30, size: 8, font }
    );
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}
