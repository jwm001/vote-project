import { beforeEach, describe, expect, it } from "vitest";
import { VoteService } from "./vote.service";
import { AppError } from "../../utils/errors";
import { prisma } from "../../utils/prisma";
import { resetDb } from "../../test/db";
import { resetRateLimits } from "../../utils/rate-limit";
import { makeUser } from "../../test/factories";

const voteService = new VoteService();

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

function viewerOf(user: { id: string; role: string; status: string }) {
  return { id: user.id, role: user.role, status: user.status };
}

describe("VoteService.getVoteById", () => {
  it("returns phase and viewer flags for the creator of a live OPEN_LINK vote", async () => {
    const creator = await makeUser("creator");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "OPEN_LINK",
      allowMultiple: false,
      endAt: new Date(Date.now() + 86_400_000),
      options: ["A", "B"],
    });

    const detail = await voteService.getVoteById(vote.id, viewerOf(creator));

    expect(detail.vote.phase).toBe("LIVE");
    expect(detail.vote.isCreator).toBe(true);
    expect(detail.vote.isInvitee).toBe(false);
    expect(detail.vote.canVote).toBe(true);
    expect(detail.vote.hasVoted).toBe(false);
    expect(detail.vote.votedCount).toBe(0);
    expect(detail.vote.eligibleCount).toBeNull();
  });

  it("marks hasVoted and disables canVote for an existing voter", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "OPEN_LINK",
      allowMultiple: false,
      endAt: new Date(Date.now() + 86_400_000),
      options: ["A", "B"],
    });
    const option = await prisma.option.findFirstOrThrow({ where: { voteId: vote.id, isAbstain: false } });
    await prisma.ballot.create({
      data: {
        voteId: vote.id,
        pseudonym: "user_x",
        optionIds: JSON.stringify([option.id]),
        sequenceNumber: 1,
      },
    });
    await prisma.userVoteHistory.create({
      data: { userId: voter.id, voteId: vote.id, ballotSequenceNumber: 1 },
    });

    const detail = await voteService.getVoteById(vote.id, viewerOf(voter));

    expect(detail.vote.hasVoted).toBe(true);
    expect(detail.vote.canVote).toBe(false);
    expect(detail.vote.votedCount).toBe(1);
  });

  it("throws 403 for a viewer who is not invited to a mode B vote", async () => {
    const creator = await makeUser("creator");
    const stranger = await makeUser("stranger");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "INVITE_ONLY",
      allowMultiple: false,
      durationMinutes: 60,
      options: ["A", "B"],
    });

    const error = await voteService
      .getVoteById(vote.id, viewerOf(stranger))
      .then(
        () => null,
        (e: any) => e
      );
    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(403);
    expect(error.message).toBe("你不在本场受邀名单中");
  });

  it("lets an unaccepted mode B invitee view but not vote", async () => {
    const creator = await makeUser("creator");
    const invitee = await makeUser("invitee");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "INVITE_ONLY",
      allowMultiple: false,
      durationMinutes: 60,
      options: ["A", "B"],
    });
    await prisma.voteInvite.create({
      data: { voteId: vote.id, inviteeUserId: invitee.id, status: "INVITED" },
    });
    await prisma.vote.update({ where: { id: vote.id }, data: { startedAt: new Date() } });

    const detail = await voteService.getVoteById(vote.id, viewerOf(invitee));

    expect(detail.vote.phase).toBe("LIVE");
    expect(detail.vote.isInvitee).toBe(true);
    expect(detail.vote.canVote).toBe(false);
    expect(detail.vote.eligibleCount).toBe(1);
  });

  it("lets an accepted invitee vote once the vote is live", async () => {
    const creator = await makeUser("creator");
    const invitee = await makeUser("invitee");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "INVITE_ONLY",
      allowMultiple: false,
      durationMinutes: 60,
      options: ["A", "B"],
    });
    await prisma.voteInvite.create({
      data: { voteId: vote.id, inviteeUserId: invitee.id, status: "ACCEPTED", acceptedAt: new Date() },
    });
    await prisma.vote.update({ where: { id: vote.id }, data: { startedAt: new Date() } });

    const detail = await voteService.getVoteById(vote.id, viewerOf(invitee));

    expect(detail.vote.phase).toBe("LIVE");
    expect(detail.vote.isInvitee).toBe(true);
    expect(detail.vote.canVote).toBe(true);
  });

  it("rejects a live mode B creator without a valid invite from voting", async () => {
    const creator = await makeUser("creator");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "INVITE_ONLY",
      allowMultiple: false,
      durationMinutes: 60,
      options: ["A", "B"],
    });
    await prisma.vote.update({ where: { id: vote.id }, data: { startedAt: new Date() } });

    const detail = await voteService.getVoteById(vote.id, viewerOf(creator));

    expect(detail.vote.phase).toBe("LIVE");
    expect(detail.vote.isInvitee).toBe(false);
    expect(detail.vote.isCreator).toBe(true);
    expect(detail.vote.canVote).toBe(false);
  });

  it("lets a mode B creator who accepted their own invite vote once live", async () => {
    const creator = await makeUser("creator");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "INVITE_ONLY",
      allowMultiple: false,
      durationMinutes: 60,
      options: ["A", "B"],
    });
    await prisma.voteInvite.create({
      data: { voteId: vote.id, inviteeUserId: creator.id, status: "ACCEPTED", acceptedAt: new Date() },
    });
    await prisma.vote.update({ where: { id: vote.id }, data: { startedAt: new Date() } });

    const detail = await voteService.getVoteById(vote.id, viewerOf(creator));

    expect(detail.vote.phase).toBe("LIVE");
    expect(detail.vote.isInvitee).toBe(true);
    expect(detail.vote.canVote).toBe(true);
  });

  it("throws 403 for an expired mode B invite", async () => {
    const creator = await makeUser("creator");
    const invitee = await makeUser("invitee");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "INVITE_ONLY",
      allowMultiple: false,
      durationMinutes: 60,
      options: ["A", "B"],
    });
    await prisma.voteInvite.create({
      data: { voteId: vote.id, inviteeUserId: invitee.id, status: "ACCEPTED", acceptedAt: new Date(), expiresAt: new Date(Date.now() - 60_000) },
    });
    await prisma.vote.update({ where: { id: vote.id }, data: { startedAt: new Date() } });

    await expect(voteService.getVoteById(vote.id, viewerOf(invitee))).rejects.toMatchObject({ status: 403 });
  });

  it("returns the ENDED phase and disables canVote for an ended vote", async () => {
    const creator = await makeUser("creator");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "OPEN_LINK",
      allowMultiple: false,
      endAt: new Date(Date.now() + 86_400_000),
      options: ["A", "B"],
    });
    await prisma.vote.update({ where: { id: vote.id }, data: { closedAt: new Date() } });

    const detail = await voteService.getVoteById(vote.id, viewerOf(creator));

    expect(detail.vote.phase).toBe("ENDED");
    expect(detail.vote.canVote).toBe(false);
  });

  it("disables canVote for an approved user without an accepted invite and for a non-approved accepted invitee", async () => {
    const creator = await makeUser("creator");
    const invitee = await makeUser("invitee");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "INVITE_ONLY",
      allowMultiple: false,
      durationMinutes: 60,
      options: ["A", "B"],
    });
    await prisma.voteInvite.create({
      data: { voteId: vote.id, inviteeUserId: invitee.id, status: "ACCEPTED", acceptedAt: new Date() },
    });
    await prisma.vote.update({ where: { id: vote.id }, data: { startedAt: new Date() } });

    const pendingAccepted = await makeUser("pending_accepted", "PENDING_VERIFICATION");
    await prisma.voteInvite.create({
      data: { voteId: vote.id, inviteeUserId: pendingAccepted.id, status: "ACCEPTED", acceptedAt: new Date() },
    });

    const unaccepted = await makeUser("unaccepted");
    const unacceptedVote = await voteService.createVote({
      creatorId: creator.id,
      title: "T2",
      participationMode: "INVITE_ONLY",
      allowMultiple: false,
      durationMinutes: 60,
      options: ["A", "B"],
    });
    await prisma.voteInvite.create({
      data: { voteId: unacceptedVote.id, inviteeUserId: unaccepted.id, status: "INVITED" },
    });
    await prisma.vote.update({ where: { id: unacceptedVote.id }, data: { startedAt: new Date() } });

    const acceptedDetail = await voteService.getVoteById(vote.id, viewerOf(pendingAccepted));
    expect(acceptedDetail.vote.canVote).toBe(false);

    const unacceptedDetail = await voteService.getVoteById(unacceptedVote.id, viewerOf(unaccepted));
    expect(unacceptedDetail.vote.isInvitee).toBe(true);
    expect(unacceptedDetail.vote.canVote).toBe(false);
  });

  it("returns eligibleCount of non-removed invites for mode B and null for mode A", async () => {
    const creator = await makeUser("creator");
    const voteA = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "OPEN_LINK",
      allowMultiple: false,
      endAt: new Date(Date.now() + 86_400_000),
      options: ["A", "B"],
    });
    const voteADetail = await voteService.getVoteById(voteA.id, viewerOf(creator));
    expect(voteADetail.vote.eligibleCount).toBeNull();

    const invitee = await makeUser("invitee");
    const voteB = await voteService.createVote({
      creatorId: creator.id,
      title: "T2",
      participationMode: "INVITE_ONLY",
      allowMultiple: false,
      durationMinutes: 60,
      options: ["A", "B"],
    });
    await prisma.voteInvite.create({
      data: { voteId: voteB.id, inviteeUserId: invitee.id, status: "ACCEPTED", acceptedAt: new Date() },
    });
    const removedInvitee = await makeUser("removed_invitee");
    await prisma.voteInvite.create({
      data: { voteId: voteB.id, inviteeUserId: removedInvitee.id, status: "REMOVED", removedAt: new Date() },
    });

    const voteBDetail = await voteService.getVoteById(voteB.id, viewerOf(creator));
    expect(voteBDetail.vote.eligibleCount).toBe(1);
  });
});

