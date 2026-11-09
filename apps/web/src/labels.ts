import type { MyInviteStatus, VotePhase } from "./types";

export function phaseLabel(phase: VotePhase | string): string {
  if (phase === "DRAFT") return "未开始";
  if (phase === "LIVE") return "进行中";
  if (phase === "ENDED") return "已结束";
  return phase;
}

export function phasePillClass(phase: VotePhase | string): string {
  if (phase === "LIVE") return "pill pill--live";
  if (phase === "DRAFT") return "pill pill--draft";
  if (phase === "ENDED") return "pill pill--ended";
  return "pill";
}

export function inviteStatusLabel(status: MyInviteStatus | string): string {
  if (status === "INVITED") return "待接受";
  if (status === "ACCEPTED") return "已接受";
  if (status === "EXPIRED") return "已过期";
  if (status === "REMOVED") return "已移除";
  return status;
}

export function inviteStatusPillClass(status: MyInviteStatus | string): string {
  if (status === "ACCEPTED") return "pill pill--live";
  if (status === "INVITED") return "pill pill--draft";
  if (status === "EXPIRED") return "pill pill--ended";
  return "pill";
}
