import { beforeEach, describe, expect, it } from "vitest";
import { VoteService } from "./vote.service";
import { prisma } from "../../utils/prisma";
import { resetDb } from "../../test/db";
import { resetRateLimits } from "../../utils/rate-limit";
import { makeUser } from "../../test/factories";

const voteService = new VoteService();

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

describe("VoteService.createVote", () => {
  it("creates an OPEN_LINK vote with user options and the abstain option last", async () => {
    const creator = await makeUser("creator");

    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "OPEN_LINK",
      allowMultiple: false,
      endAt: new Date(Date.now() + 86_400_000),
      options: ["A", "B"],
    });

    const options = await prisma.option.findMany({
      where: { voteId: vote.id },
      orderBy: { order: "asc" },
    });
    expect(options.map((o) => o.text)).toEqual(["A", "B", "弃权"]);
    expect(options[2].isAbstain).toBe(true);
    expect(vote.startedAt).not.toBeNull();
  });

  it("creates a duration-based (mode B) vote with startedAt null and endAt = now + duration", async () => {
    const creator = await makeUser("creator");
    const before = Date.now();

    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "INVITE_ONLY",
      allowMultiple: false,
      durationMinutes: 60,
      options: ["A", "B"],
    });

    const after = Date.now();
    expect(vote.startedAt).toBeNull();
    expect(vote.durationMinutes).toBe(60);
    expect(vote.endAt.getTime()).toBeGreaterThanOrEqual(before + 60 * 60_000);
    expect(vote.endAt.getTime()).toBeLessThanOrEqual(after + 60 * 60_000);
  });

  it("rejects an empty title", async () => {
    const creator = await makeUser("creator");
    await expect(
      voteService.createVote({
        creatorId: creator.id,
        title: "   ",
        participationMode: "OPEN_LINK",
        allowMultiple: false,
        endAt: new Date(Date.now() + 86_400_000),
        options: ["A", "B"],
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects options with fewer than 2 entries", async () => {
    const creator = await makeUser("creator");
    await expect(
      voteService.createVote({
        creatorId: creator.id,
        title: "T",
        participationMode: "OPEN_LINK",
        allowMultiple: false,
        endAt: new Date(Date.now() + 86_400_000),
        options: ["A"],
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects duplicate options", async () => {
    const creator = await makeUser("creator");
    await expect(
      voteService.createVote({
        creatorId: creator.id,
        title: "T",
        participationMode: "OPEN_LINK",
        allowMultiple: false,
        endAt: new Date(Date.now() + 86_400_000),
        options: ["A", "A"],
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects options containing the abstain text", async () => {
    const creator = await makeUser("creator");
    await expect(
      voteService.createVote({
        creatorId: creator.id,
        title: "T",
        participationMode: "OPEN_LINK",
        allowMultiple: false,
        endAt: new Date(Date.now() + 86_400_000),
        options: ["A", "弃权"],
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects options longer than 300 characters", async () => {
    const creator = await makeUser("creator");
    await expect(
      voteService.createVote({
        creatorId: creator.id,
        title: "T",
        participationMode: "OPEN_LINK",
        allowMultiple: false,
        endAt: new Date(Date.now() + 86_400_000),
        options: ["A", "x".repeat(301)],
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects more than 50 options", async () => {
    const creator = await makeUser("creator");
    const options = Array.from({ length: 51 }, (_, i) => `opt-${i}`);
    await expect(
      voteService.createVote({
        creatorId: creator.id,
        title: "T",
        participationMode: "OPEN_LINK",
        allowMultiple: false,
        endAt: new Date(Date.now() + 86_400_000),
        options,
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("requires endAt for mode A", async () => {
    const creator = await makeUser("creator");
    await expect(
      voteService.createVote({
        creatorId: creator.id,
        title: "T",
        participationMode: "OPEN_LINK",
        allowMultiple: false,
        options: ["A", "B"],
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("requires durationMinutes for mode B", async () => {
    const creator = await makeUser("creator");
    await expect(
      voteService.createVote({
        creatorId: creator.id,
        title: "T",
        participationMode: "INVITE_ONLY",
        allowMultiple: false,
        options: ["A", "B"],
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a mode B vote that provides endAt", async () => {
    const creator = await makeUser("creator");
    await expect(
      voteService.createVote({
        creatorId: creator.id,
        title: "T",
        participationMode: "INVITE_ONLY",
        allowMultiple: false,
        endAt: new Date(Date.now() + 86_400_000),
        options: ["A", "B"],
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an OPEN_LINK vote that provides durationMinutes", async () => {
    const creator = await makeUser("creator");
    await expect(
      voteService.createVote({
        creatorId: creator.id,
        title: "T",
        participationMode: "OPEN_LINK",
        allowMultiple: false,
        durationMinutes: 60,
        options: ["A", "B"],
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a vote that provides both endAt and durationMinutes", async () => {
    const creator = await makeUser("creator");
    await expect(
      voteService.createVote({
        creatorId: creator.id,
        title: "T",
        participationMode: "OPEN_LINK",
        allowMultiple: false,
        endAt: new Date(Date.now() + 86_400_000),
        durationMinutes: 60,
        options: ["A", "B"],
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an invalid participation mode", async () => {
    const creator = await makeUser("creator");
    await expect(
      voteService.createVote({
        creatorId: creator.id,
        title: "T",
        participationMode: "WEIRD" as any,
        allowMultiple: false,
        endAt: new Date(Date.now() + 86_400_000),
        options: ["A", "B"],
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a mode A endAt that is not in the future", async () => {
    const creator = await makeUser("creator");
    await expect(
      voteService.createVote({
        creatorId: creator.id,
        title: "T",
        participationMode: "OPEN_LINK",
        allowMultiple: false,
        endAt: new Date(Date.now() - 86_400_000),
        options: ["A", "B"],
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a durationMinutes outside the allowed range", async () => {
    const creator = await makeUser("creator");
    await expect(
      voteService.createVote({
        creatorId: creator.id,
        title: "T",
        participationMode: "INVITE_ONLY",
        allowMultiple: false,
        durationMinutes: 0,
        options: ["A", "B"],
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("VoteService.updateVote", () => {
  it("allows updating a mode A vote before the first ballot and keeps abstain last", async () => {
    const creator = await makeUser("creator");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "OPEN_LINK",
      allowMultiple: false,
      endAt: new Date(Date.now() + 86_400_000),
      options: ["A", "B"],
    });

    const updated = await voteService.updateVote(vote.id, creator.id, { title: "T2", options: ["X", "Y"] });

    expect(updated.title).toBe("T2");
    const options = await prisma.option.findMany({
      where: { voteId: vote.id },
      orderBy: { order: "asc" },
    });
    expect(options.map((o) => o.text)).toEqual(["X", "Y", "弃权"]);
  });

  it("rejects updating a mode A vote after the first ballot", async () => {
    const creator = await makeUser("creator");
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

    await expect(voteService.updateVote(vote.id, creator.id, { title: "T2" })).rejects.toMatchObject({ status: 409 });
  });

  it("allows updating a mode B INVITE_ONLY draft vote before start", async () => {
    const creator = await makeUser("creator");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "INVITE_ONLY",
      allowMultiple: false,
      durationMinutes: 60,
      options: ["A", "B"],
    });
    expect(vote.startedAt).toBeNull();

    const updated = await voteService.updateVote(vote.id, creator.id, { title: "T2" });
    expect(updated.title).toBe("T2");
  });

  it("rejects updating a started INVITE_ONLY vote", async () => {
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

    await expect(voteService.updateVote(vote.id, creator.id, { title: "T2" })).rejects.toMatchObject({ status: 409 });
  });

  it("rejects changing resultsPublicDuringVote on an OPEN_LINK vote", async () => {
    const creator = await makeUser("creator");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "OPEN_LINK",
      allowMultiple: false,
      endAt: new Date(Date.now() + 86_400_000),
      resultsPublicDuringVote: false,
      options: ["A", "B"],
    });

    await expect(
      voteService.updateVote(vote.id, creator.id, { resultsPublicDuringVote: true })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("allows keeping resultsPublicDuringVote unchanged", async () => {
    const creator = await makeUser("creator");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "OPEN_LINK",
      allowMultiple: false,
      endAt: new Date(Date.now() + 86_400_000),
      resultsPublicDuringVote: true,
      options: ["A", "B"],
    });

    const updated = await voteService.updateVote(vote.id, creator.id, { resultsPublicDuringVote: true });
    expect(updated.resultsPublicDuringVote).toBe(true);
  });

  it("allows an INVITE_ONLY draft to change resultsPublicDuringVote", async () => {
    const creator = await makeUser("creator");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "INVITE_ONLY",
      allowMultiple: false,
      durationMinutes: 60,
      resultsPublicDuringVote: false,
      options: ["A", "B"],
    });

    const updated = await voteService.updateVote(vote.id, creator.id, { resultsPublicDuringVote: true });
    expect(updated.resultsPublicDuringVote).toBe(true);
  });

  it("rejects changing the participation mode", async () => {
    const creator = await makeUser("creator");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "OPEN_LINK",
      allowMultiple: false,
      endAt: new Date(Date.now() + 86_400_000),
      options: ["A", "B"],
    });

    await expect(
      voteService.updateVote(vote.id, creator.id, { participationMode: "INVITE_ONLY" } as any)
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects updating a mode A vote with durationMinutes", async () => {
    const creator = await makeUser("creator");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "OPEN_LINK",
      allowMultiple: false,
      endAt: new Date(Date.now() + 86_400_000),
      options: ["A", "B"],
    });

    await expect(voteService.updateVote(vote.id, creator.id, { durationMinutes: 60 })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects updating a mode B draft vote with endAt", async () => {
    const creator = await makeUser("creator");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "INVITE_ONLY",
      allowMultiple: false,
      durationMinutes: 60,
      options: ["A", "B"],
    });

    await expect(
      voteService.updateVote(vote.id, creator.id, { endAt: new Date(Date.now() + 86_400_000) })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects updating a vote with a past endAt", async () => {
    const creator = await makeUser("creator");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "OPEN_LINK",
      allowMultiple: false,
      endAt: new Date(Date.now() + 86_400_000),
      options: ["A", "B"],
    });

    await expect(
      voteService.updateVote(vote.id, creator.id, { endAt: new Date(Date.now() - 86_400_000) })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("VoteService.deleteVote", () => {
  it("deletes a mode B draft vote together with ballots, history, invites and options", async () => {
    const creator = await makeUser("creator");
    const voter = await makeUser("voter");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "INVITE_ONLY",
      allowMultiple: false,
      durationMinutes: 60,
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
    await prisma.voteInvite.create({
      data: { voteId: vote.id, inviteeUserId: voter.id, status: "INVITED" },
    });

    await expect(voteService.deleteVote(vote.id, creator.id)).resolves.toBeUndefined();

    expect(await prisma.vote.count()).toBe(0);
    expect(await prisma.option.count()).toBe(0);
    expect(await prisma.ballot.count()).toBe(0);
    expect(await prisma.userVoteHistory.count()).toBe(0);
    expect(await prisma.voteInvite.count()).toBe(0);
  });

  it("rejects deleting a vote after the first ballot", async () => {
    const creator = await makeUser("creator");
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

    await expect(voteService.deleteVote(vote.id, creator.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe("VoteService.endVote", () => {
  it("rejects ending a draft vote", async () => {
    const creator = await makeUser("creator");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "INVITE_ONLY",
      allowMultiple: false,
      durationMinutes: 60,
      options: ["A", "B"],
    });

    await expect(voteService.endVote(vote.id, creator.id)).rejects.toMatchObject({ status: 409 });
  });

  it("ends a live vote by setting closedAt", async () => {
    const creator = await makeUser("creator");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "OPEN_LINK",
      allowMultiple: false,
      endAt: new Date(Date.now() + 86_400_000),
      options: ["A", "B"],
    });

    const ended = await voteService.endVote(vote.id, creator.id);
    expect(ended.closedAt).not.toBeNull();
  });

  it("rejects ending an ended vote", async () => {
    const creator = await makeUser("creator");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "OPEN_LINK",
      allowMultiple: false,
      endAt: new Date(Date.now() + 86_400_000),
      options: ["A", "B"],
    });

    await voteService.endVote(vote.id, creator.id);
    await expect(voteService.endVote(vote.id, creator.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe("VoteService.assertCreator", () => {
  it("returns the vote for the creator", async () => {
    const creator = await makeUser("creator");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "OPEN_LINK",
      allowMultiple: false,
      endAt: new Date(Date.now() + 86_400_000),
      options: ["A", "B"],
    });

    await expect(voteService.assertCreator(vote.id, creator.id)).resolves.toMatchObject({ id: vote.id });
  });

  it("throws 404 when the vote is missing", async () => {
    const creator = await makeUser("creator");
    await expect(voteService.assertCreator("missing", creator.id)).rejects.toMatchObject({ status: 404 });
  });

  it("throws 403 when the caller is not the creator", async () => {
    const creator = await makeUser("creator");
    const other = await makeUser("other");
    const vote = await voteService.createVote({
      creatorId: creator.id,
      title: "T",
      participationMode: "OPEN_LINK",
      allowMultiple: false,
      endAt: new Date(Date.now() + 86_400_000),
      options: ["A", "B"],
    });

    await expect(voteService.assertCreator(vote.id, other.id)).rejects.toMatchObject({ status: 403 });
  });
});