describe("VoteService.getMyVotes", () => {
  it("returns created votes with the CREATOR relation", async () => {
    const creator = await makeUser("creator");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "OPEN_LINK",
      allowMultiple: false,
      endAt: new Date(Date.now() + 86_400_000),
      options: ["A", "B"],
    });

    const mine = await voteService.getMyVotes(creator.id);

    expect(mine).toHaveLength(1);
    expect(mine[0].relation).toBe("CREATOR");
    expect(mine[0].voteId).toBe(vote.id);
    expect(mine[0].voteTitle).toBe("T");
    expect(mine[0].participationMode).toBe("OPEN_LINK");
    expect(mine[0].phase).toBe("LIVE");
    expect(mine[0].allowMultiple).toBe(false);
    expect(mine[0].votedCount).toBe(0);
    expect(mine[0].eligibleCount).toBeNull();
  });

  it("returns participated votes with the PARTICIPANT relation and ballot info", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "OPEN_LINK",
      allowMultiple: false,
      endAt: new Date(Date.now() + 86_400_000),
      options: ["A", "B"],
    });
    const option = await prisma.option.findFirstOrThrow({ where: { voteId: vote.id, isAbstain: false } });
    await prisma.ballot.create({
      data: { voteId: vote.id, pseudonym: "user_x", optionIds: JSON.stringify([option.id]), sequenceNumber: 1 },
    });
    await prisma.userVoteHistory.create({
      data: { userId: voter.id, voteId: vote.id, ballotSequenceNumber: 1 },
    });

    const mine = await voteService.getMyVotes(voter.id);

    expect(mine).toHaveLength(1);
    expect(mine[0].relation).toBe("PARTICIPANT");
    expect(mine[0].voteId).toBe(vote.id);
    expect(mine[0].pseudonym).toBe("user_x");
    expect(mine[0].sequenceNumber).toBe(1);
    expect(mine[0].submittedAt).toBeTruthy();
  });

  it("merges created and participated votes sorted newest first", async () => {
    const x = await makeUser("x");
    const y = await makeUser("y");
    const oldVote = await voteService.createVote({
      creatorId: y.id,
      title: "Old",
      participationMode: "OPEN_LINK",
      allowMultiple: false,
      endAt: new Date(Date.now() + 86_400_000),
      options: ["A", "B"],
    });
    const newVote = await voteService.createVote({
      creatorId: x.id,
      title: "New",
      participationMode: "OPEN_LINK",
      allowMultiple: false,
      endAt: new Date(Date.now() + 86_400_000),
      options: ["A", "B"],
    });
    const option = await prisma.option.findFirstOrThrow({ where: { voteId: oldVote.id, isAbstain: false } });
    await prisma.ballot.create({
      data: { voteId: oldVote.id, pseudonym: "user_x", optionIds: JSON.stringify([option.id]), sequenceNumber: 1 },
    });
    await prisma.userVoteHistory.create({
      data: { userId: x.id, voteId: oldVote.id, ballotSequenceNumber: 1 },
    });

    const mine = await voteService.getMyVotes(x.id);

    expect(mine).toHaveLength(2);
    expect(mine[0].relation).toBe("PARTICIPANT");
    expect(mine[0].voteId).toBe(oldVote.id);
    expect(mine[1].relation).toBe("CREATOR");
    expect(mine[1].voteId).toBe(newVote.id);
  });

  it("returns an empty list when the user has no votes", async () => {
    const user = await makeUser("nobody");
    expect(await voteService.getMyVotes(user.id)).toEqual([]);
  });

  it("sorts participant items by participation time descending", async () => {
    const y = await makeUser("y");
    const x = await makeUser("x");
    const older = await voteService.createVote({
      creatorId: y.id,
      title: "Older",
      participationMode: "OPEN_LINK",
      allowMultiple: false,
      endAt: new Date(Date.now() + 86_400_000),
      options: ["A", "B"],
    });
    const newer = await voteService.createVote({
      creatorId: y.id,
      title: "Newer",
      participationMode: "OPEN_LINK",
      allowMultiple: false,
      endAt: new Date(Date.now() + 86_400_000),
      options: ["A", "B"],
    });

    for (const vote of [older, newer]) {
      const option = await prisma.option.findFirstOrThrow({ where: { voteId: vote.id, isAbstain: false } });
      await prisma.ballot.create({
        data: { voteId: vote.id, pseudonym: "user_x", optionIds: JSON.stringify([option.id]), sequenceNumber: 1 },
      });
      await prisma.userVoteHistory.create({
        data: { userId: x.id, voteId: vote.id, ballotSequenceNumber: 1 },
      });
    }

    const mine = await voteService.getMyVotes(x.id);

    expect(mine).toHaveLength(2);
    expect(mine[0].relation).toBe("PARTICIPANT");
    expect(mine[0].voteId).toBe(newer.id);
    expect(mine[1].relation).toBe("PARTICIPANT");
    expect(mine[1].voteId).toBe(older.id);
  });
});
