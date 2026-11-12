import { beforeEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createApp } from "../../app";
import { VoteService } from "./vote.service";
import { prisma } from "../../utils/prisma";
import { resetDb } from "../../test/db";
import { resetRateLimits } from "../../utils/rate-limit";
import { makeUser } from "../../test/factories";

const voteService = new VoteService();

function tokenFor(userId: string) {
  return jwt.sign({ userId }, process.env.JWT_SECRET || "test-secret-key", {
    expiresIn: "7d",
  });
}

async function makeHallVote(
  creatorId: string,
  options: {
    title: string;
    listedInHall?: boolean;
    createdAt?: Date;
    endAt?: Date;
    closedAt?: Date | null;
  }
) {
  const vote = await voteService.createVote({
    creatorId,
    title: options.title,
    participationMode: "OPEN_LINK",
    allowMultiple: false,
    listedInHall: options.listedInHall ?? true,
    endAt: new Date(Date.now() + 86_400_000),
    options: ["A", "B"],
  });
  if (options.createdAt || options.closedAt || options.endAt) {
    return prisma.vote.update({
      where: { id: vote.id },
      data: {
        ...(options.createdAt ? { createdAt: options.createdAt } : {}),
        ...(options.closedAt ? { closedAt: options.closedAt } : {}),
        ...(options.endAt ? { endAt: options.endAt } : {}),
      },
    });
  }
  return vote;
}

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

describe("GET /api/votes/hall", () => {
  it("returns 401 without a token", async () => {
    const res = await request(createApp()).get("/api/votes/hall");
    expect(res.status).toBe(401);
  });

  it("returns 403 for a pending user", async () => {
    const pending = await makeUser("pending", "PENDING_VERIFICATION");
    const res = await request(createApp())
      .get("/api/votes/hall")
      .set("Authorization", `Bearer ${tokenFor(pending.id)}`);
    expect(res.status).toBe(403);
  });

  it("returns only listed, live, OPEN_LINK votes", async () => {
    const creator = await makeUser("creator");
    const viewer = await makeUser("viewer");

    const listed = await makeHallVote(creator.id, { title: "Listed" });
    await makeHallVote(creator.id, { title: "Unlisted", listedInHall: false });
    await makeHallVote(creator.id, {
      title: "Closed",
      closedAt: new Date(),
    });
    await makeHallVote(creator.id, {
      title: "Expired",
      endAt: new Date(Date.now() - 60_000),
    });

    const inviteOnly = await voteService.createVote({
      creatorId: creator.id,
      title: "InviteOnly",
      participationMode: "INVITE_ONLY",
      allowMultiple: false,
      durationMinutes: 60,
      options: ["A", "B"],
    });
    await prisma.vote.update({
      where: { id: inviteOnly.id },
      data: { listedInHall: true },
    });

    const res = await request(createApp())
      .get("/api/votes/hall")
      .set("Authorization", `Bearer ${tokenFor(viewer.id)}`);

    expect(res.status).toBe(200);
    expect(res.body.votes.map((v: any) => v.voteId)).toEqual([listed.id]);
  });

  it("sorts by createdAt descending", async () => {
    const creator = await makeUser("creator");
    const viewer = await makeUser("viewer");

    await makeHallVote(creator.id, {
      title: "Older",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await makeHallVote(creator.id, {
      title: "Newer",
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
    });

    const res = await request(createApp())
      .get("/api/votes/hall")
      .set("Authorization", `Bearer ${tokenFor(viewer.id)}`);

    expect(res.body.votes.map((v: any) => v.title)).toEqual(["Newer", "Older"]);
  });

  it("reports creator username, votedCount, hasVoted and isCreator", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");
    const vote = await makeHallVote(creator.id, { title: "T" });

    const option = await prisma.option.findFirstOrThrow({
      where: { voteId: vote.id, isAbstain: false },
    });
    await prisma.ballot.create({
      data: {
        voteId: vote.id,
        pseudonym: "user_a",
        optionIds: JSON.stringify([option.id]),
        sequenceNumber: 1,
      },
    });
    await prisma.ballot.create({
      data: {
        voteId: vote.id,
        pseudonym: "user_b",
        optionIds: JSON.stringify([option.id]),
        sequenceNumber: 2,
      },
    });
    await prisma.userVoteHistory.create({
      data: { userId: voter.id, voteId: vote.id, ballotSequenceNumber: 1 },
    });

    const forVoter = await request(createApp())
      .get("/api/votes/hall")
      .set("Authorization", `Bearer ${tokenFor(voter.id)}`);
    expect(forVoter.body.votes[0]).toMatchObject({
      creatorUsername: "creator",
      votedCount: 2,
      hasVoted: true,
      isCreator: false,
    });

    const forCreator = await request(createApp())
      .get("/api/votes/hall")
      .set("Authorization", `Bearer ${tokenFor(creator.id)}`);
    expect(forCreator.body.votes[0]).toMatchObject({
      hasVoted: false,
      isCreator: true,
    });
  });
});
