import crypto from "crypto";
import fs from "fs";
import path from "path";
import fontkit from "@pdf-lib/fontkit";
import { prisma } from "../../utils/prisma";
import { AppError } from "../../utils/errors";
import { PDFDocument, PDFFont, PDFPage } from "pdf-lib";
import { getVotePhase } from "../vote/vote.phase";

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
  redacted: boolean;
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

// 只清掉 PDF 无法绘制的控制字符，其余（中文、全角标点）原样保留。
const sanitize = (text: string) =>
  String(text).replace(/[\u0000-\u001f\u007f]/g, " ");

type PdfFonts = { regular: Buffer; bold: Buffer };

let fontCache: Promise<PdfFonts> | undefined;

/**
 * 字体文件放在 apps/api/assets/fonts（tsc 不会把它复制进 dist），
 * 所以从当前文件向上找包含该目录的包根目录，dev 与 dist 都能解析。
 */
function resolveFontPath(file: string): string {
  let dir = __dirname;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, "assets", "fonts", file);
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error(`PDF 字体缺失：assets/fonts/${file}`);
}

function loadFonts(): Promise<PdfFonts> {
  if (!fontCache) {
    fontCache = Promise.all([
      fs.promises.readFile(resolveFontPath("NotoSansSC-Regular.otf")),
      fs.promises.readFile(resolveFontPath("NotoSansSC-Bold.otf")),
    ]).then(([regular, bold]) => ({ regular, bold }));
    fontCache.catch(() => {
      fontCache = undefined;
    });
  }
  return fontCache;
}

