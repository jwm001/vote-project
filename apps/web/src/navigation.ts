/**
 * 只接受站内绝对路径，避免 `?redirect=` 被用来跳到外站。
 * 反斜杠会被浏览器当作 `/`，所以也必须拒绝，否则 `/\evil.com` 会绕过检查。
 */
export function safePath(raw: string | null): string | null {
  if (!raw) return null;
  if (raw.includes("\\")) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}
