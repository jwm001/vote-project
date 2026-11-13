import { beforeEach, describe, expect, it } from "vitest";
import crypto from "crypto";
import { PDFDocument } from "pdf-lib";
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

/**
 * Independent copy of the version-1 canonical payload. Kept in the test on
 * purpose: if the production format changes, old sealed hashes stop matching
 * and this test is the tripwire.
 */
function legacyDigest(
  vote: {
    id: string;
    title: string;
    description: string | null;
    creatorId: string;
    allowMultiple: boolean;
    startAt: Date;
    endAt: Date;
    options: { id: string; text: string; order: number }[];
  },
  ballots: {
    sequenceNumber: number;
    pseudonym: string;
    optionIds: string;
    submittedAt: Date;
  }[]
): string {
  const payload = JSON.stringify({
    version: 1,
    vote: {
      id: vote.id,
      title: vote.title,
      description: vote.description ?? null,
      creatorId: vote.creatorId,
      allowMultiple: vote.allowMultiple,
      startAt: vote.startAt.toISOString(),
      endAt: vote.endAt.toISOString(),
      options: [...vote.options]
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
        .map((option) => ({
          id: option.id,
          text: option.text,
          order: option.order,
        })),
    },
    ballots: [...ballots]
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
      .map((ballot) => ({
        sequenceNumber: ballot.sequenceNumber,
        pseudonym: ballot.pseudonym,
        optionIds: JSON.parse(ballot.optionIds),
        submittedAt: ballot.submittedAt.toISOString(),
      })),
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
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

  it("embeds the Chinese fonts so CJK content renders", async () => {
    const creator = await makeUser("creator");
    const vote = await makeModeAVote(creator.id);

    const result = await auditService.generateAuditPdf(
      vote.id,
      viewerOf(creator)
    );
    const loaded = await PDFDocument.load(result.pdf);
    const objects = loaded.context
      .enumerateIndirectObjects()
      .map(([, object]) => object.toString());

    // 两个中文字重都要真正嵌入（FontFile3 = CFF 子集），否则中文会变成空白/问号。
    expect(
      objects.some((text) => text.includes("/BaseFont /NotoSansSC-Regular"))
    ).toBe(true);
    expect(
      objects.some((text) => text.includes("/BaseFont /NotoSansSC-Bold"))
    ).toBe(true);
    expect(objects.some((text) => text.includes("/FontFile3"))).toBe(true);
    expect(objects.some((text) => text.includes("Helvetica"))).toBe(false);
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

  it("matches a pre-existing sealed digest computed with the legacy format", async () => {
    const creator = await makeUser("creator");
    const vote = await makeModeAVote(creator.id);
    await addBallot(vote.id, creator.id);
    await endVote(vote.id);

    const stored = await prisma.vote.findUniqueOrThrow({
      where: { id: vote.id },
      include: { options: true, ballots: true },
    });
    const expected = legacyDigest(stored, stored.ballots);
    await prisma.vote.update({
      where: { id: vote.id },
      data: { auditHash: expected, auditRecordedAt: new Date() },
    });

    const result = await auditService.generateAuditPdf(
      vote.id,
      viewerOf(creator)
    );
    expect(result.integrity).toBe("match");
    expect(result.digest).toBe(expected);
    expect(result.recordedDigest).toBe(expected);
  });
});

describe("Mode B PDF access", () => {
  it("rejects an accepted invitee while the vote is still DRAFT", async () => {
    const creator = await makeUser("creator");
    const invitee = await makeUser("invitee");
    const vote = await makeModeBVote(creator.id);
    await addInvite(vote.id, invitee.id, "ACCEPTED");

    await expectAppError(
      auditService.generateAuditPdf(vote.id, viewerOf(invitee)),
      403
    );
  });

  it("rejects a non-invitee while the vote is LIVE", async () => {
    const creator = await makeUser("creator");
    const stranger = await makeUser("stranger");
    const vote = await makeModeBVote(creator.id);
    await startModeB(vote.id);

    await expectAppError(
      auditService.generateAuditPdf(vote.id, viewerOf(stranger)),
      403
    );
  });

  it("rejects an invitee who has not accepted yet", async () => {
    const creator = await makeUser("creator");
    const invitee = await makeUser("invitee");
    const vote = await makeModeBVote(creator.id);
    await addInvite(vote.id, invitee.id, "INVITED");
    await startModeB(vote.id);

    await expectAppError(
      auditService.generateAuditPdf(vote.id, viewerOf(invitee)),
      403
    );
  });

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
