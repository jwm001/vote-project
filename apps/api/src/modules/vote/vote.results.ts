import { prisma } from "../../utils/prisma";
import { AppError } from "../../utils/errors";
import { decrypt } from "../../utils/encryption";
import { maskRealName } from "../../utils/names";
import { getVotePhase } from "./vote.phase";
import { VoteViewer } from "./vote.types";

export interface ResultOption {
  id: string;
  text: string;
  order?: number;
  isAbstain: boolean;
}

export interface ResultBallot {
  optionIds: string;
}

export interface AggregatedOption {
  id: string;
  text: string;
  count: number;
  percent: number;
  isAbstain: boolean;
}

export interface AggregateResults {
  totalBallots: number;
  options: AggregatedOption[];
  winner: string | null;
  note: string | null;
}

export type ResultsResult =
  | { visible: false; votedCount: number; eligibleCount: number }
  | ({ visible: true; votedCount: number; eligibleCount: number } & AggregateResults);

export interface MaskedRosterEntry {
  name: string;
}

export interface FullRosterEntry {
  name: string | null;
  status: string;
  voted?: boolean;
}

export type RosterResult =
  | { visible: false }
  | { visible: true; mode: "MASKED"; entries: MaskedRosterEntry[] }
  | { visible: true; mode: "FULL"; entries: FullRosterEntry[] }
  | { visible: true; mode: "COUNT_ONLY"; count: number };

function parseOptionIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    // 历史数据或手工造的数据可能有损坏的 JSON，统计时直接忽略这一票的选择。
    return [];
  }
}

/**
 * 汇总本场所有选票。
 *
 * 多选投票中一张票可以命中多个选项，因此百分比合计可能超过 100。
 */
export function aggregateResults(
  options: ResultOption[],
  ballots: ResultBallot[]
): AggregateResults {
  const totalBallots = ballots.length;
  const counts = new Map<string, number>();
  for (const option of options) {
    counts.set(option.id, 0);
  }

  for (const ballot of ballots) {
    for (const optionId of parseOptionIds(ballot.optionIds)) {
      if (!counts.has(optionId)) continue;
      counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
    }
  }

  const aggregated: AggregatedOption[] = options.map((option) => {
    const count = counts.get(option.id) ?? 0;
    return {
      id: option.id,
      text: option.text,
      count,
      percent: totalBallots === 0 ? 0 : Math.round((count / totalBallots) * 1000) / 10,
      isAbstain: option.isAbstain,
    };
  });

  if (totalBallots === 0) {
    return { totalBallots, options: aggregated, winner: null, note: "暂无投票" };
  }

  const nonAbstain = aggregated.filter((option) => !option.isAbstain);
  const abstainCount = aggregated
    .filter((option) => option.isAbstain)
    .reduce((sum, option) => sum + option.count, 0);
  const topNonAbstain = nonAbstain.reduce(
    (max, option) => Math.max(max, option.count),
    0
  );
  const topOptions = nonAbstain.filter((option) => option.count === topNonAbstain);

  if (abstainCount > topNonAbstain || topNonAbstain === 0) {
    return {
      totalBallots,
      options: aggregated,
      winner: null,
      note: "弃权最多，未形成多数",
    };
  }

  if ((abstainCount === topNonAbstain && abstainCount > 0) || topOptions.length > 1) {
    return { totalBallots, options: aggregated, winner: null, note: "平票" };
  }

  return {
    totalBallots,
    options: aggregated,
    winner: topOptions[0]?.text ?? null,
    note: null,
  };
}

function decryptName(value: string | null): string | null {
  if (value === null) return null;
  try {
    return decrypt(value);
  } catch {
    // 兼容历史明文/空值数据。
    return value;
  }
}

function derivedInviteStatus(
  invite: { status: string; expiresAt: Date | null },
  now: Date
): string {
  if (
    invite.status === "INVITED" &&
    invite.expiresAt !== null &&
    invite.expiresAt.getTime() <= now.getTime()
  ) {
    return "EXPIRED";
  }
  return invite.status;
}

async function loadVote(voteId: string) {
  const vote = await prisma.vote.findUnique({
    where: { id: voteId },
    include: { options: { orderBy: { order: "asc" } } },
  });
  if (!vote) {
    throw new AppError("Vote not found", 404);
  }
  return vote;
}

async function isInviteeOf(voteId: string, userId: string): Promise<boolean> {
  const invite = await prisma.voteInvite.findFirst({
    where: { voteId, inviteeUserId: userId },
    select: { status: true },
  });
  return !!invite && invite.status !== "REMOVED";
}

/**
 * 结果可见性：模式 A 结束后对已审核用户公开；模式 B 只对受邀者/创建者/管理员
 * 开放，且进行中默认隐藏（除非创建时允许实时结果）。
 */
