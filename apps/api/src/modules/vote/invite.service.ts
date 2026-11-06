import crypto from "crypto";
import { prisma } from "../../utils/prisma";
import { AppError } from "../../utils/errors";
import { decrypt } from "../../utils/encryption";
import { getVotePhase } from "./vote.phase";
import { VoteService } from "./vote.service";

const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_INVITES_PER_REQUEST = 200;

export interface InviteViewer {
  id: string;
  role: string;
}

export interface CreatedUsernameInvite {
  id: string;
  username: string;
  status: string;
}

export interface CreatedLinkInvite {
  id: string;
  token: string;
  url: string;
}

export interface InviteListItem {
  id: string;
  username: string | null;
  realName: string | null;
  status: string;
  acceptedAt: Date | null;
  expiresAt: Date | null;
  voted: boolean;
}

export interface TokenInviteInfo {
  voteId: string;
  title: string;
  phase: string;
  expiresAt: Date | null;
  accepted: boolean;
}

export interface MyInviteItem {
  inviteId: string;
  voteId: string;
  voteTitle: string;
  creatorUsername: string;
  status: string;
  phase: string;
  expiresAt: Date | null;
}

interface AcceptingUser {
  id: string;
}

function isExpired(invite: {
  expiresAt: Date | null;
  acceptedAt: Date | null;
  status: string;
}, now: Date): boolean {
  return (
    invite.status === "INVITED" &&
    invite.expiresAt !== null &&
    invite.expiresAt.getTime() <= now.getTime() &&
    invite.acceptedAt === null
  );
}

export class InviteService {
  private readonly voteService = new VoteService();

  private async loadVote(voteId: string) {
    const vote = await prisma.vote.findUnique({ where: { id: voteId } });
    if (!vote) {
      throw new AppError("Vote not found", 404);
    }
    return vote;
  }

  private assertModeB(vote: { participationMode: string }) {
    if (vote.participationMode !== "INVITE_ONLY") {
      throw new AppError("该投票不是邀请制", 400);
    }
  }

  private assertDraft(vote: {
    participationMode: string;
    startedAt: Date | null;
    closedAt: Date | null;
    endAt: Date;
  }) {
    if (getVotePhase(vote) !== "DRAFT") {
      throw new AppError("投票已开始，不能继续管理邀请", 409);
    }
  }

  async createUsernameInvites(
    voteId: string,
    creatorId: string,
    usernames: string[]
  ): Promise<{
    created: CreatedUsernameInvite[];
    notFound: string[];
    duplicates: string[];
  }> {
    const vote = await this.voteService.assertCreator(voteId, creatorId);
    this.assertModeB(vote);
    this.assertDraft(vote);

    if (!Array.isArray(usernames)) {
      throw new AppError("请提供用户名列表", 400);
    }

    const cleaned = [
      ...new Set(
        usernames.map((username) => String(username ?? "").trim()).filter(Boolean)
      ),
    ];
    if (cleaned.length === 0) {
      throw new AppError("请提供至少一个用户名", 400);
    }
    if (cleaned.length > MAX_INVITES_PER_REQUEST) {
      throw new AppError(`一次最多邀请 ${MAX_INVITES_PER_REQUEST} 个用户名`, 400);
    }

    const users = await prisma.user.findMany({
      where: { username: { in: cleaned } },
      select: { id: true, username: true },
    });
    const userByName = new Map(users.map((user) => [user.username, user]));

    const notFound = cleaned.filter((username) => !userByName.has(username));
    const matched = cleaned.filter((username) => userByName.has(username));

    const existing = await prisma.voteInvite.findMany({
      where: {
        voteId,
        inviteeUserId: { in: matched.map((username) => userByName.get(username)!.id) },
      },
      select: { id: true, inviteeUserId: true, status: true },
    });
    const existingByUser = new Map(
      existing.map((invite) => [invite.inviteeUserId, invite])
    );

    const duplicates: string[] = [];
    const pending: Array<{ userId: string; username: string }> = [];
    for (const username of matched) {
      const user = userByName.get(username)!;
      const current = existingByUser.get(user.id);
      if (current && current.status !== "REMOVED") {
        duplicates.push(username);
        continue;
      }
      pending.push({ userId: user.id, username });
    }

    const rows = await prisma.$transaction(
      pending.map(({ userId }) =>
        prisma.voteInvite.upsert({
          where: { voteId_inviteeUserId: { voteId, inviteeUserId: userId } },
          create: {
            voteId,
            inviteeUserId: userId,
            status: "INVITED",
          },
          update: {
            status: "INVITED",
            acceptedAt: null,
            removedAt: null,
            expiresAt: null,
          },
        })
      )
    );

    return {
      created: rows.map((row, index) => ({
        id: row.id,
        username: pending[index].username,
        status: row.status,
      })),
      notFound,
      duplicates,
    };
  }

