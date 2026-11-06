import { beforeEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createApp } from "../../app";
import { InviteService } from "./invite.service";
import { VoteService } from "./vote.service";
import { AppError } from "../../utils/errors";
import { encrypt } from "../../utils/encryption";
import { prisma } from "../../utils/prisma";
import { resetDb } from "../../test/db";
import { resetRateLimits } from "../../utils/rate-limit";
import { makeUser } from "../../test/factories";
import { getVotePhase } from "./vote.phase";

const inviteService = new InviteService();
const voteService = new VoteService();

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

async function expectAppError(
  promise: Promise<unknown>,
  status: number,
  message?: string
): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(AppError);
  const appError = error as AppError;
  expect(appError.status).toBe(status);
  if (message !== undefined) {
    expect(appError.message).toBe(message);
  }
  return appError;
}

function makeModeBVote(creatorId: string, durationMinutes = 60) {
  return voteService.createVote({
    creatorId,
    title: "邀请制投票",
    participationMode: "INVITE_ONLY",
    allowMultiple: false,
    durationMinutes,
    options: ["A", "B"],
  });
}

function makeModeAVote(creatorId: string) {
  return voteService.createVote({
    creatorId,
    title: "公开投票",
    participationMode: "OPEN_LINK",
    allowMultiple: false,
    endAt: new Date(Date.now() + 86_400_000),
    options: ["A", "B"],
  });
}

async function inviteFor(voteId: string, userId: string) {
  return prisma.voteInvite.findUniqueOrThrow({
    where: { voteId_inviteeUserId: { voteId, inviteeUserId: userId } },
  });
}

async function recordVote(userId: string, voteId: string) {
  const option = await prisma.option.findFirstOrThrow({
    where: { voteId, isAbstain: false },
  });
  await prisma.ballot.create({
    data: {
      voteId,
      pseudonym: "user_x",
      optionIds: JSON.stringify([option.id]),
      sequenceNumber: 1,
    },
  });
  await prisma.userVoteHistory.create({
    data: { userId, voteId, ballotSequenceNumber: 1 },
  });
}

