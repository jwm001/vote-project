import { describe, expect, it } from "vitest";
import { getVotePhase } from "./vote.phase";

describe("getVotePhase", () => {
  it("returns DRAFT for an INVITE_ONLY vote that has not started", () => {
    expect(
      getVotePhase({
        participationMode: "INVITE_ONLY",
        startedAt: null,
        endAt: new Date(Date.now() + 60 * 60_000),
        closedAt: null,
      })
    ).toBe("DRAFT");
  });

  it("returns LIVE for an INVITE_ONLY vote after start", () => {
    expect(
      getVotePhase({
        participationMode: "INVITE_ONLY",
        startedAt: new Date(Date.now() - 60_000),
        endAt: new Date(Date.now() + 60 * 60_000),
        closedAt: null,
      })
    ).toBe("LIVE");
  });

  it("returns ENDED for an OPEN_LINK vote past its end without close", () => {
    expect(
      getVotePhase({
        participationMode: "OPEN_LINK",
        startedAt: new Date(Date.now() - 120 * 60_000),
        endAt: new Date(Date.now() - 60_000),
        closedAt: null,
      })
    ).toBe("ENDED");
  });

  it("returns ENDED when the vote was closed even before endAt", () => {
    expect(
      getVotePhase({
        participationMode: "OPEN_LINK",
        startedAt: new Date(Date.now() - 120 * 60_000),
        endAt: new Date(Date.now() + 60 * 60_000),
        closedAt: new Date(),
      })
    ).toBe("ENDED");
  });
});
