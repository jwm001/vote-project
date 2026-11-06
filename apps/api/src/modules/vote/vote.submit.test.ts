import { beforeEach, describe, expect, it } from "vitest";
import { InviteService } from "./invite.service";
import { VoteService } from "./vote.service";
import { AppError } from "../../utils/errors";
import { prisma } from "../../utils/prisma";
import { resetDb } from "../../test/db";
import { resetRateLimits } from "../../utils/rate-limit";
import { makeUser } from "../../test/factories";

const voteService = new VoteService();
const inviteService = new InviteService();

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

function makeModeAVote(
  creatorId: string,
  options: { allowMultiple?: boolean; endAt?: Date } = {}
) {
  return voteService.createVote({
    creatorId,
    title: "公开投票",
    participationMode: "OPEN_LINK",
    allowMultiple: options.allowMultiple ?? false,
    endAt: options.endAt ?? new Date(Date.now() + 86_400_000),
    options: ["A", "B"],
  });
}

function makeModeBVote(
  creatorId: string,
  options: { allowMultiple?: boolean; durationMinutes?: number } = {}
) {
  return voteService.createVote({
    creatorId,
    title: "邀请制投票",
    participationMode: "INVITE_ONLY",
    allowMultiple: options.allowMultiple ?? false,
    durationMinutes: options.durationMinutes ?? 60,
    options: ["A", "B"],
  });
}

async function optionsOf(voteId: string) {
  const options = await prisma.option.findMany({
    where: { voteId },
    orderBy: { order: "asc" },
  });
  const regular = options.filter((option) => !option.isAbstain);
  return {
    options,
    first: regular[0],
    second: regular[1],
    abstain: options.find((option) => option.isAbstain)!,
  };
}

async function startVoteNow(voteId: string) {
  const now = new Date();
  return prisma.vote.update({
    where: { id: voteId },
    data: {
      startedAt: now,
      startAt: now,
      endAt: new Date(now.getTime() + 3_600_000),
    },
  });
}

async function addInvite(
  voteId: string,
  userId: string,
  status: "INVITED" | "ACCEPTED" | "REMOVED"
) {
  return prisma.voteInvite.create({
    data: {
      voteId,
      inviteeUserId: userId,
      status,
      acceptedAt: status === "ACCEPTED" ? new Date() : null,
      removedAt: status === "REMOVED" ? new Date() : null,
    },
  });
}

async function inviteFor(voteId: string, userId: string) {
  return prisma.voteInvite.findUniqueOrThrow({
    where: { voteId_inviteeUserId: { voteId, inviteeUserId: userId } },
  });
}

async function closedAtOf(voteId: string) {
  return (await prisma.vote.findUniqueOrThrow({ where: { id: voteId } })).closedAt;
}

