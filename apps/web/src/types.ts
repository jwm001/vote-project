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
  durationMinutes: number | null;
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
  votedCount?: number;
  eligibleCount?: number | null;
  count?: number;
}

export type MyInviteStatus = "INVITED" | "ACCEPTED" | "EXPIRED";

export interface MyVoteItemBase {
  voteId: string;
  voteTitle: string;
  participationMode: ParticipationMode;
  phase: VotePhase;
  allowMultiple: boolean;
  startAt: string;
  endAt: string;
  votedCount: number;
  eligibleCount: number | null;
}

export interface MyVoteCreated extends MyVoteItemBase {
  relation: "CREATOR";
}

export interface MyVoteParticipated extends MyVoteItemBase {
  relation: "PARTICIPANT";
  pseudonym: string | null;
  submittedAt: string | null;
  sequenceNumber: number | null;
}

export type MyVoteItem = MyVoteCreated | MyVoteParticipated;

export interface HallVoteItem {
  voteId: string;
  title: string;
  description: string | null;
  creatorUsername: string;
  allowMultiple: boolean;
  endAt: string;
  createdAt: string;
  votedCount: number;
  hasVoted: boolean;
  isCreator: boolean;
}

export interface MyInviteItem {
  inviteId: string;
  voteId: string;
  voteTitle: string;
  creatorUsername: string;
  status: MyInviteStatus;
  phase: VotePhase;
  expiresAt: string | null;
}
