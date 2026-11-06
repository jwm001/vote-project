import { VotePhase } from "./vote.types";

export interface VotePhaseSource {
  participationMode: string;
  startedAt: Date | null;
  closedAt: Date | null;
  endAt: Date;
}

export function getVotePhase(vote: VotePhaseSource, now: Date = new Date()): VotePhase {
  if (vote.closedAt !== null) {
    return "ENDED";
  }
  if (vote.participationMode === "INVITE_ONLY" && vote.startedAt === null) {
    // A draft's endAt is only a placeholder until startVote sets the real window.
    return "DRAFT";
  }
  if (now.getTime() > new Date(vote.endAt).getTime()) {
    return "ENDED";
  }
  return "LIVE";
}
