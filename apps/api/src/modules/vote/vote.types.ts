export type ParticipationMode = "OPEN_LINK" | "INVITE_ONLY";
export type VotePhase = "DRAFT" | "LIVE" | "ENDED";

export interface VoteViewer {
  id: string;
  role: string;
  status: string;
}

export interface CreateVoteInput {
  creatorId: string;
  title: string;
  description?: string;
  allowMultiple: boolean;
  participationMode: ParticipationMode;
  resultsPublicDuringVote?: boolean;
  listedInHall?: boolean;
  endAt?: Date;
  durationMinutes?: number;
  options: string[];
}

export interface UpdateVoteInput {
  title?: string;
  description?: string;
  allowMultiple?: boolean;
  resultsPublicDuringVote?: boolean;
  endAt?: Date;
  durationMinutes?: number;
  options?: string[];
}

export interface MyVoteItemBase {
  voteId: string;
  voteTitle: string;
  participationMode: ParticipationMode;
  phase: VotePhase;
  allowMultiple: boolean;
  startAt: Date;
  endAt: Date;
  votedCount: number;
  eligibleCount: number | null;
}

export interface MyVoteCreated extends MyVoteItemBase {
  relation: "CREATOR";
}

export interface MyVoteParticipated extends MyVoteItemBase {
  relation: "PARTICIPANT";
  pseudonym: string | null;
  submittedAt: Date | null;
  sequenceNumber: number | null;
}

export type MyVoteItem = MyVoteCreated | MyVoteParticipated;
