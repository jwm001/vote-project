import { beforeEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createApp } from "../../app";
import { VoteService } from "./vote.service";
import { aggregateResults, getResults, getRoster } from "./vote.results";
import { maskRealName } from "../../utils/names";
import { AppError } from "../../utils/errors";
import { encrypt } from "../../utils/encryption";
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

function makeModeAVote(
  creatorId: string,
  options: { allowMultiple?: boolean; resultsPublicDuringVote?: boolean } = {}
) {
  return voteService.createVote({
    creatorId,
    title: "公开投票",
    participationMode: "OPEN_LINK",
    allowMultiple: options.allowMultiple ?? false,
    resultsPublicDuringVote: options.resultsPublicDuringVote ?? false,
    endAt: new Date(Date.now() + 86_400_000),
    options: ["A", "B"],
  });
}

function makeModeBVote(
  creatorId: string,
  options: { allowMultiple?: boolean; durationMinutes?: number; resultsPublicDuringVote?: boolean } = {}
) {
  return voteService.createVote({
    creatorId,
    title: "邀请制投票",
    participationMode: "INVITE_ONLY",
    allowMultiple: options.allowMultiple ?? false,
    resultsPublicDuringVote: options.resultsPublicDuringVote ?? false,
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

async function startModeB(voteId: string) {
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

async function endVote(voteId: string) {
  return prisma.vote.update({
    where: { id: voteId },
    data: { closedAt: new Date() },
  });
}

async function addInvite(
  voteId: string,
  userId: string | null,
  status: "INVITED" | "ACCEPTED" | "REMOVED" = "INVITED",
  extra: { expiresAt?: Date; token?: string } = {}
) {
  return prisma.voteInvite.create({
    data: {
      voteId,
      inviteeUserId: userId,
      token: extra.token ?? (userId === null ? `token-${Math.random()}` : null),
      status,
      acceptedAt: status === "ACCEPTED" ? new Date() : null,
      removedAt: status === "REMOVED" ? new Date() : null,
      expiresAt: extra.expiresAt ?? null,
    },
  });
}

async function addBallot(
  voteId: string,
  userId: string,
  optionIds: string[],
  sequenceNumber: number,
  votedAt?: Date
) {
  await prisma.ballot.create({
    data: {
      voteId,
      pseudonym: `user_${sequenceNumber}`,
      optionIds: JSON.stringify(optionIds),
      sequenceNumber,
    },
  });
  await prisma.userVoteHistory.create({
    data: {
      userId,
      voteId,
      ballotSequenceNumber: sequenceNumber,
      ...(votedAt ? { votedAt } : {}),
    },
  });
}

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

function aggregateOptions() {
  return [
    { id: "a", text: "A", order: 0, isAbstain: false },
    { id: "b", text: "B", order: 1, isAbstain: false },
    { id: "x", text: "弃权", order: 2, isAbstain: true },
  ];
}

function ballotsOf(...selection: string[][]) {
  return selection.map((optionIds) => ({ optionIds: JSON.stringify(optionIds) }));
}

function tokenFor(userId: string) {
  return jwt.sign({ userId }, process.env.JWT_SECRET || "test-secret-key", {
    expiresIn: "7d",
  });
}

describe("maskRealName", () => {
  it("masks one, two and long names", () => {
    expect(maskRealName("张三")).toBe("张*");
    expect(maskRealName("欧阳娜娜")).toBe("欧*娜");
    expect(maskRealName("李")).toBe("*");
  });

  it("masks empty and missing names as a single star", () => {
    expect(maskRealName("")).toBe("*");
    expect(maskRealName(null)).toBe("*");
    expect(maskRealName(undefined)).toBe("*");
  });
});

describe("aggregateResults", () => {
  const options = aggregateOptions();

  it("counts ballots and returns the winning option text with one-decimal percents", () => {
    const result = aggregateResults(
      options,
      ballotsOf(["a"], ["a"], ["b"], ["x"])
    );

    expect(result.totalBallots).toBe(4);
    expect(result.options).toEqual([
      { id: "a", text: "A", count: 2, percent: 50, isAbstain: false },
      { id: "b", text: "B", count: 1, percent: 25, isAbstain: false },
      { id: "x", text: "弃权", count: 1, percent: 25, isAbstain: true },
    ]);
    expect(result.winner).toBe("A");
    expect(result.note).toBeNull();
  });

  it("reports abstain majority when abstain beats every option", () => {
    const result = aggregateResults(
      options,
      ballotsOf(["x"], ["x"], ["x"], ["a"])
    );

    expect(result.winner).toBeNull();
    expect(result.note).toBe("弃权最多，未形成多数");
    expect(result.options[2].count).toBe(3);
    expect(result.options[2].percent).toBe(75);
  });

  it("reports a tie between an option and abstain", () => {
    const result = aggregateResults(
      options,
      ballotsOf(["x"], ["x"], ["a"], ["a"])
    );

    expect(result.winner).toBeNull();
    expect(result.note).toBe("平票");
  });

  it("reports a tie between options", () => {
    const result = aggregateResults(
      options,
      ballotsOf(["a"], ["a"], ["b"], ["b"])
    );

    expect(result.winner).toBeNull();
    expect(result.note).toBe("平票");
  });

  it("reports abstain majority when every ballot abstained", () => {
    const result = aggregateResults(options, ballotsOf(["x"], ["x"], ["x"]));

    expect(result.winner).toBeNull();
    expect(result.note).toBe("弃权最多，未形成多数");
  });

  it("uses ballots as the percent denominator so multi-select totals can exceed 100", () => {
    const result = aggregateResults(
      options,
      ballotsOf(["a", "b"], ["a", "b"])
    );

    expect(result.totalBallots).toBe(2);
    expect(result.options.map((option) => [option.count, option.percent])).toEqual([
      [2, 100],
      [2, 100],
      [0, 0],
    ]);
    expect(result.winner).toBeNull();
    expect(result.note).toBe("平票");
  });

  it("reports no votes when there are no ballots", () => {
    const result = aggregateResults(options, []);

    expect(result.totalBallots).toBe(0);
    expect(result.winner).toBeNull();
    expect(result.note).toBe("暂无投票");
    expect(result.options.map((option) => option.percent)).toEqual([0, 0, 0]);
  });

  it("ignores malformed ballot option ids instead of throwing", () => {
    const result = aggregateResults(options, [
      { optionIds: "not-json" },
      { optionIds: JSON.stringify(["a"]) },
      { optionIds: JSON.stringify("a") },
    ]);

    expect(result.totalBallots).toBe(3);
    expect(result.options[0].count).toBe(1);
    expect(result.options[0].percent).toBe(33.3);
  });
});

describe("getResults", () => {
  it("hides mode A results from an ordinary approved user while the vote is live", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");
    const vote = await makeModeAVote(creator.id);
    const { first } = await optionsOf(vote.id);
    await addBallot(vote.id, voter.id, [first.id], 1);

    const result = await getResults(vote.id, viewerOf(voter));

    expect(result).toEqual({ visible: false, votedCount: 1, eligibleCount: 2 });
  });

  it("shows mode A results to an approved user after the vote ended", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");
    const vote = await makeModeAVote(creator.id);
    const { first } = await optionsOf(vote.id);
    await addBallot(vote.id, voter.id, [first.id], 1);
    await endVote(vote.id);

    const result = await getResults(vote.id, viewerOf(voter));

    expect(result).toMatchObject({
      visible: true,
      totalBallots: 1,
      winner: "A",
      note: null,
      votedCount: 1,
      eligibleCount: 2,
    });
    if (!result.visible) throw new Error("expected visible results");
    expect(result.options.map((option) => option.count)).toEqual([1, 0, 0]);
  });

  it("keeps mode A results hidden after the vote ended for a non-approved viewer", async () => {
    const creator = await makeUser("creator");
    const pending = await makeUser("pending", "PENDING_VERIFICATION");
    const vote = await makeModeAVote(creator.id);
    await endVote(vote.id);

    const result = await getResults(vote.id, viewerOf(pending));

    expect(result).toEqual({ visible: false, votedCount: 0, eligibleCount: 1 });
  });

  it("shows live mode A results to the creator even without resultsPublicDuringVote", async () => {
    const creator = await makeUser("creator");
    const vote = await makeModeAVote(creator.id);

    const result = await getResults(vote.id, viewerOf(creator));

    expect(result).toMatchObject({ visible: true, totalBallots: 0, note: "暂无投票" });
  });

  it("shows mode A results during the vote when resultsPublicDuringVote is set", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");
    const vote = await makeModeAVote(creator.id, { resultsPublicDuringVote: true });

    const result = await getResults(vote.id, viewerOf(voter));

    expect(result.visible).toBe(true);
  });

  it("throws 403 for a mode B viewer who is not invited", async () => {
    const creator = await makeUser("creator");
    const stranger = await makeUser("stranger");
    const vote = await makeModeBVote(creator.id);

    await expectAppError(
      getResults(vote.id, viewerOf(stranger)),
      403,
      "无权查看本场结果"
    );
  });

  it("hides mode B results from an invitee in DRAFT and in LIVE without realtime results", async () => {
    const creator = await makeUser("creator");
    const invitee = await makeUser("invitee");
    const vote = await makeModeBVote(creator.id);
    await addInvite(vote.id, invitee.id, "ACCEPTED");

    const draft = await getResults(vote.id, viewerOf(invitee));
    expect(draft).toEqual({ visible: false, votedCount: 0, eligibleCount: 1 });

    await startModeB(vote.id);
    const live = await getResults(vote.id, viewerOf(invitee));
    expect(live).toEqual({ visible: false, votedCount: 0, eligibleCount: 1 });
  });

  it("shows mode B results to an invitee after the vote ended", async () => {
    const creator = await makeUser("creator");
    const invitee = await makeUser("invitee");
    const vote = await makeModeBVote(creator.id);
    await addInvite(vote.id, invitee.id, "ACCEPTED");
    const { first } = await optionsOf(vote.id);
    await startModeB(vote.id);
    await addBallot(vote.id, invitee.id, [first.id], 1);
    await endVote(vote.id);

    const result = await getResults(vote.id, viewerOf(invitee));

    expect(result).toMatchObject({
      visible: true,
      totalBallots: 1,
      winner: "A",
      votedCount: 1,
      eligibleCount: 1,
    });
  });

  it("shows mode B results in LIVE when resultsPublicDuringVote is set", async () => {
    const creator = await makeUser("creator");
    const invitee = await makeUser("invitee");
    const vote = await makeModeBVote(creator.id, { resultsPublicDuringVote: true });
    await addInvite(vote.id, invitee.id, "ACCEPTED");
    await startModeB(vote.id);

    const result = await getResults(vote.id, viewerOf(invitee));

    expect(result.visible).toBe(true);
  });

  it("counts every non-removed invite (including unaccepted links) as mode B eligible voters", async () => {
    const creator = await makeUser("creator");
    const accepted = await makeUser("accepted");
    const pending = await makeUser("pending");
    const removed = await makeUser("removed");
    const vote = await makeModeBVote(creator.id);
    await addInvite(vote.id, accepted.id, "ACCEPTED");
    await addInvite(vote.id, pending.id, "INVITED");
    await addInvite(vote.id, removed.id, "REMOVED");
    await addInvite(vote.id, null, "INVITED");
    await endVote(vote.id);

    const result = await getResults(vote.id, viewerOf(creator));

    // 与 VoteService.getVoteById 的 eligibleCount 语义一致。
    expect(result).toMatchObject({ visible: true, votedCount: 0, eligibleCount: 3 });
  });

  it("lets an admin view mode B results without an invite", async () => {
    const creator = await makeUser("creator");
    const admin = await makeUser("admin", "APPROVED");
    await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    const vote = await makeModeBVote(creator.id);
    await endVote(vote.id);

    const result = await getResults(vote.id, { ...viewerOf(admin), role: "ADMIN" });

    expect(result).toMatchObject({ visible: true, totalBallots: 0, note: "暂无投票" });
  });
});

describe("getRoster", () => {
  it("hides the mode A roster while the vote is live", async () => {
    const creator = await makeUser("creator");
    const vote = await makeModeAVote(creator.id);

    const roster = await getRoster(vote.id, viewerOf(creator));

    expect(roster).toEqual({ visible: false });
  });

  it("returns only voters with masked names for an ended mode A vote", async () => {
    const creator = await makeUser("creator");
    const voterOne = await makeUser("voter_one");
    const voterTwo = await makeUser("voter_two");
    const nonVoter = await makeUser("non_voter");
    await prisma.user.update({
      where: { id: voterOne.id },
      data: { realName: encrypt("张三") },
    });
    await prisma.user.update({
      where: { id: voterTwo.id },
      data: { realName: encrypt("欧阳娜娜") },
    });
    await prisma.user.update({
      where: { id: nonVoter.id },
      data: { realName: encrypt("李四") },
    });
    const vote = await makeModeAVote(creator.id);
    const { first, second } = await optionsOf(vote.id);
    const now = Date.now();
    await addBallot(vote.id, voterOne.id, [first.id], 1, new Date(now - 2_000));
    await addBallot(vote.id, voterTwo.id, [second.id], 2, new Date(now - 1_000));
    await endVote(vote.id);

    const roster = await getRoster(vote.id, viewerOf(creator));

    expect(roster).toEqual({
      visible: true,
      mode: "MASKED",
      entries: [{ name: "张*" }, { name: "欧*娜" }],
    });
  });

  it("throws 403 for a mode B roster viewer who is not invited", async () => {
    const creator = await makeUser("creator");
    const stranger = await makeUser("stranger");
    const vote = await makeModeBVote(creator.id);

    await expectAppError(
      getRoster(vote.id, viewerOf(stranger)),
      403,
      "无权查看本场名单"
    );
  });

  it("lets an admin view a mode B roster without an invite", async () => {
    const creator = await makeUser("creator");
    const admin = await makeUser("admin", "APPROVED");
    await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    const bob = await makeUser("bob");
    const vote = await makeModeBVote(creator.id);
    await addInvite(vote.id, bob.id, "ACCEPTED");
    await endVote(vote.id);

    const roster = await getRoster(vote.id, { ...viewerOf(admin), role: "ADMIN" });

    expect(roster).toMatchObject({ visible: true, mode: "FULL" });
    if (!roster.visible || roster.mode !== "FULL") throw new Error("expected full roster");
    expect(roster.entries).toHaveLength(1);
  });

  it("returns full mode B draft roster with derived statuses but no voted field", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const carol = await makeUser("carol");
    const removed = await makeUser("removed");
    await prisma.user.update({
      where: { id: bob.id },
      data: { realName: encrypt("鲍勃") },
    });
    const vote = await makeModeBVote(creator.id);
    await addInvite(vote.id, bob.id, "ACCEPTED");
    await addInvite(vote.id, carol.id, "INVITED", {
      expiresAt: new Date(Date.now() - 60_000),
    });
    await addInvite(vote.id, removed.id, "REMOVED");
    await addInvite(vote.id, null, "INVITED");

    const roster = await getRoster(vote.id, viewerOf(bob));

    expect(roster).toMatchObject({ visible: true, mode: "FULL" });
    if (!roster.visible || roster.mode !== "FULL") throw new Error("expected full roster");
    expect(roster.entries).toHaveLength(3);
    const byName = new Map(roster.entries.map((entry) => [entry.name, entry]));
    expect(byName.get("鲍勃")).toMatchObject({ status: "ACCEPTED" });
    expect(byName.get("enc")).toMatchObject({ status: "EXPIRED" });
    expect(byName.get(null)).toMatchObject({ status: "INVITED" });
    for (const entry of roster.entries) {
      expect(entry).not.toHaveProperty("voted");
    }
  });

  it("returns the full mode B roster with voted flags for the creator while live", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const carol = await makeUser("carol");
    const vote = await makeModeBVote(creator.id);
    await addInvite(vote.id, bob.id, "ACCEPTED");
    await addInvite(vote.id, carol.id, "ACCEPTED");
    const { first } = await optionsOf(vote.id);
    await startModeB(vote.id);
    await addBallot(vote.id, bob.id, [first.id], 1);

    const roster = await getRoster(vote.id, viewerOf(creator));

    expect(roster).toMatchObject({ visible: true, mode: "FULL" });
    if (!roster.visible || roster.mode !== "FULL") throw new Error("expected full roster");
    const bobEntry = roster.entries.find((entry) => entry.name === "enc");
    expect(roster.entries).toHaveLength(2);
    expect(roster.entries.filter((entry) => entry.voted)).toHaveLength(1);
    expect(bobEntry).toMatchObject({ voted: true });
  });

  it("gives a non-creator invitee COUNT_ONLY for a live mode B roster", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const carol = await makeUser("carol");
    const removed = await makeUser("removed");
    const vote = await makeModeBVote(creator.id);
    await addInvite(vote.id, bob.id, "ACCEPTED");
    await addInvite(vote.id, carol.id, "ACCEPTED");
    await addInvite(vote.id, removed.id, "REMOVED");
    await addInvite(vote.id, null, "INVITED");
    await startModeB(vote.id);

    const roster = await getRoster(vote.id, viewerOf(bob));

    // COUNT_ONLY 与 DRAFT/FULL 条目数一致：2 个绑定邀请 + 1 个链接邀请。
    expect(roster).toEqual({ visible: true, mode: "COUNT_ONLY", count: 3 });
  });

  it("returns the full mode B roster after the vote ended without voted fields", async () => {
    const creator = await makeUser("creator");
    const bob = await makeUser("bob");
    const carol = await makeUser("carol");
    const vote = await makeModeBVote(creator.id);
    await addInvite(vote.id, bob.id, "ACCEPTED");
    await addInvite(vote.id, carol.id, "INVITED");
    const { first } = await optionsOf(vote.id);
    await startModeB(vote.id);
    await addBallot(vote.id, bob.id, [first.id], 1);
    await endVote(vote.id);

    const roster = await getRoster(vote.id, viewerOf(creator));

    expect(roster).toMatchObject({ visible: true, mode: "FULL" });
    if (!roster.visible || roster.mode !== "FULL") throw new Error("expected full roster");
    expect(roster.entries).toHaveLength(2);
    for (const entry of roster.entries) {
      expect(entry).not.toHaveProperty("voted");
    }
  });
});

describe("results and roster routes", () => {
  it("serves results and roster with auth only", async () => {
    const creator = await makeUser("creator");
    const vote = await makeModeAVote(creator.id);
    const app = createApp();

    const anonymous = await request(app).get(`/api/votes/${vote.id}/results`);
    expect(anonymous.status).toBe(401);

    const results = await request(app)
      .get(`/api/votes/${vote.id}/results`)
      .set("Authorization", `Bearer ${tokenFor(creator.id)}`);
    expect(results.status).toBe(200);
    expect(results.body).toMatchObject({ visible: true, totalBallots: 0, note: "暂无投票" });

    const roster = await request(app)
      .get(`/api/votes/${vote.id}/roster`)
      .set("Authorization", `Bearer ${tokenFor(creator.id)}`);
    expect(roster.status).toBe(200);
    expect(roster.body).toEqual({ visible: false });
  });
});
