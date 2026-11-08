import { beforeEach, describe, expect, it } from "vitest";
import { auditService, shouldRedactOptions } from "./audit.service";
import { VoteService } from "../vote/vote.service";
import { AppError } from "../../utils/errors";
import { prisma } from "../../utils/prisma";
import { resetDb } from "../../test/db";
import { makeUser } from "../../test/factories";

const voteService = new VoteService();

beforeEach(async () => {
  await resetDb();
});

function viewerOf(user: { id: string; role: string; status: string }) {
  return { id: user.id, role: user.role, status: user.status };
}

function makeModeAVote(creatorId: string) {
  return voteService.createVote({
    creatorId,
    title: "公开投票",
    participationMode: "OPEN_LINK",
    allowMultiple: false,
    endAt: new Date(Date.now() + 3_600_000),
    options: ["A", "B"],
  });
}

function makeModeBVote(creatorId: string) {
  return voteService.createVote({
    creatorId,
    title: "邀请制投票",
    participationMode: "INVITE_ONLY",
    allowMultiple: false,
    durationMinutes: 60,
    options: ["A", "B"],
  });
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
  userId: string,
  status: "INVITED" | "ACCEPTED" = "ACCEPTED"
) {
  return prisma.voteInvite.create({
    data: {
      voteId,
      inviteeUserId: userId,
      status,
      acceptedAt: status === "ACCEPTED" ? new Date() : null,
    },
  });
}

async function addBallot(voteId: string, userId: string, sequenceNumber = 1) {
  const option = await prisma.option.findFirstOrThrow({
    where: { voteId, isAbstain: false },
    orderBy: { order: "asc" },
  });
  await prisma.ballot.create({
    data: {
      voteId,
      pseudonym: `user_${sequenceNumber}`,
      optionIds: JSON.stringify([option.id]),
      sequenceNumber,
    },
  });
  await prisma.userVoteHistory.create({
    data: {
      userId,
      voteId,
      ballotSequenceNumber: sequenceNumber,
    },
  });
}

async function expectAppError(promise: Promise<unknown>, status: number) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).status).toBe(status);
  return error as AppError;
}

describe("shouldRedactOptions", () => {
  const liveVote = {
    creatorId: "creator",
    participationMode: "OPEN_LINK",
    startedAt: new Date(Date.now() - 60_000),
    closedAt: null,
    endAt: new Date(Date.now() + 3_600_000),
  };

  it("redacts live PDFs for ordinary participants", () => {
    expect(
      shouldRedactOptions(liveVote, { id: "voter", role: "USER" })
    ).toBe(true);
  });

  it("never redacts for the creator or an admin", () => {
    expect(
      shouldRedactOptions(liveVote, { id: "creator", role: "USER" })
    ).toBe(false);
    expect(
      shouldRedactOptions(liveVote, { id: "admin", role: "ADMIN" })
    ).toBe(false);
  });

  it("does not redact once the vote ended", () => {
    expect(
      shouldRedactOptions(
        { ...liveVote, closedAt: new Date() },
        { id: "voter", role: "USER" }
      )
    ).toBe(false);
  });
});

describe("Mode A PDF access", () => {
  it("allows participants while live but rejects non-participants", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");
    const stranger = await makeUser("stranger");
    const vote = await makeModeAVote(creator.id);
    await addBallot(vote.id, voter.id);

    const pdf = await auditService.generateAuditPdf(vote.id, viewerOf(voter));
    expect(pdf.pdf.length).toBeGreaterThan(0);
    expect(pdf.integrity).toBe("live");
    // A live PDF for an ordinary participant hides option names and counts.
    expect(pdf.redacted).toBe(true);

    await expectAppError(
      auditService.generateAuditPdf(vote.id, viewerOf(stranger)),
      403
    );
  });

  it("allows any approved user after the vote ended and seals on first export", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");
    const stranger = await makeUser("stranger");
    const pending = await makeUser("pending", "PENDING_VERIFICATION");
    const vote = await makeModeAVote(creator.id);
    await addBallot(vote.id, voter.id);
    await endVote(vote.id);

    const first = await auditService.generateAuditPdf(
      vote.id,
      viewerOf(stranger)
    );
    expect(first.integrity).toBe("sealed");
    expect(first.redacted).toBe(false);

    const stored = await prisma.vote.findUniqueOrThrow({
      where: { id: vote.id },
      select: { auditHash: true, auditRecordedAt: true },
    });
    expect(stored.auditHash).toBe(first.digest);
    expect(stored.auditRecordedAt).not.toBeNull();

    await expectAppError(
      auditService.generateAuditPdf(vote.id, viewerOf(pending)),
      403
    );
  });

  it("reports match on a later export of the same sealed records", async () => {
    const creator = await makeUser("creator");
    const vote = await makeModeAVote(creator.id);
    await addBallot(vote.id, creator.id);
    await endVote(vote.id);

    const sealed = await auditService.generateAuditPdf(
      vote.id,
      viewerOf(creator)
    );
    expect(sealed.integrity).toBe("sealed");

    const second = await auditService.generateAuditPdf(
      vote.id,
      viewerOf(creator)
    );
    expect(second.integrity).toBe("match");
    expect(second.digest).toBe(sealed.digest);
  });
});

describe("Mode B PDF access", () => {
  it("rejects a non-invitee even after the vote ended", async () => {
    const creator = await makeUser("creator");
    const stranger = await makeUser("stranger");
    const vote = await makeModeBVote(creator.id);
    await startModeB(vote.id);
    await endVote(vote.id);

    await expectAppError(
      auditService.generateAuditPdf(vote.id, viewerOf(stranger)),
      403
    );
  });

  it("allows an accepted invitee after the vote ended", async () => {
    const creator = await makeUser("creator");
    const invitee = await makeUser("invitee");
    const vote = await makeModeBVote(creator.id);
    await addInvite(vote.id, invitee.id, "ACCEPTED");
    await startModeB(vote.id);
    await endVote(vote.id);

    const result = await auditService.generateAuditPdf(
      vote.id,
      viewerOf(invitee)
    );
    expect(result.redacted).toBe(false);
    expect(result.pdf.length).toBeGreaterThan(0);
  });

  it("allows a live participant with an accepted invite but redacts the PDF", async () => {
    const creator = await makeUser("creator");
    const invitee = await makeUser("invitee");
    const vote = await makeModeBVote(creator.id);
    await addInvite(vote.id, invitee.id, "ACCEPTED");
    await startModeB(vote.id);
    await addBallot(vote.id, invitee.id);

    const result = await auditService.generateAuditPdf(
      vote.id,
      viewerOf(invitee)
    );
    expect(result.redacted).toBe(true);
    expect(result.integrity).toBe("live");
    expect(result.recordedDigest).toBeNull();
  });

  it("does not redact for the creator while live", async () => {
    const creator = await makeUser("creator");
    const vote = await makeModeBVote(creator.id);
    await startModeB(vote.id);

    const result = await auditService.generateAuditPdf(
      vote.id,
      viewerOf(creator)
    );
    expect(result.redacted).toBe(false);
  });

  it("seals on early end and matches afterwards", async () => {
    const creator = await makeUser("creator");
    const vote = await makeModeBVote(creator.id);
    await startModeB(vote.id);
    await addBallot(vote.id, creator.id);
    await endVote(vote.id);

    const first = await auditService.generateAuditPdf(
      vote.id,
      viewerOf(creator)
    );
    expect(first.integrity).toBe("sealed");

    const second = await auditService.generateAuditPdf(
      vote.id,
      viewerOf(creator)
    );
    expect(second.integrity).toBe("match");
  });
});
