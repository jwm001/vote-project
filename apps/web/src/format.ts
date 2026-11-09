/**
 * 统一以 UTC 展示时间，避免用户把本地时间当成记录时间。
 * 空值或无法解析时显示破折号。
 */
export function formatUtc(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