export async function getResults(
  voteId: string,
  viewer: VoteViewer
): Promise<ResultsResult> {
  const vote = await loadVote(voteId);
  const phase = getVotePhase(vote);
  const isCreatorOrAdmin = viewer.id === vote.creatorId || viewer.role === "ADMIN";
  const isModeB = vote.participationMode === "INVITE_ONLY";

  if (isModeB && !isCreatorOrAdmin) {
    const invited = await isInviteeOf(voteId, viewer.id);
    if (!invited) {
      throw new AppError("无权查看本场结果", 403);
    }
  }

  const ballots = await prisma.ballot.findMany({
    where: { voteId },
    select: { optionIds: true },
    orderBy: { sequenceNumber: "asc" },
  });
  const votedCount = ballots.length;
  // 与 vote detail / my-votes 保持一致：模式 B 的「应投人数」是未移除的邀请数，
  // 包括尚未被接受的链接邀请（它们仍占一个可投票席位）。
  const eligibleCount = isModeB
    ? await prisma.voteInvite.count({
        where: { voteId, status: { not: "REMOVED" } },
      })
    : await prisma.user.count({ where: { status: "APPROVED" } });

  const visible = isModeB
    ? phase === "ENDED" || vote.resultsPublicDuringVote
    : isCreatorOrAdmin ||
      vote.resultsPublicDuringVote ||
      (phase === "ENDED" && viewer.status === "APPROVED");

  if (!visible) {
    return { visible: false, votedCount, eligibleCount };
  }

  return {
    visible: true,
    ...aggregateResults(vote.options, ballots),
    votedCount,
    eligibleCount,
  };
}

/**
 * 名单可见性：
 * - 模式 A 进行中不公开，结束后只公开「已投票者 + 脱敏姓名」。
 * - 模式 B 草稿/结束后创建者与受邀者看到完整名单；进行中受邀者只看人数。
 */
export async function getRoster(
  voteId: string,
  viewer: VoteViewer
): Promise<RosterResult> {
  const vote = await loadVote(voteId);
  const phase = getVotePhase(vote);
  const isModeB = vote.participationMode === "INVITE_ONLY";
  const isCreatorOrAdmin = viewer.id === vote.creatorId || viewer.role === "ADMIN";

  if (!isModeB) {
    if (phase !== "ENDED") {
      return { visible: false };
    }

    const histories = await prisma.userVoteHistory.findMany({
      where: { voteId },
      orderBy: { votedAt: "asc" },
      include: {
        user: { select: { realName: true } },
      },
    });

    return {
      visible: true,
      mode: "MASKED",
      entries: histories.map((history) => ({
        name: maskRealName(decryptName(history.user.realName)),
      })),
    };
  }

  let isInvitee = false;
  if (!isCreatorOrAdmin) {
    isInvitee = await isInviteeOf(voteId, viewer.id);
    if (!isInvitee) {
      throw new AppError("无权查看本场名单", 403);
    }
  }

  const invites = await prisma.voteInvite.findMany({
    where: { voteId, status: { not: "REMOVED" } },
    include: {
      invitee: { select: { id: true, realName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const now = new Date();

  if (phase === "DRAFT") {
    return {
      visible: true,
      mode: "FULL",
      entries: invites.map((invite) => ({
        name: invite.invitee ? decryptName(invite.invitee.realName) : null,
        status: derivedInviteStatus(invite, now),
      })),
    };
  }

  if (phase === "LIVE") {
    if (!isCreatorOrAdmin) {
      // 名单人数与 DRAFT/FULL 的条目数一致（含未接受的链接邀请）。
      return { visible: true, mode: "COUNT_ONLY", count: invites.length };
    }

    const boundUserIds = invites
      .map((invite) => invite.inviteeUserId)
      .filter((userId): userId is string => userId !== null);
    const histories = boundUserIds.length
      ? await prisma.userVoteHistory.findMany({
          where: { voteId, userId: { in: boundUserIds } },
          select: { userId: true },
        })
      : [];
    const voters = new Set(histories.map((history) => history.userId));

    return {
      visible: true,
      mode: "FULL",
      entries: invites.map((invite) => ({
        name: invite.invitee ? decryptName(invite.invitee.realName) : null,
        status: derivedInviteStatus(invite, now),
        voted: invite.inviteeUserId !== null && voters.has(invite.inviteeUserId),
      })),
    };
  }

  // ENDED：保留完整名单（含未投票者），但不再暴露谁投了票。
  return {
    visible: true,
    mode: "FULL",
    entries: invites.map((invite) => ({
      name: invite.invitee ? decryptName(invite.invitee.realName) : null,
      status: derivedInviteStatus(invite, now),
    })),
  };
}