describe("InviteService.createUsernameInvites", () => {
  it("creates an invite for a known user and reports unknown usernames", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);

    const result = await inviteService.createUsernameInvites(vote.id, creator.id, [
      "bob",
      "ghost",
    ]);

    expect(result.created).toHaveLength(1);
    expect(result.created[0]).toMatchObject({ username: "bob", status: "INVITED" });
    expect(result.notFound).toEqual(["ghost"]);
    expect(result.duplicates).toEqual([]);

    const invite = await inviteFor(vote.id, bob.id);
    expect(invite.status).toBe("INVITED");
    expect(invite.expiresAt).toBeNull();
    expect(invite.acceptedAt).toBeNull();
  });

  it("trims and dedupes usernames", async () => {
    const creator = await makeUser("creator");
    await makeUser("bob");
    const vote = await makeModeBVote(creator.id);

    const result = await inviteService.createUsernameInvites(vote.id, creator.id, [
      " bob ",
      "bob",
      "   ",
    ]);

    expect(result.created).toHaveLength(1);
    expect(
      await prisma.voteInvite.count({ where: { voteId: vote.id } })
    ).toBe(1);
  });

  it("reports an existing non-removed invite as a duplicate", async () => {
    const creator = await makeUser("creator");
    await makeUser("bob");
    const vote = await makeModeBVote(creator.id);

    await inviteService.createUsernameInvites(vote.id, creator.id, ["bob"]);
    const second = await inviteService.createUsernameInvites(vote.id, creator.id, ["bob"]);

    expect(second.created).toEqual([]);
    expect(second.duplicates).toEqual(["bob"]);
    expect(second.notFound).toEqual([]);
  });

  it("lets a username invite be accepted one day later because it never expires", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(vote.id, creator.id, ["bob"]);

    const invite = await inviteFor(vote.id, bob.id);
    expect(invite.expiresAt).toBeNull();

    // createdAt is irrelevant to acceptance; only expiresAt (null) matters.
    await prisma.voteInvite.update({
      where: { id: invite.id },
      data: { createdAt: new Date(Date.now() - 86_400_000) },
    });

    const accepted = await inviteService.acceptInviteById(invite.id, bob);
    expect(accepted.status).toBe("ACCEPTED");
  });

  it("can re-invite a removed username and revive the same row", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(vote.id, creator.id, ["bob"]);
    const original = await inviteFor(vote.id, bob.id);
    await inviteService.removeInvite(vote.id, original.id, creator.id);

    const result = await inviteService.createUsernameInvites(vote.id, creator.id, ["bob"]);

    expect(result.created).toHaveLength(1);
    expect(result.created[0].username).toBe("bob");
    expect(result.duplicates).toEqual([]);
    const revived = await inviteFor(vote.id, bob.id);
    expect(revived.id).toBe(original.id);
    expect(revived.status).toBe("INVITED");
    expect(revived.removedAt).toBeNull();
    expect(revived.acceptedAt).toBeNull();
    expect(revived.expiresAt).toBeNull();
  });

  it("rejects empty lists and more than 200 usernames", async () => {
    const creator = await makeUser("creator");
    const vote = await makeModeBVote(creator.id);

    await expectAppError(
      inviteService.createUsernameInvites(vote.id, creator.id, []),
      400
    );
    await expectAppError(
      inviteService.createUsernameInvites(vote.id, creator.id, [" ", ""]),
      400
    );
    await expectAppError(
      inviteService.createUsernameInvites(
        vote.id,
        creator.id,
        Array.from({ length: 201 }, (_, i) => `u${i}`)
      ),
      400
    );
  });

  it("rejects mode A votes and non-creators", async () => {
    const creator = await makeUser("creator");
    const stranger = await makeUser("stranger");
    await makeUser("bob");
    const voteA = await makeModeAVote(creator.id);

    await expectAppError(
      inviteService.createUsernameInvites(voteA.id, creator.id, ["bob"]),
      400
    );

    const voteB = await makeModeBVote(creator.id);
    await expectAppError(
      inviteService.createUsernameInvites(voteB.id, stranger.id, ["bob"]),
      403
    );
  });

  it("rejects invite creation once a mode B vote has started", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(vote.id, creator.id, ["bob"]);
    const invite = await inviteFor(vote.id, bob.id);
    await inviteService.acceptInviteById(invite.id, bob);
    await inviteService.startVote(vote.id, creator.id);

    await expectAppError(
      inviteService.createUsernameInvites(vote.id, creator.id, ["bob"]),
      409
    );
  });
});

describe("InviteService.createLinkInvites", () => {
  it("creates one-person links with unique tokens expiring in seven days", async () => {
    const creator = await makeUser("creator");
    const vote = await makeModeBVote(creator.id);
    const before = Date.now();

    const result = await inviteService.createLinkInvites(vote.id, creator.id, 2);
    const after = Date.now();

    expect(result.links).toHaveLength(2);
    const tokens = result.links.map((link) => link.token);
    expect(new Set(tokens).size).toBe(2);
    for (const link of result.links) {
      expect(link.url).toBe(`/invite/${link.token}`);
      expect(link.token).toMatch(/^[0-9a-f]{48}$/);
    }

    const rows = await prisma.voteInvite.findMany({
      where: { voteId: vote.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.inviteeUserId).toBeNull();
      expect(row.status).toBe("INVITED");
      expect(row.expiresAt).toBeTruthy();
      const delta = row.expiresAt!.getTime() - before;
      expect(delta).toBeGreaterThanOrEqual(7 * 86_400_000 - 5_000);
      expect(row.expiresAt!.getTime() - after).toBeLessThanOrEqual(7 * 86_400_000 + 5_000);
    }
  });

  it("rejects invalid counts", async () => {
    const creator = await makeUser("creator");
    const vote = await makeModeBVote(creator.id);

    for (const count of [0, -1, 201, 1.5, Number.NaN]) {
      await expectAppError(
        inviteService.createLinkInvites(vote.id, creator.id, count),
        400
      );
    }
  });

  it("rejects mode A and started votes", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const voteA = await makeModeAVote(creator.id);
    await expectAppError(
      inviteService.createLinkInvites(voteA.id, creator.id, 1),
      400
    );

    const voteB = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(voteB.id, creator.id, ["bob"]);
    const invite = await inviteFor(voteB.id, bob.id);
    await inviteService.acceptInviteById(invite.id, bob);
    await inviteService.startVote(voteB.id, creator.id);

    await expectAppError(
      inviteService.createLinkInvites(voteB.id, creator.id, 1),
      409
    );
  });
});

