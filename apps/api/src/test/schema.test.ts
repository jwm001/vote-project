import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../utils/prisma";
import { resetDb } from "./db";
import { makeUser } from "./factories";

beforeEach(resetDb);

describe("schema", () => {
  it("supports mode B invites and abstain options", async () => {
    const user = await makeUser("creator");
    const vote = await prisma.vote.create({
      data: {
        title: "T",
        creatorId: user.id,
        startAt: new Date(),
        endAt: new Date(Date.now() + 3600_000),
        participationMode: "INVITE_ONLY",
        durationMinutes: 60,
      },
    });
    const invite = await prisma.voteInvite.create({
      data: { voteId: vote.id, inviteeUserId: user.id, expiresAt: new Date(Date.now() + 3600_000) },
    });
    const option = await prisma.option.create({
      data: { voteId: vote.id, text: "弃权", order: 0, isAbstain: true },
    });
    expect(vote.participationMode).toBe("INVITE_ONLY");
    expect(invite.status).toBe("INVITED");
    expect(option.isAbstain).toBe(true);
  });
});
