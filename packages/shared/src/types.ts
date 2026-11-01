export enum UserStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
}

export enum UserRole {
  USER = "USER",
  ADMIN = "ADMIN",
}

export interface User {
  id: string;
  realName: string;
  idNumber: string;
  idCardImages: string[];
  status: UserStatus;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface Vote {
  id: string;
  title: string;
  description?: string | null;
  creatorId: string;
  allowMultiple: boolean;
  startAt: Date;
  endAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Option {
  id: string;
  voteId: string;
  text: string;
  order: number;
}

export interface Ballot {
  id: string;
  voteId: string;
  pseudonym: string;
  optionIds: string[];
  submittedAt: Date;
  sequenceNumber: number;
}

export interface UserVoteHistory {
  id: string;
  userId: string;
  voteId: string;
}
