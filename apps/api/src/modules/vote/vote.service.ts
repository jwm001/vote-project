import { prisma } from "../../utils/prisma";
import PDFDocument from "pdfkit";

function generatePseudonym() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `user_${timestamp}_${random}`;
}

export class VoteService {
  async createVote(data: {
    creatorId: string;
    title: string;
    description?: string;
    allowMultiple: boolean;
    startAt: Date;
    endAt: Date;
    options: string[];
  }) {
    const vote = await prisma.vote.create({
      data: {
        title: data.title,
        description: data.description,
        creatorId: data.creatorId,
        allowMultiple: data.allowMultiple,
        startAt: data.startAt,
        endAt: data.endAt,
        options: {
          create: data.options.map((text, index) => ({
            text,
            order: index,
          })),
        },
      },
      include: {
        options: true,
      },
    });
    return vote;
  }

  async getVotes() {
    const votes = await prisma.vote.findMany({
      include: {
        options: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return votes;
  }

  async getVoteById(id: string) {
    const vote = await prisma.vote.findUnique({
      where: { id },
      include: {
        options: true,
      },
    });
    return vote;
  }

  async submitVote(data: { userId: string; voteId: string; optionIds: string[] }) {
    const vote = await prisma.vote.findUnique({
      where: { id: data.voteId },
      include: { options: true },
    });

    if (!vote) {
      throw new Error("Vote not found");
    }

    // Check if user has already voted
    const existingHistory = await prisma.userVoteHistory.findUnique({
      where: {
        userId_voteId: {
          userId: data.userId,
          voteId: data.voteId,
        },
      },
    });

    if (existingHistory) {
      throw new Error("Already voted");
    }

    // Get the next sequence number for this vote
    const lastBallot = await prisma.ballot.findFirst({
      where: { voteId: data.voteId },
      orderBy: { sequenceNumber: "desc" },
    });
    const sequenceNumber = lastBallot ? lastBallot.sequenceNumber + 1 : 1;

    const pseudonym = generatePseudonym();

    // Create ballot and user vote history in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const ballot = await tx.ballot.create({
        data: {
          voteId: data.voteId,
          pseudonym,
          optionIds: JSON.stringify(data.optionIds),
          sequenceNumber,
        },
      });

      await tx.userVoteHistory.create({
        data: {
          userId: data.userId,
          voteId: data.voteId,
        },
      });

      return ballot;
    });

    return result;
  }

  async generateAuditPdf(voteId: string) {
    const vote = await prisma.vote.findUnique({
      where: { id: voteId },
      include: {
        options: true,
      },
    });

    if (!vote) {
      throw new Error("Vote not found");
    }

    const ballots = await prisma.ballot.findMany({
      where: { voteId },
      orderBy: { sequenceNumber: "asc" },
    });

    const optionMap = new Map(vote.options.map((opt) => [opt.id, opt.text]));

    const doc = new PDFDocument({ margin: 50 });
    const buffers: Buffer[] = [];

    doc.on("data", (chunk) => buffers.push(chunk));

    return new Promise<Buffer>((resolve) => {
      doc.on("end", () => {
        resolve(Buffer.concat(buffers));
      });

      doc.fontSize(20).text("投票全量记录（Audit Log）", { align: "center" });
      doc.moveDown();

      doc.fontSize(12).text(`投票场名称：${vote.title}`);
      doc.text(`创建者：${vote.creatorId}`);
      doc.text(`开始时间：${vote.startAt.toISOString()}`);
      doc.text(`结束时间：${vote.endAt.toISOString()}`);
      doc.moveDown();

      doc.text("选项列表：");
      for (const opt of vote.options.sort((a, b) => a.order - b.order)) {
        doc.text(`  ${opt.order + 1}. ${opt.text}`);
      }
      doc.moveDown();

      doc.text("投票记录（按提交序号排序）：");
      doc.moveDown();

      for (const ballot of ballots) {
        let optionIds: string[] = [];
        try {
          optionIds = JSON.parse(ballot.optionIds);
        } catch {
          optionIds = [];
        }
        const optionTexts = optionIds
          .map((id) => optionMap.get(id))
          .filter((t): t is string => Boolean(t))
          .join(", ");

        doc.fontSize(10).text(`序号：${ballot.sequenceNumber}`);
        doc.text(`假名：${ballot.pseudonym}`);
        doc.text(`投票时间：${ballot.submittedAt.toISOString()}`);
        doc.text(`选项：${optionTexts || "-"}`);
        doc.moveDown();
      }

      doc.end();
    });
  }

  async hasUserVoted(userId: string, voteId: string): Promise<boolean> {
    const history = await prisma.userVoteHistory.findUnique({
      where: { userId_voteId: { userId, voteId } },
    });
    return !!history;
  }

  async getUserVoteHistory(userId: string, voteId: string) {
    const history = await prisma.userVoteHistory.findUnique({
      where: { userId_voteId: { userId, voteId } },
    });
    if (!history) return null;
    // 找到对应的 ballot
    const ballot = await prisma.ballot.findFirst({
      where: { voteId, sequenceNumber: history.ballotSequenceNumber },
    });
    return {
      voteId,
      pseudonym: ballot?.pseudonym,
      submittedAt: ballot?.submittedAt,
      sequenceNumber: history.ballotSequenceNumber,
    };
  }

  async getMyVotes(userId: string) {
    const histories = await prisma.userVoteHistory.findMany({
      where: { userId },
      orderBy: { votedAt: 'desc' },
      include: {
        vote: {
          select: {
            id: true,
            title: true,
            allowMultiple: true,
            startAt: true,
            endAt: true,
          },
        },
      },
    });

    if (histories.length === 0) return [];

    // 一次取出这些投票的全部 ballot，按 (voteId, sequenceNumber) 对应，避免逐条查询
    const ballots = await prisma.ballot.findMany({
      where: { voteId: { in: histories.map((h) => h.voteId) } },
      select: {
        voteId: true,
        sequenceNumber: true,
        pseudonym: true,
        submittedAt: true,
      },
    });
    const ballotMap = new Map(
      ballots.map((b) => [`${b.voteId}:${b.sequenceNumber}`, b])
    );

    return histories.map((h) => {
      const ballot = ballotMap.get(`${h.voteId}:${h.ballotSequenceNumber}`);
      return {
        voteId: h.voteId,
        voteTitle: h.vote.title,
        allowMultiple: h.vote.allowMultiple,
        startAt: h.vote.startAt,
        endAt: h.vote.endAt,
        pseudonym: ballot?.pseudonym ?? null,
        submittedAt: ballot?.submittedAt ?? h.votedAt,
        sequenceNumber: h.ballotSequenceNumber,
      };
    });
  }
}