describe("VoteService.submitVote", () => {
  it("stores a mode A ballot with the selected ids in order", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");
    const vote = await makeModeAVote(creator.id, { allowMultiple: true });
    const { first, second } = await optionsOf(vote.id);

    const result = await voteService.submitVote({
      userId: voter.id,
      voteId: vote.id,
      optionIds: [second.id, first.id],
    });

    expect(JSON.parse(result.ballot.optionIds)).toEqual([second.id, first.id]);
    expect(result.sequenceNumber).toBe(1);
    expect(result.ballot.sequenceNumber).toBe(1);
    expect(result.pseudonym).toMatch(/^user_/);

    const history = await prisma.userVoteHistory.findUniqueOrThrow({
      where: { userId_voteId: { userId: voter.id, voteId: vote.id } },
    });
    expect(history.ballotSequenceNumber).toBe(result.ballot.sequenceNumber);
  });

  it("rejects a mode B draft even when its placeholder endAt is in the past", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");
    const vote = await makeModeBVote(creator.id);
    await prisma.vote.update({
      where: { id: vote.id },
      data: { endAt: new Date(Date.now() - 60_000) },
    });
    await addInvite(vote.id, voter.id, "ACCEPTED");
    const { first } = await optionsOf(vote.id);

    await expectAppError(
      voteService.submitVote({
        userId: voter.id,
        voteId: vote.id,
        optionIds: [first.id],
      }),
      409,
      "投票尚未开始"
    );

    expect(await prisma.ballot.count({ where: { voteId: vote.id } })).toBe(0);
  });

  it("rejects ended votes for both modes", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");

    // Mode B closed manually.
    const closed = await makeModeBVote(creator.id);
    await startVoteNow(closed.id);
    await addInvite(closed.id, voter.id, "ACCEPTED");
    await prisma.vote.update({
      where: { id: closed.id },
      data: { closedAt: new Date() },
    });
    let options = await optionsOf(closed.id);
    await expectAppError(
      voteService.submitVote({
        userId: voter.id,
        voteId: closed.id,
        optionIds: [options.first.id],
      }),
      409,
      "投票已结束"
    );

    // Mode B past its endAt.
    const expiredB = await makeModeBVote(creator.id);
    await startVoteNow(expiredB.id);
    await addInvite(expiredB.id, voter.id, "ACCEPTED");
    await prisma.vote.update({
      where: { id: expiredB.id },
      data: { endAt: new Date(Date.now() - 60_000) },
    });
    options = await optionsOf(expiredB.id);
    await expectAppError(
      voteService.submitVote({
        userId: voter.id,
        voteId: expiredB.id,
        optionIds: [options.first.id],
      }),
      409,
      "投票已结束"
    );

    // Mode A past its endAt.
    const expiredA = await makeModeAVote(creator.id);
    await prisma.vote.update({
      where: { id: expiredA.id },
      data: { endAt: new Date(Date.now() - 60_000) },
    });
    options = await optionsOf(expiredA.id);
    await expectAppError(
      voteService.submitVote({
        userId: voter.id,
        voteId: expiredA.id,
        optionIds: [options.first.id],
      }),
      409,
      "投票已结束"
    );
  });

  it("rejects mode B non-invitees, unaccepted invites and removed invites", async () => {
    const creator = await makeUser("creator");
    const stranger = await makeUser("stranger");
    const invited = await makeUser("invited");
    const removed = await makeUser("removed");
    const vote = await makeModeBVote(creator.id);
    await startVoteNow(vote.id);
    await addInvite(vote.id, invited.id, "INVITED");
    await addInvite(vote.id, removed.id, "REMOVED");
    const { first } = await optionsOf(vote.id);

    await expectAppError(
      voteService.submitVote({
        userId: stranger.id,
        voteId: vote.id,
        optionIds: [first.id],
      }),
      403,
      "请先接受邀请或不在名单中"
    );
    await expectAppError(
      voteService.submitVote({
        userId: invited.id,
        voteId: vote.id,
        optionIds: [first.id],
      }),
      403,
      "请先接受邀请或不在名单中"
    );
    await expectAppError(
      voteService.submitVote({
        userId: removed.id,
        voteId: vote.id,
        optionIds: [first.id],
      }),
      403,
      "请先接受邀请或不在名单中"
    );

    expect(await prisma.ballot.count({ where: { voteId: vote.id } })).toBe(0);
  });

  it("lets an accepted mode B invitee submit", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");
    const vote = await makeModeBVote(creator.id);
    await startVoteNow(vote.id);
    await addInvite(vote.id, voter.id, "ACCEPTED");
    const { first } = await optionsOf(vote.id);

    const result = await voteService.submitVote({
      userId: voter.id,
      voteId: vote.id,
      optionIds: [first.id],
    });

    expect(JSON.parse(result.ballot.optionIds)).toEqual([first.id]);
    expect(result.sequenceNumber).toBe(1);
  });

  it("lets an accepted link invite submit after its expiresAt has passed", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");
    const vote = await makeModeBVote(creator.id);
    const { links } = await inviteService.createLinkInvites(vote.id, creator.id, 1);
    await inviteService.acceptInvite(links[0].token, voter);
    await inviteService.startVote(vote.id, creator.id);
    await prisma.voteInvite.update({
      where: { id: links[0].id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const { first } = await optionsOf(vote.id);

    const result = await voteService.submitVote({
      userId: voter.id,
      voteId: vote.id,
      optionIds: [first.id],
    });

    expect(JSON.parse(result.ballot.optionIds)).toEqual([first.id]);
  });

  it("lets a single-choice voter submit abstain alone", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");
    const vote = await makeModeAVote(creator.id);
    const { abstain } = await optionsOf(vote.id);

    const result = await voteService.submitVote({
      userId: voter.id,
      voteId: vote.id,
      optionIds: [abstain.id],
    });

    expect(JSON.parse(result.ballot.optionIds)).toEqual([abstain.id]);
  });

  it("lets a multi-choice voter submit abstain alone", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");
    const vote = await makeModeAVote(creator.id, { allowMultiple: true });
    const { abstain } = await optionsOf(vote.id);

    const result = await voteService.submitVote({
      userId: voter.id,
      voteId: vote.id,
      optionIds: [abstain.id],
    });

    expect(JSON.parse(result.ballot.optionIds)).toEqual([abstain.id]);
  });

  it("rejects abstain combined with another option", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");
    const vote = await makeModeAVote(creator.id, { allowMultiple: true });
    const { first, abstain } = await optionsOf(vote.id);

    await expectAppError(
      voteService.submitVote({
        userId: voter.id,
        voteId: vote.id,
        optionIds: [first.id, abstain.id],
      }),
      400,
      "弃权不能与其他选项同时选择"
    );
  });

  it("rejects an empty selection", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");
    const vote = await makeModeAVote(creator.id, { allowMultiple: true });

    await expectAppError(
      voteService.submitVote({
        userId: voter.id,
        voteId: vote.id,
        optionIds: [],
      }),
      400,
      "请至少选择一个选项"
    );
  });

  it("rejects duplicate option ids", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");
    const vote = await makeModeAVote(creator.id, { allowMultiple: true });
    const { first } = await optionsOf(vote.id);

    await expectAppError(
      voteService.submitVote({
        userId: voter.id,
        voteId: vote.id,
        optionIds: [first.id, first.id],
      }),
      400,
      "不能重复选择同一个选项"
    );
  });

  it("rejects an option from another vote", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");
    const vote = await makeModeAVote(creator.id);
    const otherVote = await makeModeAVote(creator.id);
    const otherOptions = await optionsOf(otherVote.id);

    await expectAppError(
      voteService.submitVote({
        userId: voter.id,
        voteId: vote.id,
        optionIds: [otherOptions.first.id],
      }),
      400,
      "存在不属于本场投票的选项"
    );
  });

  it("rejects multiple ids for a single-choice vote", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");
    const vote = await makeModeAVote(creator.id);
    const { first, second } = await optionsOf(vote.id);

    await expectAppError(
      voteService.submitVote({
        userId: voter.id,
        voteId: vote.id,
        optionIds: [first.id, second.id],
      }),
      400,
      "本场投票为单选，只能选择一个选项"
    );
  });

  it("rejects a second submission by the same user", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");
    const vote = await makeModeAVote(creator.id);
    const { first } = await optionsOf(vote.id);

    await voteService.submitVote({
      userId: voter.id,
      voteId: vote.id,
      optionIds: [first.id],
    });

    await expectAppError(
      voteService.submitVote({
        userId: voter.id,
        voteId: vote.id,
        optionIds: [first.id],
      }),
      409,
      "你已参与过本场投票"
    );
    expect(await prisma.ballot.count({ where: { voteId: vote.id } })).toBe(1);
  });
});

