import { prisma } from "../../utils/prisma";
import { AppError } from "../../utils/errors";

function generatePseudonym() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `user_${timestamp}_${random}`;
}

const MAX_SEQUENCE_RETRIES = 5;
const MAX_OPTION_LENGTH = 300;
const MAX_OPTIONS = 50;

function isUniqueConstraintError(error: any): boolean {
  return error?.code === "P2002";
}

function uniqueTarget(error: any): string {
  const target = error?.meta?.target;
  if (Array.isArray(target)) return target.join(",");
  return String(target ?? "");
}

function isSequenceConflict(error: any): boolean {
  if (!isUniqueConstraintError(error)) return false;
  const target = uniqueTarget(error);
  return target.includes("sequenceNumber") || target.includes("sequence");
}

function isDuplicateVote(error: any): boolean {
  if (!isUniqueConstraintError(error)) return false;
  const target = uniqueTarget(error);
  return (
    target.includes("UserVoteHistory") ||
    target.includes("userId") ||
    target.includes("voteId")
  );
}

function isTransientWriteConflict(error: any): boolean {
  return (
    error?.code === "P2034" ||
    /database is locked|SQLITE_BUSY/i.test(String(error?.message ?? ""))
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const title = (data.title || "").trim();
    if (!title) {
      throw new AppError("请填写投票标题", 400);
    }

    if (Number.isNaN(data.startAt.getTime()) || Number.isNaN(data.endAt.getTime())) {
      throw new AppError("投票时间格式不正确", 400);
    }
    if (data.endAt.getTime() <= data.startAt.getTime()) {
      throw new AppError("结束时间必须晚于开始时间", 400);
    }

    if (!Array.isArray(data.options)) {
      throw new AppError("请至少提供一个选项", 400);
    }
    const options = data.options.map((text) => String(text ?? "").trim());
    if (options.length === 0) {
      throw new AppError("请至少提供一个选项", 400);
    }
    if (options.length > MAX_OPTIONS) {
      throw new AppError(`选项不能超过 ${MAX_OPTIONS} 个`, 400);
    }
    if (options.some((text) => !text)) {
      throw new AppError("选项内容不能为空", 400);
    }
    if (options.some((text) => text.length > MAX_OPTION_LENGTH)) {
      throw new AppError(`单个选项不能超过 ${MAX_OPTION_LENGTH} 个字符`, 400);
    }
    if (new Set(options).size !== options.length) {
      throw new AppError("选项内容不能重复", 400);
    }

    const vote = await prisma.vote.create({
      data: {
        title,
        description: data.description,
        creatorId: data.creatorId,
        allowMultiple: data.allowMultiple,
        startAt: data.startAt,
        endAt: data.endAt,
        options: {
          create: options.map((text, index) => ({
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
      throw new AppError("Vote not found", 404);
    }

    const now = new Date();
    if (now < vote.startAt) {
      throw new AppError("投票尚未开始", 409);
    }
    if (now > vote.endAt) {
      throw new AppError("投票已结束", 409);
    }

    // ---- 选项校验：归属、单选、去重 ----
    const rawOptionIds = Array.isArray(data.optionIds) ? data.optionIds : [];
    const optionIds = rawOptionIds.map((id) => String(id));

    if (optionIds.length === 0) {
      throw new AppError("请至少选择一个选项", 400);
    }
    if (new Set(optionIds).size !== optionIds.length) {
      throw new AppError("不能重复选择同一个选项", 400);
    }

    const ownOptionIds = new Set(vote.options.map((option) => option.id));
    const foreign = optionIds.filter((id) => !ownOptionIds.has(id));
    if (foreign.length > 0) {
      throw new AppError("存在不属于本场投票的选项", 400);
    }

    if (!vote.allowMultiple && optionIds.length !== 1) {
      throw new AppError("本场投票为单选，只能选择一个选项", 400);
    }

    // ---- 限投一次 ----
    const existingHistory = await prisma.userVoteHistory.findUnique({
      where: {
        userId_voteId: {
          userId: data.userId,
          voteId: data.voteId,
        },
      },
    });

    if (existingHistory) {
      throw new AppError("你已参与过本场投票", 409);
    }

    const pseudonym = generatePseudonym();
    const payload = JSON.stringify(optionIds);

    // 序号必须在事务内分配：并发提交时靠 (voteId, sequenceNumber) 唯一索引兜底，
    // 命中冲突就重试，而不是在事务外「查最后一条 +1」。
    for (let attempt = 0; attempt < MAX_SEQUENCE_RETRIES; attempt++) {
      try {
        return await prisma.$transaction(async (tx) => {
          const lastBallot = await tx.ballot.findFirst({
            where: { voteId: data.voteId },
            orderBy: { sequenceNumber: "desc" },
            select: { sequenceNumber: true },
          });
          const sequenceNumber = (lastBallot?.sequenceNumber ?? 0) + 1;

          const ballot = await tx.ballot.create({
            data: {
              voteId: data.voteId,
              pseudonym,
              optionIds: payload,
              sequenceNumber,
            },
          });

          await tx.userVoteHistory.create({
            data: {
              userId: data.userId,
              voteId: data.voteId,
              ballotSequenceNumber: sequenceNumber,
            },
          });

          return {
            ballot,
            pseudonym,
            sequenceNumber,
          };
        });
      } catch (error: any) {
        if (isDuplicateVote(error) && !isSequenceConflict(error)) {
          throw new AppError("你已参与过本场投票", 409);
        }
        if (isSequenceConflict(error) || isTransientWriteConflict(error)) {
          if (attempt < MAX_SEQUENCE_RETRIES - 1) {
            await sleep(20 * (attempt + 1) + Math.floor(Math.random() * 20));
            continue;
          }
          throw new AppError("投票提交冲突，请重试", 409);
        }
        throw error;
      }
    }

    throw new AppError("投票提交冲突，请重试", 409);
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