describe("InviteService.getInviteByToken", () => {
  it("returns landing-page info without any real name", async () => {
    const creator = await makeUser("creator");
    const vote = await makeModeBVote(creator.id);
    const { links } = await inviteService.createLinkInvites(vote.id, creator.id, 1);

    const info = await inviteService.getInviteByToken(links[0].token);

    expect(info).toMatchObject({
      voteId: vote.id,
      title: vote.title,
      phase: "DRAFT",
      accepted: false,
    });
    expect(info.expiresAt).toBeTruthy();
    expect(info).not.toHaveProperty("realName");
    expect(info).not.toHaveProperty("username");
  });

  it("returns 404 for missing and removed tokens", async () => {
    const creator = await makeUser("creator");
    const vote = await makeModeBVote(creator.id);
    const { links } = await inviteService.createLinkInvites(vote.id, creator.id, 1);

    await expectAppError(inviteService.getInviteByToken("nope"), 404);

    await prisma.voteInvite.update({
      where: { id: links[0].id },
      data: { status: "REMOVED", removedAt: new Date() },
    });
    await expectAppError(inviteService.getInviteByToken(links[0].token), 404);
  });

  it("returns 410 for an expired unaccepted token", async () => {
    const creator = await makeUser("creator");
    const vote = await makeModeBVote(creator.id);
    const { links } = await inviteService.createLinkInvites(vote.id, creator.id, 1);
    await prisma.voteInvite.update({
      where: { id: links[0].id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    await expectAppError(inviteService.getInviteByToken(links[0].token), 410);
  });

  it("keeps an accepted token visible after its expiry", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    const { links } = await inviteService.createLinkInvites(vote.id, creator.id, 1);
    await inviteService.acceptInvite(links[0].token, bob);
    await prisma.voteInvite.update({
      where: { id: links[0].id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const info = await inviteService.getInviteByToken(links[0].token);
    expect(info.accepted).toBe(true);
  });
});

describe("InviteService.acceptInvite", () => {
  it("binds a link token to the accepting user and is idempotent", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    const { links } = await inviteService.createLinkInvites(vote.id, creator.id, 1);

    const first = await inviteService.acceptInvite(links[0].token, bob);
    expect(first.id).toBe(links[0].id);
    expect(first.inviteeUserId).toBe(bob.id);
    expect(first.status).toBe("ACCEPTED");
    expect(first.acceptedAt).toBeTruthy();

    const second = await inviteService.acceptInvite(links[0].token, bob);
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("ACCEPTED");
  });

  it("accepts in DRAFT and in LIVE, but not after ENDED", async () => {
    const creator = await makeUser("creator");
    const alice = await makeUser("alice");
    const bob = await makeUser("bob");
    const carol = await makeUser("carol");
    const vote = await makeModeBVote(creator.id);

    // Created and accepted while the vote is still DRAFT.
    await inviteService.createUsernameInvites(vote.id, creator.id, ["alice"]);
    const aliceInvite = await inviteFor(vote.id, alice.id);
    const acceptedDraft = await inviteService.acceptInviteById(aliceInvite.id, alice);
    expect(acceptedDraft.status).toBe("ACCEPTED");
    expect(getVotePhase(vote)).toBe("DRAFT");

    // A link created in DRAFT can still be accepted after the vote starts.
    const { links } = await inviteService.createLinkInvites(vote.id, creator.id, 2);
    await inviteService.startVote(vote.id, creator.id);

    const acceptedLive = await inviteService.acceptInvite(links[0].token, bob);
    expect(acceptedLive.status).toBe("ACCEPTED");
    expect(acceptedLive.inviteeUserId).toBe(bob.id);

    await prisma.vote.update({
      where: { id: vote.id },
      data: { closedAt: new Date() },
    });
    await expectAppError(inviteService.acceptInvite(links[1].token, carol), 409);
  });

  it("rejects a token already bound to another user", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const carol = await makeUser("carol");
    const vote = await makeModeBVote(creator.id);
    const { links } = await inviteService.createLinkInvites(vote.id, creator.id, 1);
    await inviteService.acceptInvite(links[0].token, bob);

    await expectAppError(inviteService.acceptInvite(links[0].token, carol), 409);
  });

  it("rejects missing, removed and expired tokens", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    const { links } = await inviteService.createLinkInvites(vote.id, creator.id, 2);

    await expectAppError(inviteService.acceptInvite("missing", bob), 404);

    await prisma.voteInvite.update({
      where: { id: links[0].id },
      data: { status: "REMOVED", removedAt: new Date() },
    });
    await expectAppError(inviteService.acceptInvite(links[0].token, bob), 410);

    await prisma.voteInvite.update({
      where: { id: links[1].id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await expectAppError(inviteService.acceptInvite(links[1].token, bob), 410);
  });

  it("marks the token invite removed and returns the user's existing invite", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(vote.id, creator.id, ["bob"]);
    const existing = await inviteFor(vote.id, bob.id);
    const { links } = await inviteService.createLinkInvites(vote.id, creator.id, 1);

    const result = await inviteService.acceptInvite(links[0].token, bob);

    expect(result.id).toBe(existing.id);
    const tokenRow = await prisma.voteInvite.findUniqueOrThrow({
      where: { id: links[0].id },
    });
    expect(tokenRow.status).toBe("REMOVED");
    expect(tokenRow.inviteeUserId).toBeNull();
  });

  it("deletes the user's REMOVED row before binding the token", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(vote.id, creator.id, ["bob"]);
    const removed = await inviteFor(vote.id, bob.id);
    await inviteService.removeInvite(vote.id, removed.id, creator.id);
    const { links } = await inviteService.createLinkInvites(vote.id, creator.id, 1);

    const accepted = await inviteService.acceptInvite(links[0].token, bob);

    expect(accepted.id).toBe(links[0].id);
    expect(accepted.status).toBe("ACCEPTED");
    const rows = await prisma.voteInvite.findMany({
      where: { voteId: vote.id, inviteeUserId: bob.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(links[0].id);
  });
});

describe("InviteService.acceptInviteById", () => {
  it("accepts the user's own username invite and is idempotent", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(vote.id, creator.id, ["bob"]);
    const invite = await inviteFor(vote.id, bob.id);

    const accepted = await inviteService.acceptInviteById(invite.id, bob);
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.acceptedAt).toBeTruthy();

    const again = await inviteService.acceptInviteById(invite.id, bob);
    expect(again.id).toBe(invite.id);
    expect(again.status).toBe("ACCEPTED");
  });

  it("throws 404 for a missing invite or another user's invite", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const carol = await makeUser("carol");
    const vote = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(vote.id, creator.id, ["bob"]);
    const invite = await inviteFor(vote.id, bob.id);

    await expectAppError(inviteService.acceptInviteById("missing", bob), 404);
    await expectAppError(inviteService.acceptInviteById(invite.id, carol), 404);
  });

  it("throws 404 for a removed invite and 409 for an ended vote", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(vote.id, creator.id, ["bob"]);
    const invite = await inviteFor(vote.id, bob.id);
    await inviteService.removeInvite(vote.id, invite.id, creator.id);

    await expectAppError(inviteService.acceptInviteById(invite.id, bob), 404);

    const endedVote = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(endedVote.id, creator.id, ["bob"]);
    const endedInvite = await inviteFor(endedVote.id, bob.id);
    await prisma.vote.update({
      where: { id: endedVote.id },
      data: { closedAt: new Date() },
    });

    await expectAppError(inviteService.acceptInviteById(endedInvite.id, bob), 409);
  });
});

describe("InviteService.removeInvite", () => {
  it("removes any invite in DRAFT", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(vote.id, creator.id, ["bob"]);
    const invite = await inviteFor(vote.id, bob.id);
    await inviteService.acceptInviteById(invite.id, bob);

    await inviteService.removeInvite(vote.id, invite.id, creator.id);

    const updated = await prisma.voteInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(updated.status).toBe("REMOVED");
    expect(updated.removedAt).toBeTruthy();
  });

  it("removes only non-voters while LIVE, treating unbound links as non-voters", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const carol = await makeUser("carol");
    const vote = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(vote.id, creator.id, ["bob", "carol"]);
    const bobInvite = await inviteFor(vote.id, bob.id);
    const carolInvite = await inviteFor(vote.id, carol.id);
    await inviteService.acceptInviteById(bobInvite.id, bob);
    await inviteService.acceptInviteById(carolInvite.id, carol);
    const { links } = await inviteService.createLinkInvites(vote.id, creator.id, 1);
    await inviteService.startVote(vote.id, creator.id);
    await recordVote(bob.id, vote.id);

    await expectAppError(
      inviteService.removeInvite(vote.id, bobInvite.id, creator.id),
      409
    );
    await inviteService.removeInvite(vote.id, carolInvite.id, creator.id);
    await inviteService.removeInvite(vote.id, links[0].id, creator.id);

    expect(
      (await prisma.voteInvite.findUniqueOrThrow({ where: { id: carolInvite.id } })).status
    ).toBe("REMOVED");
    expect(
      (await prisma.voteInvite.findUniqueOrThrow({ where: { id: links[0].id } })).status
    ).toBe("REMOVED");
  });

  it("rejects removal after the vote has ended", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(vote.id, creator.id, ["bob"]);
    const invite = await inviteFor(vote.id, bob.id);
    await prisma.vote.update({ where: { id: vote.id }, data: { closedAt: new Date() } });

    await expectAppError(inviteService.removeInvite(vote.id, invite.id, creator.id), 409);
  });

  it("is idempotent for an already removed invite", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(vote.id, creator.id, ["bob"]);
    const invite = await inviteFor(vote.id, bob.id);
    await inviteService.removeInvite(vote.id, invite.id, creator.id);
    const removedAt = (
      await prisma.voteInvite.findUniqueOrThrow({ where: { id: invite.id } })
    ).removedAt;

    await inviteService.removeInvite(vote.id, invite.id, creator.id);

    const updated = await prisma.voteInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(updated.status).toBe("REMOVED");
    expect(updated.removedAt).toEqual(removedAt);
  });

  it("rejects non-creators and invites from another vote", async () => {
    const creator = await makeUser("creator");
    const stranger = await makeUser("stranger");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    const other = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(vote.id, creator.id, ["bob"]);
    const invite = await inviteFor(vote.id, bob.id);

    await expectAppError(
      inviteService.removeInvite(vote.id, invite.id, stranger.id),
      403
    );
    await expectAppError(
      inviteService.removeInvite(other.id, invite.id, creator.id),
      404
    );
  });
});

