export type ParticipationMode = "OPEN_LINK" | "INVITE_ONLY";
export type VotePhase = "DRAFT" | "LIVE" | "ENDED";
export type InviteStatus = "INVITED" | "ACCEPTED" | "REMOVED" | "EXPIRED";

export interface VoteOptionView {
  id: string;
  text: string;
  order: number;
  isAbstain: boolean;
}

export interface VoteDetailView {
  id: string;
  title: string;
  description: string | null;
  participationMode: ParticipationMode;
  phase: VotePhase;
  allowMultiple: boolean;
  resultsPublicDuringVote: boolean;
  startAt: string;
  endAt: string;
  options: VoteOptionView[];
  votedCount: number;
  eligibleCount: number | null;
  hasVoted: boolean;
  canVote: boolean;
  isInvitee: boolean;
  isCreator: boolean;
}

export interface ResultOptionView {
  id: string;
  text: string;
  isAbstain: boolean;
  count: number;
  percent: number;
}

export interface ResultsView {
  visible: boolean;
  totalBallots: number;
  options: ResultOptionView[];
  winner: string | null;
  note: string | null;
  votedCount: number;
  eligibleCount: number | null;
}

export interface RosterEntryView {
  name: string | null;
  status?: InviteStatus;
  voted?: boolean;
}

export interface RosterView {
  visible: boolean;
  mode: "MASKED" | "FULL" | "COUNT_ONLY";
  entries: RosterEntryView[];
  votedCount: number;
  eligibleCount: number | null;
}

export type MyInviteStatus = "INVITED" | "ACCEPTED" | "EXPIRED";

export interface MyInviteItem {
  inviteId: string;
  voteId: string;
  voteTitle: string;
  creatorUsername: string;
  status: MyInviteStatus;
  phase: VotePhase;
  expiresAt: string | null;
}
