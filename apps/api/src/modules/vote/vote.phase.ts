import { VotePhase } from "./vote.types";

export interface VotePhaseSource {
  participationMode: string;
  startedAt: Date | null;
  closedAt: Date | null;
  endAt: Date;
}

export function getVotePhase(vote: VotePhaseSource, now: Date = new Date()): VotePhase {
  if (vote.closedAt !== null || now.getTime() > new Date(vote.endAt).getTime()) {
    return "ENDED";
  }
  if (vote.participationMode === "INVITE_ONLY" && vote.startedAt === null) {
    return "DRAFT";
  }
  return "LIVE";
}