describe("InviteService.startVote", () => {
  it("starts a mode B vote with a duration-based window", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id, 90);
    await inviteService.createUsernameInvites(vote.id, creator.id, ["bob"]);
    const invite = await inviteFor(vote.id, bob.id);
    await inviteService.acceptInviteById(invite.id, bob);

    const before = Date.now();
    const started = await inviteService.startVote(vote.id, creator.id);
    const after = Date.now();

    expect(started.startedAt).toBeTruthy();
    expect(started.startAt.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    expect(started.startAt.getTime()).toBeLessThanOrEqual(after + 1_000);
    expect(started.startedAt!.getTime()).toBe(started.startAt.getTime());
    expect(started.endAt.getTime()).toBe(
      started.startAt.getTime() + 90 * 60_000
    );
    expect(getVotePhase(started)).toBe("LIVE");
  });

  it("requires at least one accepted invitee", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(vote.id, creator.id, ["bob"]);

    const error = await expectAppError(inviteService.startVote(vote.id, creator.id), 409);
    expect(error.message).toBe("至少需要一位已接受的受邀人");

    const emptyVote = await makeModeBVote(creator.id);
    await expectAppError(inviteService.startVote(emptyVote.id, creator.id), 409);
    expect(bob.id).toBeTruthy();
  });

  it("rejects mode A, non-creators and votes that already started", async () => {
    const creator = await makeUser("creator");
    const stranger = await makeUser("stranger");
    const bob = await makeUser("bob");
    const voteA = await makeModeAVote(creator.id);
    await expectAppError(inviteService.startVote(voteA.id, creator.id), 400);

    const voteB = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(voteB.id, creator.id, ["bob"]);
    const invite = await inviteFor(voteB.id, bob.id);
    await inviteService.acceptInviteById(invite.id, bob);

    await expectAppError(inviteService.startVote(voteB.id, stranger.id), 403);
    await inviteService.startVote(voteB.id, creator.id);
    await expectAppError(inviteService.startVote(voteB.id, creator.id), 409);
  });
});