  async createLinkInvites(
    voteId: string,
    creatorId: string,
    count: number
  ): Promise<{ links: CreatedLinkInvite[] }> {
    const vote = await this.voteService.assertCreator(voteId, creatorId);
    this.assertModeB(vote);
    this.assertDraft(vote);

    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > MAX_INVITES_PER_REQUEST
    ) {
      throw new AppError(
        `生成数量需为 1 到 ${MAX_INVITES_PER_REQUEST} 之间的整数`,
        400
      );
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + LINK_TTL_MS);

    const rows = await prisma.$transaction(
      Array.from({ length: count }, () => {
        const token = crypto.randomBytes(24).toString("hex");
        return prisma.voteInvite.create({
          data: {
            voteId,
            token,
            status: "INVITED",
            expiresAt,
          },
          select: { id: true, token: true },
        });
      })
    );

    return {
      links: rows.map((row) => ({
        id: row.id,
        token: row.token!,
        url: `/invite/${row.token}`,
      })),
    };
  }

  async listInvites(voteId: string, viewer: InviteViewer): Promise<InviteListItem[]> {
    const vote = await this.loadVote(voteId);
    this.assertModeB(vote);

    if (viewer.role !== "ADMIN" && vote.creatorId !== viewer.id) {
      throw new AppError("只有创建者或管理员可以查看邀请名单", 403);
    }

    const invites = await prisma.voteInvite.findMany({
      where: { voteId },
      include: {
        invitee: {
          select: { id: true, username: true, realName: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

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
    const now = new Date();

    return invites.map((invite) => {
      let realName: string | null = null;
      if (invite.invitee) {
        realName = invite.invitee.realName;
        try {
          realName = decrypt(realName);
        } catch {
          // 兼容历史明文数据
        }
      }

      return {
        id: invite.id,
        username: invite.invitee?.username ?? null,
        realName,
        status: isExpired(invite, now) ? "EXPIRED" : invite.status,
        acceptedAt: invite.acceptedAt,
        expiresAt: invite.expiresAt,
        voted: invite.inviteeUserId ? voters.has(invite.inviteeUserId) : false,
      };
    });
  }

  async removeInvite(voteId: string, inviteId: string, creatorId: string) {
    const vote = await this.voteService.assertCreator(voteId, creatorId);

    const invite = await prisma.voteInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.voteId !== voteId) {
      throw new AppError("邀请不存在", 404);
    }
    if (invite.status === "REMOVED") {
      return invite;
    }

    const phase = getVotePhase(vote);
    if (phase === "ENDED") {
      throw new AppError("投票已结束，不能移除受邀人", 409);
    }
    if (phase === "LIVE" && invite.inviteeUserId) {
      const history = await prisma.userVoteHistory.findUnique({
        where: {
          userId_voteId: { userId: invite.inviteeUserId, voteId },
        },
      });
      if (history) {
        throw new AppError("该受邀人已投票，不能移除", 409);
      }
    }

    return prisma.voteInvite.update({
      where: { id: inviteId },
      data: { status: "REMOVED", removedAt: new Date() },
    });
  }

  async getInviteByToken(token: string): Promise<TokenInviteInfo> {
    const invite = await prisma.voteInvite.findUnique({
      where: { token },
      include: { vote: true },
    });

    if (!invite || invite.status === "REMOVED") {
      throw new AppError("邀请不存在", 404);
    }

    const now = new Date();
    const accepted = invite.status === "ACCEPTED" || invite.acceptedAt !== null;
    if (
      invite.expiresAt !== null &&
      invite.expiresAt.getTime() <= now.getTime() &&
      !accepted
    ) {
      throw new AppError("邀请已过期", 410);
    }

    return {
      voteId: invite.voteId,
      title: invite.vote.title,
      phase: getVotePhase(invite.vote, now),
      expiresAt: invite.expiresAt,
      accepted,
    };
  }

  async acceptInvite(token: string, user: AcceptingUser) {
    const now = new Date();

    return prisma.$transaction(async (tx) => {
      const invite = await tx.voteInvite.findUnique({
        where: { token },
        include: { vote: true },
      });

      if (!invite) {
        throw new AppError("邀请不存在", 404);
      }
      if (invite.status === "REMOVED") {
        throw new AppError("邀请已被移除", 410);
      }

      const accepted = invite.status === "ACCEPTED" || invite.acceptedAt !== null;
      if (
        invite.expiresAt !== null &&
        invite.expiresAt.getTime() <= now.getTime() &&
        !accepted
      ) {
        throw new AppError("邀请已过期", 410);
      }
      if (getVotePhase(invite.vote, now) === "ENDED") {
        throw new AppError("投票已结束", 409);
      }

      if (invite.inviteeUserId !== null) {
        if (invite.inviteeUserId !== user.id) {
          throw new AppError("邀请已被其他用户接受", 409);
        }
        if (accepted) {
          return invite;
        }
        return tx.voteInvite.update({
          where: { id: invite.id },
          data: { status: "ACCEPTED", acceptedAt: now },
        });
      }

      const existing = await tx.voteInvite.findFirst({
        where: {
          voteId: invite.voteId,
          inviteeUserId: user.id,
          id: { not: invite.id },
        },
      });

      if (existing && existing.status !== "REMOVED") {
        await tx.voteInvite.update({
          where: { id: invite.id },
          data: { status: "REMOVED", removedAt: now },
        });
        return existing;
      }

      if (existing) {
        // @@unique([voteId, inviteeUserId]) would otherwise block the update.
        await tx.voteInvite.delete({ where: { id: existing.id } });
      }

      return tx.voteInvite.update({
        where: { id: invite.id },
        data: {
          inviteeUserId: user.id,
          status: "ACCEPTED",
          acceptedAt: now,
        },
      });
    });
  }

  async acceptInviteById(inviteId: string, user: AcceptingUser) {
    const invite = await prisma.voteInvite.findUnique({
      where: { id: inviteId },
      include: { vote: true },
    });

    if (!invite || invite.inviteeUserId !== user.id) {
      throw new AppError("邀请不存在", 404);
    }
    if (invite.status === "REMOVED") {
      throw new AppError("邀请不存在", 404);
    }
    if (invite.status === "ACCEPTED" || invite.acceptedAt !== null) {
      return invite;
    }

    const now = new Date();
    if (invite.expiresAt !== null && invite.expiresAt.getTime() <= now.getTime()) {
      throw new AppError("邀请已过期", 410);
    }
    if (getVotePhase(invite.vote, now) === "ENDED") {
      throw new AppError("投票已结束", 409);
    }

    return prisma.voteInvite.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED", acceptedAt: now },
    });
  }

  async getMyInvites(userId: string): Promise<MyInviteItem[]> {
    const invites = await prisma.voteInvite.findMany({
      where: { inviteeUserId: userId, status: { not: "REMOVED" } },
      orderBy: { createdAt: "desc" },
      include: { vote: true },
    });

    const creatorIds = [...new Set(invites.map((invite) => invite.vote.creatorId))];
    const creators = creatorIds.length
      ? await prisma.user.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, username: true },
        })
      : [];
    const creatorNameById = new Map(
      creators.map((creator) => [creator.id, creator.username])
    );

    const now = new Date();
    return invites.map((invite) => ({
      inviteId: invite.id,
      voteId: invite.voteId,
      voteTitle: invite.vote.title,
      creatorUsername: creatorNameById.get(invite.vote.creatorId) ?? "",
      status: isExpired(invite, now) ? "EXPIRED" : invite.status,
      phase: getVotePhase(invite.vote, now),
      expiresAt: invite.expiresAt,
    }));
  }

  async startVote(voteId: string, creatorId: string) {
    const vote = await this.voteService.assertCreator(voteId, creatorId);
    this.assertModeB(vote);
    this.assertDraft(vote);

    if (vote.durationMinutes === null) {
      throw new AppError("投票时长缺失，无法开始投票", 409);
    }

    const acceptedCount = await prisma.voteInvite.count({
      where: { voteId, status: "ACCEPTED" },
    });
    if (acceptedCount === 0) {
      throw new AppError("至少需要一位已接受的受邀人", 409);
    }

    const now = new Date();
    const endAt = new Date(now.getTime() + vote.durationMinutes * 60_000);

    return prisma.vote.update({
      where: { id: voteId },
      data: {
        startedAt: now,
        startAt: now,
        endAt,
      },
      include: { options: true },
    });
  }
}
