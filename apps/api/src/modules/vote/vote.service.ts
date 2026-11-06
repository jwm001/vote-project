import { prisma } from "../../utils/prisma";
import { AppError } from "../../utils/errors";
import { ABSTAIN_TEXT, MAX_DURATION_MINUTES, MAX_OPTION_LENGTH, MAX_OPTIONS, MIN_DURATION_MINUTES } from "./vote.constants";
import { CreateVoteInput, MyVoteItem, MyVoteCreated, MyVoteParticipated, ParticipationMode, UpdateVoteInput, VotePhase, VoteViewer } from "./vote.types";
import { getVotePhase } from "./vote.phase";

function generatePseudonym() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `user_${timestamp}_${random}`;
}

const MAX_SEQUENCE_RETRIES = 5;

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
  async assertCreator(voteId: string, creatorId: string) {
    const vote = await prisma.vote.findUnique({
      where: { id: voteId },
    });
    if (!vote) {
      throw new AppError("Vote not found", 404);
    }
    if (vote.creatorId !== creatorId) {
      throw new AppError("Not the creator of this vote", 403);
    }
    return vote;
  }

  private validateOptions(options: unknown): string[] {
    if (!Array.isArray(options)) {
      throw new AppError("请至少提供两个选项", 400);
    }
    const trimmed = options.map((text) => String(text ?? "").trim());
    if (trimmed.length < 2) {
      throw new AppError("投票至少需要两个选项", 400);
    }
    if (trimmed.length > MAX_OPTIONS) {
      throw new AppError(`选项不能超过 ${MAX_OPTIONS} 个`, 400);
    }
    if (trimmed.some((text) => !text)) {
      throw new AppError("选项内容不能为空", 400);
    }
    if (trimmed.some((text) => text.length > MAX_OPTION_LENGTH)) {
      throw new AppError(`单个选项不能超过 ${MAX_OPTION_LENGTH} 个字符`, 400);
    }
    if (new Set(trimmed).size !== trimmed.length) {
      throw new AppError("选项内容不能重复", 400);
    }
    if (trimmed.some((text) => text === ABSTAIN_TEXT)) {
      throw new AppError(`选项不能包含 ${ABSTAIN_TEXT}`, 400);
    }
    return trimmed;
  }

  private buildOptionRows(voteId: string, texts: string[]) {
    return [
      ...texts.map((text, index) => ({
        voteId,
        text,
        order: index,
        isAbstain: false,
      })),
      {
        voteId,
        text: ABSTAIN_TEXT,
        order: texts.length,
        isAbstain: true,
      },
    ];
  }

  async createVote(input: CreateVoteInput) {
    const title = String(input.title ?? "").trim();
    if (!title) {
      throw new AppError("请填写投票标题", 400);
    }

    const options = this.validateOptions(input.options);

    const now = new Date();
    const participationMode = input.participationMode;
    if (participationMode !== "OPEN_LINK" && participationMode !== "INVITE_ONLY") {
      throw new AppError("投票模式不正确", 400);
    }

    const hasEndAt = input.endAt !== undefined;
    const hasDurationMinutes = input.durationMinutes !== undefined;
    if (hasEndAt && hasDurationMinutes) {
      throw new AppError("结束时间与投票时长不能同时提供", 400);
    }

    let startAt: Date;
    let endAt: Date;
    let durationMinutes: number | null;
    let startedAt: Date | null;

    if (participationMode === "OPEN_LINK") {
      // Mode A: creator picks an absolute end time.
      const end = input.endAt;
      if (end === undefined) {
        throw new AppError("OPEN_LINK 投票需要提供结束时间", 400);
      }
      const endDate = new Date(end);
      if (Number.isNaN(endDate.getTime())) {
        throw new AppError("投票时间格式不正确", 400);
      }
      if (endDate.getTime() <= now.getTime()) {
        throw new AppError("结束时间必须晚于开始时间", 400);
      }
      startAt = now;
      endAt = endDate;
      durationMinutes = null;
      startedAt = now;
    } else {
      // Mode B: creator picks a duration from start.
      const duration = input.durationMinutes;
      if (duration === undefined) {
        throw new AppError("INVITE_ONLY 投票需要提供投票时长", 400);
      }
      if (
        typeof duration !== "number" ||
        !Number.isInteger(duration) ||
        duration < MIN_DURATION_MINUTES ||
        duration > MAX_DURATION_MINUTES
      ) {
        throw new AppError(
          `投票时长需为 ${MIN_DURATION_MINUTES} 到 ${MAX_DURATION_MINUTES} 之间的整数分钟`,
          400
        );
      }
      startAt = now;
      endAt = new Date(now.getTime() + duration * 60_000);
      durationMinutes = duration;
      startedAt = null;
    }

    const vote = await prisma.vote.create({
      data: {
        title,
        description: input.description,
        creatorId: input.creatorId,
        allowMultiple: input.allowMultiple,
        participationMode: input.participationMode,
        resultsPublicDuringVote: input.resultsPublicDuringVote ?? false,
        durationMinutes,
        startAt,
        endAt,
        startedAt,
        options: {
          create: [
            ...options.map((text, index) => ({
              text,
              order: index,
              isAbstain: false,
            })),
            {
              text: ABSTAIN_TEXT,
              order: options.length,
              isAbstain: true,
            },
          ],
        },
      },
      include: {
        options: true,
      },
    });
    return vote;
  }

  async updateVote(id: string, creatorId: string, input: UpdateVoteInput) {
    const vote = await this.assertCreator(id, creatorId);

    if ((input as any).participationMode !== undefined) {
      throw new AppError("不允许修改投票模式", 400);
    }

    const hasEndAt = input.endAt !== undefined;
    const hasDurationMinutes = input.durationMinutes !== undefined;
    if (hasEndAt && hasDurationMinutes) {
      throw new AppError("结束时间与投票时长不能同时提供", 400);
    }

    const hasBallot = !!(await prisma.ballot.findFirst({
      where: { voteId: id },
      select: { id: true },
    }));
    const editable = vote.participationMode === "OPEN_LINK" ? !hasBallot : vote.startedAt === null;
    if (!editable) {
      throw new AppError("投票已开始，不能修改", 409);
    }

    const data: {
      title?: string;
      description?: string;
      allowMultiple?: boolean;
      resultsPublicDuringVote?: boolean;
      endAt?: Date;
      durationMinutes?: number | null;
    } = {};

    if (input.title !== undefined) {
      const title = String(input.title ?? "").trim();
      if (!title) {
        throw new AppError("请填写投票标题", 400);
      }
      data.title = title;
    }
    if (input.description !== undefined) {
      data.description = input.description;
    }
    if (input.allowMultiple !== undefined) {
      data.allowMultiple = Boolean(input.allowMultiple);
    }
    if (input.resultsPublicDuringVote !== undefined) {
      if (
        vote.participationMode === "OPEN_LINK" &&
        input.resultsPublicDuringVote !== vote.resultsPublicDuringVote
      ) {
        throw new AppError("OPEN_LINK 投票创建时即为进行中，不能修改 resultsPublicDuringVote", 409);
      }
      data.resultsPublicDuringVote = input.resultsPublicDuringVote;
    }
    if (vote.participationMode === "OPEN_LINK") {
      // Mode A: absolute end time is the updatable timing field.
      if (input.durationMinutes !== undefined) {
        throw new AppError("OPEN_LINK 投票不能设置投票时长", 400);
      }
      if (input.endAt !== undefined) {
        const end = new Date(input.endAt);
        if (Number.isNaN(end.getTime())) {
          throw new AppError("投票时间格式不正确", 400);
        }
        if (end.getTime() <= new Date().getTime()) {
          throw new AppError("结束时间必须晚于开始时间", 400);
        }
        data.endAt = end;
        data.durationMinutes = null;
      }
    } else {
      // Mode B: duration-based window is the updatable timing field.
      if (input.endAt !== undefined) {
        throw new AppError("INVITE_ONLY 投票不能设置结束时间", 400);
      }
      if (input.durationMinutes !== undefined) {
        const duration = input.durationMinutes;
        if (
          typeof duration !== "number" ||
          !Number.isInteger(duration) ||
          duration < MIN_DURATION_MINUTES ||
          duration > MAX_DURATION_MINUTES
        ) {
          throw new AppError(
            `投票时长需为 ${MIN_DURATION_MINUTES} 到 ${MAX_DURATION_MINUTES} 之间的整数分钟`,
            400
          );
        }
        data.durationMinutes = duration;
        data.endAt = new Date(Date.now() + duration * 60_000);
      }
    }

    if (input.options !== undefined) {
      const options = this.validateOptions(input.options);
      await prisma.$transaction(async (tx) => {
        const current = await tx.vote.findUnique({ where: { id } });
        if (!current) {
          throw new AppError("Vote not found", 404);
        }
        const currentBallot = await tx.ballot.findFirst({
          where: { voteId: id },
          select: { id: true },
        });
        const currentEditable = current.participationMode === "OPEN_LINK" ? !currentBallot : current.startedAt === null;
        if (!currentEditable) {
          throw new AppError("投票已开始，不能修改", 409);
        }
        await tx.option.deleteMany({ where: { voteId: id } });
        await tx.option.createMany({
          data: this.buildOptionRows(id, options),
        });
      });
    }

    return prisma.vote.update({
      where: { id },
      data,
      include: {
        options: true,
      },
    });
  }

  async deleteVote(id: string, creatorId: string) {
    const vote = await this.assertCreator(id, creatorId);

    const hasBallot = !!(await prisma.ballot.findFirst({
      where: { voteId: id },
      select: { id: true },
    }));
    const editable = vote.participationMode === "OPEN_LINK" ? !hasBallot : vote.startedAt === null;
    if (!editable) {
      throw new AppError("投票已开始，不能删除", 409);
    }

    await prisma.$transaction(async (tx) => {
      const current = await tx.vote.findUnique({ where: { id } });
      if (!current) {
        throw new AppError("Vote not found", 404);
      }
      const currentBallot = await tx.ballot.findFirst({
        where: { voteId: id },
        select: { id: true },
      });
      const currentEditable = current.participationMode === "OPEN_LINK" ? !currentBallot : current.startedAt === null;
      if (!currentEditable) {
        throw new AppError("投票已开始，不能删除", 409);
      }
      await tx.ballot.deleteMany({ where: { voteId: id } });
      await tx.userVoteHistory.deleteMany({ where: { voteId: id } });
      await tx.voteInvite.deleteMany({ where: { voteId: id } });
      await tx.option.deleteMany({ where: { voteId: id } });
      await tx.vote.delete({ where: { id } });
    });
  }

  async endVote(id: string, creatorId: string) {
    const vote = await this.assertCreator(id, creatorId);
    const phase = getVotePhase(vote);

    if (phase === "DRAFT") {
      throw new AppError("请先开始投票", 409);
    }
    if (phase === "ENDED") {
      throw new AppError("投票已结束", 409);
    }

    const ended = await prisma.vote.update({
      where: { id },
      data: { closedAt: new Date() },
      include: {
        options: true,
      },
    });
    return ended;
  }

  async getVoteById(id: string, viewer: VoteViewer) {
    const vote = await prisma.vote.findUnique({
      where: { id },
      include: {
        options: true,
      },
    });

    if (!vote) {
      throw new AppError("Vote not found", 404);
    }

    const now = new Date();
    const isCreator = viewer.id === vote.creatorId;
    const isAdmin = viewer.role === "ADMIN";
    const isModeB = vote.participationMode === "INVITE_ONLY";

    let invite: { status: string; expiresAt: Date | null } | null = null;
    let isInvitee = false;

    if (isModeB) {
      invite = await prisma.voteInvite.findFirst({
        where: { voteId: id, inviteeUserId: viewer.id },
      });
      isInvitee =
        !!invite &&
        invite.status !== "REMOVED" &&
        (invite.status === "ACCEPTED" ||
          invite.expiresAt === null ||
          invite.expiresAt.getTime() > now.getTime());
    }

    if (isModeB && !isInvitee && !isCreator && !isAdmin) {
      throw new AppError("你不在本场受邀名单中", 403);
    }

    const phase = getVotePhase(vote, now);
    const hasVoted = await this.hasUserVoted(viewer.id, vote.id);
    const votedCount = await prisma.ballot.count({
      where: { voteId: vote.id },
    });
    const eligibleCount = isModeB
      ? await prisma.voteInvite.count({
          where: { voteId: id, status: { not: "REMOVED" } },
        })
      : null;

    const canVote =
      phase === "LIVE" &&
      !hasVoted &&
      viewer.status === "APPROVED" &&
      (vote.participationMode === "OPEN_LINK" || invite?.status === "ACCEPTED");

    return {
      vote: {
        ...vote,
        phase,
        votedCount,
        eligibleCount,
        hasVoted,
        isInvitee,
        isCreator,
        canVote,
      },
    };
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
    const phase = getVotePhase(vote, now);
    if (phase === "DRAFT") {
      throw new AppError("投票尚未开始", 409);
    }
    if (phase === "ENDED") {
      throw new AppError("投票已结束", 409);
    }

    // ---- 模式 B：必须先接受邀请 ----
    if (vote.participationMode === "INVITE_ONLY") {
      const invite = await prisma.voteInvite.findFirst({
        where: {
          voteId: data.voteId,
          inviteeUserId: data.userId,
          status: "ACCEPTED",
        },
        select: { id: true },
      });
      if (!invite) {
        throw new AppError("请先接受邀请或不在名单中", 403);
      }
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

    // ---- 弃权互斥：弃权只能单独选择 ----
    const abstain = vote.options.find((option) => option.isAbstain);
    if (abstain && optionIds.includes(abstain.id) && optionIds.length > 1) {
      throw new AppError("弃权不能与其他选项同时选择", 400);
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
        const result = await prisma.$transaction(async (tx) => {
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

        if (vote.participationMode === "INVITE_ONLY") {
          await this.maybeAutoEnd(data.voteId);
        }

        return result;
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

  /**
   * 模式 B 可选自动结束：所有「已绑定用户且未移除」的受邀人都投票后关闭投票。
   * 未接受的一人一链接（inviteeUserId = null）不阻塞；未接受的用户名邀请会阻塞。
   * 事务已成功提交，自动结束失败不能影响投票结果。
   */
  private async maybeAutoEnd(voteId: string) {
    try {
      const invites = await prisma.voteInvite.findMany({
        where: {
          voteId,
          inviteeUserId: { not: null },
          status: { not: "REMOVED" },
        },
        select: { inviteeUserId: true },
      });

      const inviteeIds = [
        ...new Set(
          invites
            .map((invite) => invite.inviteeUserId)
            .filter((id): id is string => id !== null)
        ),
      ];
      if (inviteeIds.length === 0) {
        return;
      }

      const votedCount = await prisma.userVoteHistory.count({
        where: { voteId, userId: { in: inviteeIds } },
      });
      if (votedCount < inviteeIds.length) {
        return;
      }

      await prisma.vote.updateMany({
        where: { id: voteId, closedAt: null },
        data: { closedAt: new Date() },
      });
    } catch {
      // 自动结束是尽力而为，不能因为关闭失败让已写入的投票返回错误。
    }
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

  async getMyVotes(userId: string): Promise<MyVoteItem[]> {
    const createdVotes = await prisma.vote.findMany({
      where: { creatorId: userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        allowMultiple: true,
        participationMode: true,
        startAt: true,
        endAt: true,
        startedAt: true,
        closedAt: true,
        createdAt: true,
      },
    });

    const histories = await prisma.userVoteHistory.findMany({
      where: { userId },
      orderBy: { votedAt: "desc" },
      include: {
        vote: {
          select: {
            id: true,
            title: true,
            allowMultiple: true,
            participationMode: true,
            startAt: true,
            endAt: true,
            startedAt: true,
            closedAt: true,
            createdAt: true,
          },
        },
      },
    });

    const voteIds = new Set<string>();
    for (const vote of createdVotes) {
      voteIds.add(vote.id);
    }
    for (const history of histories) {
      voteIds.add(history.voteId);
    }
    const ids = [...voteIds];

    // Batch all lookups for the involved votes into a fixed number of queries.
    const ballots = ids.length
      ? await prisma.ballot.findMany({
          where: { voteId: { in: ids } },
          select: { voteId: true, sequenceNumber: true, pseudonym: true, submittedAt: true },
        })
      : [];
    const ballotsByVote = new Map<string, Map<number, { pseudonym: string; submittedAt: Date }>>();
    const votedCountByVote = new Map<string, number>();
    for (const ballot of ballots) {
      let sequenceMap = ballotsByVote.get(ballot.voteId);
      if (!sequenceMap) {
        sequenceMap = new Map();
        ballotsByVote.set(ballot.voteId, sequenceMap);
      }
      sequenceMap.set(ballot.sequenceNumber, ballot);
      votedCountByVote.set(ballot.voteId, (votedCountByVote.get(ballot.voteId) ?? 0) + 1);
    }

    const invites = ids.length
      ? await prisma.voteInvite.findMany({
          where: { voteId: { in: ids } },
          select: { voteId: true, status: true },
        })
      : [];
    const eligibleByVote = new Map<string, number>();
    for (const invite of invites) {
      if (invite.status === "REMOVED") continue;
      eligibleByVote.set(invite.voteId, (eligibleByVote.get(invite.voteId) ?? 0) + 1);
    }

    const entries: Array<{ item: MyVoteItem; sortAt: Date }> = [];

    for (const vote of createdVotes) {
      entries.push({
        sortAt: vote.createdAt,
        item: this.buildMyVoteItem(
          {
            voteId: vote.id,
            title: vote.title,
            allowMultiple: vote.allowMultiple,
            participationMode: vote.participationMode as ParticipationMode,
            startAt: vote.startAt,
            endAt: vote.endAt,
            phase: getVotePhase(vote),
            votedCount: votedCountByVote.get(vote.id) ?? 0,
            eligibleCount: vote.participationMode === "INVITE_ONLY" ? eligibleByVote.get(vote.id) ?? 0 : null,
          },
          "CREATOR"
        ),
      });
    }

    for (const history of histories) {
      const vote = history.vote;
      const ballot = ballotsByVote.get(vote.id)?.get(history.ballotSequenceNumber);
      entries.push({
        sortAt: history.votedAt,
        item: this.buildMyVoteItem(
          {
            voteId: vote.id,
            title: vote.title,
            allowMultiple: vote.allowMultiple,
            participationMode: vote.participationMode as ParticipationMode,
            startAt: vote.startAt,
            endAt: vote.endAt,
            phase: getVotePhase(vote),
            votedCount: votedCountByVote.get(vote.id) ?? 0,
            eligibleCount: vote.participationMode === "INVITE_ONLY" ? eligibleByVote.get(vote.id) ?? 0 : null,
          },
          "PARTICIPANT",
          {
            pseudonym: ballot?.pseudonym ?? null,
            submittedAt: ballot?.submittedAt ?? history.votedAt,
            sequenceNumber: history.ballotSequenceNumber,
          }
        ),
      });
    }

    entries.sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime());

    return entries.map((entry) => entry.item);
  }

  private buildMyVoteItem(
    input: {
      voteId: string;
      title: string;
      allowMultiple: boolean;
      participationMode: ParticipationMode;
      startAt: Date;
      endAt: Date;
      phase: VotePhase;
      votedCount: number;
      eligibleCount: number | null;
    },
    relation: "CREATOR" | "PARTICIPANT",
    participant?: { pseudonym: string | null; submittedAt: Date | null; sequenceNumber: number | null }
  ): MyVoteItem {
    const base = {
      voteId: input.voteId,
      voteTitle: input.title,
      participationMode: input.participationMode,
      phase: input.phase,
      allowMultiple: input.allowMultiple,
      startAt: input.startAt,
      endAt: input.endAt,
      votedCount: input.votedCount,
      eligibleCount: input.eligibleCount,
    };

    if (relation === "CREATOR") {
      const item: MyVoteCreated = { ...base, relation: "CREATOR" };
      return item;
    }

    const item: MyVoteParticipated = {
      ...base,
      relation: "PARTICIPANT",
      pseudonym: participant?.pseudonym ?? null,
      submittedAt: participant?.submittedAt ?? null,
      sequenceNumber: participant?.sequenceNumber ?? null,
    };
    return item;
  }
}