describe("InviteService.listInvites", () => {
  it("returns usernames, decrypted real names, derived status and voted flags", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const carol = await makeUser("carol");
    await prisma.user.update({
      where: { id: bob.id },
      data: { realName: encrypt("鲍勃") },
    });
    const vote = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(vote.id, creator.id, ["bob", "carol"]);
    const bobInvite = await inviteFor(vote.id, bob.id);
    await inviteService.acceptInviteById(bobInvite.id, bob);
    const { links } = await inviteService.createLinkInvites(vote.id, creator.id, 1);
    await recordVote(bob.id, vote.id);

    const invites = await inviteService.listInvites(vote.id, creator);

    const bobRow = invites.find((invite) => invite.id === bobInvite.id);
    expect(bobRow).toMatchObject({
      username: "bob",
      realName: "鲍勃",
      status: "ACCEPTED",
      voted: true,
    });
    expect(bobRow?.acceptedAt).toBeTruthy();
    expect(bobRow?.expiresAt).toBeNull();

    const carolRow = invites.find((invite) => invite.username === "carol");
    expect(carolRow).toMatchObject({ status: "INVITED", voted: false });

    const linkRow = invites.find((invite) => invite.id === links[0].id);
    expect(linkRow).toMatchObject({
      username: null,
      realName: null,
      status: "INVITED",
      voted: false,
    });
  });

  it("derives EXPIRED for expired unaccepted invites", async () => {
    const creator = await makeUser("creator");
    await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    const { links } = await inviteService.createLinkInvites(vote.id, creator.id, 1);
    await prisma.voteInvite.update({
      where: { id: links[0].id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const invites = await inviteService.listInvites(vote.id, creator);
    expect(invites[0].status).toBe("EXPIRED");
  });

  it("lets an admin list invites but rejects other users and mode A votes", async () => {
    const creator = await makeUser("creator");
    const admin = await makeUser("admin");
    await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    const stranger = await makeUser("stranger");
    const vote = await makeModeBVote(creator.id);
    await inviteService.createLinkInvites(vote.id, creator.id, 1);

    const invites = await inviteService.listInvites(vote.id, {
      id: admin.id,
      role: "ADMIN",
    });
    expect(invites).toHaveLength(1);

    await expectAppError(inviteService.listInvites(vote.id, stranger), 403);

    const voteA = await makeModeAVote(creator.id);
    await expectAppError(inviteService.listInvites(voteA.id, creator), 400);
  });
});

describe("InviteService.getMyInvites", () => {
  it("returns pending and accepted invites newest first with vote and creator info", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob", "APPROVED");
    const older = await makeModeBVote(creator.id);
    await prisma.vote.update({ where: { id: older.id }, data: { title: "较早的投票" } });
    await inviteService.createUsernameInvites(older.id, creator.id, ["bob"]);
    const olderInvite = await inviteFor(older.id, bob.id);
    await prisma.voteInvite.update({
      where: { id: olderInvite.id },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });

    const newer = await makeModeBVote(creator.id);
    await prisma.vote.update({ where: { id: newer.id }, data: { title: "较新的投票" } });
    await inviteService.createUsernameInvites(newer.id, creator.id, ["bob"]);
    const newerInvite = await inviteFor(newer.id, bob.id);
    await inviteService.acceptInviteById(newerInvite.id, bob);

    const invites = await inviteService.getMyInvites(bob.id);

    expect(invites).toHaveLength(2);
    expect(invites[0]).toMatchObject({
      inviteId: newerInvite.id,
      voteId: newer.id,
      voteTitle: "较新的投票",
      creatorUsername: "creator",
      status: "ACCEPTED",
      phase: "DRAFT",
      expiresAt: null,
    });
    expect(invites[1]).toMatchObject({
      inviteId: olderInvite.id,
      voteId: older.id,
      voteTitle: "较早的投票",
      status: "INVITED",
    });
  });

  it("excludes removed invites and derives EXPIRED for expired links", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    const removedVote = await makeModeBVote(creator.id);
    const linkVote = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(vote.id, creator.id, ["bob"]);
    const invite = await inviteFor(vote.id, bob.id);
    await inviteService.createUsernameInvites(removedVote.id, creator.id, ["bob"]);
    const removedInvite = await inviteFor(removedVote.id, bob.id);
    await inviteService.removeInvite(removedVote.id, removedInvite.id, creator.id);

    const { links } = await inviteService.createLinkInvites(linkVote.id, creator.id, 1);
    await prisma.voteInvite.update({
      where: { id: links[0].id },
      data: { inviteeUserId: bob.id, expiresAt: new Date(Date.now() - 1_000) },
    });

    const invites = await inviteService.getMyInvites(bob.id);

    expect(invites.map((item) => item.inviteId).sort()).toEqual(
      [invite.id, links[0].id].sort()
    );
    const expired = invites.find((item) => item.inviteId === links[0].id);
    expect(expired?.status).toBe("EXPIRED");
  });
});