describe("VoteService.submitVote auto-end", () => {
  it("closes a mode B vote once every bound invitee has voted", async () => {
    const creator = await makeUser("creator");
    const alice = await makeUser("alice");
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(vote.id, creator.id, ["alice", "bob"]);
    await inviteService.acceptInviteById((await inviteFor(vote.id, alice.id)).id, alice);
    await inviteService.acceptInviteById((await inviteFor(vote.id, bob.id)).id, bob);
    await inviteService.startVote(vote.id, creator.id);
    const { first } = await optionsOf(vote.id);

    await voteService.submitVote({
      userId: alice.id,
      voteId: vote.id,
      optionIds: [first.id],
    });
    expect(await closedAtOf(vote.id)).toBeNull();

    await voteService.submitVote({
      userId: bob.id,
      voteId: vote.id,
      optionIds: [first.id],
    });
    expect(await closedAtOf(vote.id)).not.toBeNull();
  });

  it("does not auto-end while a username invite is still unaccepted", async () => {
    const creator = await makeUser("creator");
    const alice = await makeUser("alice");
    const bob = await makeUser("bob");
    const carol = await makeUser("carol");
    const vote = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(vote.id, creator.id, [
      "alice",
      "bob",
      "carol",
    ]);
    await inviteService.acceptInviteById((await inviteFor(vote.id, alice.id)).id, alice);
    await inviteService.acceptInviteById((await inviteFor(vote.id, carol.id)).id, carol);
    await inviteService.startVote(vote.id, creator.id);
    const { first } = await optionsOf(vote.id);

    await voteService.submitVote({
      userId: alice.id,
      voteId: vote.id,
      optionIds: [first.id],
    });
    expect(await closedAtOf(vote.id)).toBeNull();

    // The unaccepted username invite blocks auto-end until it is removed.
    const bobInvite = await inviteFor(vote.id, bob.id);
    await inviteService.removeInvite(vote.id, bobInvite.id, creator.id);

    await voteService.submitVote({
      userId: carol.id,
      voteId: vote.id,
      optionIds: [first.id],
    });
    expect(await closedAtOf(vote.id)).not.toBeNull();
  });

  it("ignores unaccepted one-person link invites when auto-ending", async () => {
    const creator = await makeUser("creator");
    const alice = await makeUser("alice");
    const vote = await makeModeBVote(creator.id);
    await inviteService.createUsernameInvites(vote.id, creator.id, ["alice"]);
    await inviteService.acceptInviteById((await inviteFor(vote.id, alice.id)).id, alice);
    await inviteService.createLinkInvites(vote.id, creator.id, 1);
    await inviteService.startVote(vote.id, creator.id);
    const { first } = await optionsOf(vote.id);

    await voteService.submitVote({
      userId: alice.id,
      voteId: vote.id,
      optionIds: [first.id],
    });

    expect(await closedAtOf(vote.id)).not.toBeNull();
  });

  it("does not auto-end a mode A vote", async () => {
    const creator = await makeUser("creator");
    const alice = await makeUser("alice");
    const vote = await makeModeAVote(creator.id);
    const { first } = await optionsOf(vote.id);

    await voteService.submitVote({
      userId: alice.id,
      voteId: vote.id,
      optionIds: [first.id],
    });

    expect(await closedAtOf(vote.id)).toBeNull();
  });
});

describe("VoteService.submitVote concurrency", () => {
  it("allocates distinct sequence numbers for simultaneous submissions", async () => {
    const creator = await makeUser("creator");
    const alice = await makeUser("alice");
    const bob = await makeUser("bob");
    const vote = await makeModeAVote(creator.id);
    const { first } = await optionsOf(vote.id);

    const results = await Promise.all([
      voteService.submitVote({
        userId: alice.id,
        voteId: vote.id,
        optionIds: [first.id],
      }),
      voteService.submitVote({
        userId: bob.id,
        voteId: vote.id,
        optionIds: [first.id],
      }),
    ]);

    expect(results.map((result) => result.sequenceNumber).sort()).toEqual([1, 2]);

    const ballots = await prisma.ballot.findMany({
      where: { voteId: vote.id },
      orderBy: { sequenceNumber: "asc" },
    });
    expect(ballots.map((ballot) => ballot.sequenceNumber)).toEqual([1, 2]);

    const histories = await prisma.userVoteHistory.findMany({
      where: { voteId: vote.id },
    });
    expect(histories).toHaveLength(2);
    expect(histories.map((history) => history.ballotSequenceNumber).sort()).toEqual([
      1, 2,
    ]);
  });
});