const WORD_CHAR = /[A-Za-z0-9_\-.,:/@%#=+()\[\]<>"']/;
const NO_LINE_START = new Set([
  "。", "，", "、", "；", "：", "）", "】", "」", "』", "！", "？", "…",
  ",", ".", ")", "]", "}", ";", "%",
]);
const NO_LINE_END = new Set(["（", "【", "「", "『", "《", "(", "[", "{"]);

/** 中文逐字、英文/数字/ID 按词切分，避免把一串英文从中间断开。 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let word = "";
  for (const char of text) {
    if (WORD_CHAR.test(char)) {
      word += char;
      continue;
    }
    if (word) {
      tokens.push(word);
      word = "";
    }
    tokens.push(char);
  }
  if (word) tokens.push(word);
  return tokens;
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  const limit = Math.max(maxWidth, 40);
  const fits = (candidate: string) =>
    font.widthOfTextAtSize(candidate, size) <= limit;

  for (const paragraph of String(text).split("\n")) {
    const tokens = tokenize(sanitize(paragraph));
    let line = "";
    const pushLine = () => {
      lines.push(line.replace(/\s+$/, ""));
      line = "";
    };

    for (const token of tokens) {
      if (!line && token === " ") continue;
      const candidate = line + token;

      if (fits(candidate)) {
        line = candidate;
        continue;
      }

      // 单个 token 本身就超宽（很长的英文串）：逐字符硬切
      if (!line) {
        let buffer = "";
        for (const char of token) {
          if (buffer && !fits(buffer + char)) {
            lines.push(buffer);
            buffer = "";
          }
          buffer += char;
        }
        line = buffer;
        continue;
      }

      // 标点不放行首：允许轻微溢出，比出现孤零零的「，」好看
      if (NO_LINE_START.has(token)) {
        line = candidate;
        continue;
      }

      // 左括号不放行尾：把括号挪到下一行开头
      if (NO_LINE_END.has(line.slice(-1))) {
        const tail = line.slice(-1);
        line = line.slice(0, -1);
        pushLine();
        line = tail + token;
        continue;
      }

      pushLine();
      line = token === " " ? "" : token;
    }

    if (line.trim()) lines.push(line.replace(/\s+$/, ""));
  }

  return lines.length > 0 ? lines : [""];
}

type AuditVoteSource = {
  creatorId: string;
  participationMode: string;
  startedAt: Date | null;
  closedAt: Date | null;
  endAt: Date;
};

/**
 * 投票进行中，普通参与者拿到的 PDF 不展示选项和票数：
 * 否则全量记录本身就成了一份实时结果，绕过「进行中只看人数」的可见性规则。
 */
export function shouldRedactOptions(
  vote: AuditVoteSource,
  requester: Pick<AuditRequester, "id" | "role">
): boolean {
  const phase = getVotePhase(vote);
  return (
    phase === "LIVE" &&
    requester.role !== "ADMIN" &&
    requester.id !== vote.creatorId
  );
}

export const auditService = {
  async assertCanAccess(voteId: string, requester: AuditRequester) {
    const vote = await prisma.vote.findUnique({
      where: { id: voteId },
      select: {
        id: true,
        creatorId: true,
        participationMode: true,
        startedAt: true,
        closedAt: true,
        endAt: true,
      },
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

    const phase = getVotePhase(vote);

    if (vote.participationMode === "INVITE_ONLY") {
      const invite = await prisma.voteInvite.findFirst({
        where: {
          voteId,
          inviteeUserId: requester.id,
          status: "ACCEPTED",
        },
        select: { id: true },
      });
      if (invite && (phase === "ENDED" || phase === "LIVE")) return;
      if (!invite) {
        throw new AppError("仅本场受邀者可以下载全量记录", 403);
      }
      throw new AppError("投票尚未开始，不能下载全量记录", 403);
    }

    // 模式 A：投票结束后，任何已通过实名审核的用户都可以查看全量记录。
    if (phase === "ENDED") {
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
    const phase = getVotePhase(vote);
    const redacted = shouldRedactOptions(vote, requester);

    // 摘要只在投票结束后固定：进行中的投票记录本来就会持续增长，
    // 此时封存摘要会在每次新增投票时产生「被篡改」的误报。
    let recordedDigest = vote.auditHash;
    let recordedAt = vote.auditRecordedAt;
    let integrity: Integrity;

    if (!recordedDigest) {
      if (phase !== "ENDED") {
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
      redacted,
    });

    return { pdf, digest, recordedDigest, integrity, redacted };
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
  redacted: boolean;
}): Promise<Buffer> {
  const { vote, ballots, digest, recordedDigest, recordedAt, integrity, redacted } =
    input;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fonts = await loadFonts();
  const font: PDFFont = await pdfDoc.embedFont(fonts.regular, { subset: true });
  const bold: PDFFont = await pdfDoc.embedFont(fonts.bold, { subset: true });

  let page: PDFPage = pdfDoc.addPage();
  const pageWidth = page.getSize().width;
  let y = page.getSize().height - PAGE_MARGIN;

  const newPage = () => {
    page = pdfDoc.addPage();
    y = page.getSize().height - PAGE_MARGIN;
  };

  const write = (
    text: string,
    options: {
      size?: number;
      bold?: boolean;
      gap?: number;
      x?: number;
      indent?: number;
    } = {}
  ) => {
    const size = options.size ?? 10;
    const gap = options.gap ?? size + 5;
    const x = options.x ?? PAGE_MARGIN;
    const indent = options.indent ?? 0;
    const activeFont = options.bold ? bold : font;
    const lines = wrapText(
      text,
      activeFont,
      size,
      pageWidth - x - indent - PAGE_MARGIN
    );

    lines.forEach((line, index) => {
      if (y - size < BOTTOM_MARGIN) newPage();
      page.drawText(line, {
        x: index === 0 ? x : x + indent,
        y,
        size,
        font: activeFont,
      });
      y -= gap;
    });
  };

  write(`投票审计记录`, { size: 18, bold: true, gap: 26 });
  write(`投票主题：${vote.title}`, { size: 12, bold: true });
  write(`投票 ID：${vote.id}`);
  write(`创建者 ID：${vote.creatorId}`);
  write(`开始时间（UTC）：${vote.startAt.toISOString()}`);
  write(`结束时间（UTC）：${vote.endAt.toISOString()}`);
  write(`投票方式：${vote.allowMultiple ? "多选" : "单选"}`);
  y -= 6;

  if (redacted) {
    write(`选项：投票结束前不展示`, { size: 12, bold: true, gap: 18 });
  } else {
    write(`选项`, { size: 12, bold: true, gap: 18 });
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

    write(`统计汇总`, { size: 12, bold: true, gap: 18 });
    write(`总票数：${ballots.length}`);
    for (const option of [...vote.options].sort((a, b) => a.order - b.order)) {
      write(`  ${option.text}：${optionCounts.get(option.id) ?? 0}`);
    }
    y -= 6;
  }

  write(`完整性校验`, { size: 12, bold: true, gap: 18 });
  const integrityLabel: Record<Integrity, string> = {
    live: "进行中：投票尚未结束，暂无封存摘要",
    sealed: "已封存：本次导出写入封存摘要",
    match: "一致：记录与封存摘要相符",
    mismatch: "不一致：记录已与封存摘要不符",
  };
  write(`状态：${integrityLabel[integrity]}`, {
    size: 10,
    bold: integrity === "mismatch",
  });
  write(`内容摘要（SHA-256）：`);
  for (const chunk of chunkText(digest, 64)) {
    write(`  ${chunk}`, { x: PAGE_MARGIN + 10 });
  }
  if (recordedDigest && recordedDigest !== digest) {
    write(`封存摘要（SHA-256）：`);
    for (const chunk of chunkText(recordedDigest, 64)) {
      write(`  ${chunk}`, { x: PAGE_MARGIN + 10 });
    }
  }
  if (recordedAt) {
    write(`封存时间（UTC）：${recordedAt.toISOString()}`);
  } else {
    write(`封存时间（UTC）：尚未封存`);
  }
  y -= 6;

  write(`投票记录（按序号排列）`, { size: 12, bold: true, gap: 18 });
  write(`序号 | 匿名标识 | 提交时间（UTC） | 所选选项`, {
    size: 9,
    bold: true,
    gap: 14,
  });

  const optionText = new Map(vote.options.map((option) => [option.id, option.text]));

  for (const ballot of ballots) {
    const labels = redacted
      ? "（已隐藏）"
      : parseOptionIds(ballot.optionIds)
          .map((id) => optionText.get(id) ?? id)
          .join("，");
    const line = `${ballot.sequenceNumber} | ${ballot.pseudonym} | ${ballot.submittedAt.toISOString()} | ${labels || "-"}`;
    write(line, { size: 8, gap: 12, indent: 10 });
  }

  if (ballots.length === 0) {
    write(`暂无投票记录。`, { size: 9 });
  }

  // 页脚：页码 + 摘要前缀，方便核对打印件
  const pages = pdfDoc.getPages();
  pages.forEach((current, index) => {
    current.drawText(
      `第 ${index + 1} / ${pages.length} 页  |  摘要 ${digest.slice(0, 16)}...`,
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