function tokenFor(userId: string) {
  return jwt.sign({ userId }, process.env.JWT_SECRET || "test-secret-key", {
    expiresIn: "7d",
  });
}

describe("invite routes", () => {
  it("serves public token info and accepts a link with auth", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    const { links } = await inviteService.createLinkInvites(vote.id, creator.id, 1);
    const app = createApp();

    const info = await request(app).get(`/api/invites/${links[0].token}`);
    expect(info.status).toBe(200);
    expect(info.body.invite).toMatchObject({
      voteId: vote.id,
      title: vote.title,
      accepted: false,
    });

    const anonymous = await request(app).post(
      `/api/invites/${links[0].token}/accept`
    );
    expect(anonymous.status).toBe(401);

    const accepted = await request(app)
      .post(`/api/invites/${links[0].token}/accept`)
      .set("Authorization", `Bearer ${tokenFor(bob.id)}`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.invite.status).toBe("ACCEPTED");
  });

  it("serves my invites and accept-by-id before /:id", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(vote.id, creator.id, ["bob"]);
    const invite = await inviteFor(vote.id, bob.id);
    const app = createApp();

    const mine = await request(app)
      .get("/api/votes/my/invites")
      .set("Authorization", `Bearer ${tokenFor(bob.id)}`);
    expect(mine.status).toBe(200);
    expect(mine.body.invites).toHaveLength(1);
    expect(mine.body.invites[0].inviteId).toBe(invite.id);

    const accepted = await request(app)
      .post(`/api/votes/my/invites/${invite.id}/accept`)
      .set("Authorization", `Bearer ${tokenFor(bob.id)}`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.invite.status).toBe("ACCEPTED");
  });

  it("creates invites, lists them, removes one and starts the vote", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    const app = createApp();
    const auth = `Bearer ${tokenFor(creator.id)}`;

    const created = await request(app)
      .post(`/api/votes/${vote.id}/invites/usernames`)
      .set("Authorization", auth)
      .send({ usernames: ["bob", "ghost"] });
    expect(created.status).toBe(201);
    expect(created.body.notFound).toEqual(["ghost"]);

    const links = await request(app)
      .post(`/api/votes/${vote.id}/invites/links`)
      .set("Authorization", auth)
      .send({ count: 1 });
    expect(links.status).toBe(201);
    expect(links.body.links).toHaveLength(1);

    const list = await request(app)
      .get(`/api/votes/${vote.id}/invites`)
      .set("Authorization", auth);
    expect(list.status).toBe(200);
    expect(list.body.invites).toHaveLength(2);

    const bobInvite = await inviteFor(vote.id, bob.id);
    const removed = await request(app)
      .delete(`/api/votes/${vote.id}/invites/${links.body.links[0].id}`)
      .set("Authorization", auth);
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ ok: true });

    const accepted = await request(app)
      .post(`/api/votes/my/invites/${bobInvite.id}/accept`)
      .set("Authorization", `Bearer ${tokenFor(bob.id)}`);
    expect(accepted.status).toBe(200);

    const started = await request(app)
      .post(`/api/votes/${vote.id}/start`)
      .set("Authorization", auth);
    expect(started.status).toBe(200);
    expect(getVotePhase(started.body.vote)).toBe("LIVE");
  });
});
