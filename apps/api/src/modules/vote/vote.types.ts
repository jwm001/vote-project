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
