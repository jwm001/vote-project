/**
 * 实名脱敏：只保留足够区分「不同人」的首尾字符，不泄露完整姓名。
 *
 * - 1 个字符 → `*`
 * - 2 个字符 → 首字 + `*`
 * - 3 个及以上 → 首字 + `*` + 末字
 * - null / 空字符串 → `*`
 */
export function maskRealName(name: string | null | undefined): string {
  if (!name) return "*";

  // 用 Array.from 而不是 name.length，避免把代理对拆成两个半字符。
  const chars = Array.from(name);
  if (chars.length === 0) return "*";
  if (chars.length === 1) return "*";
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}*${chars[chars.length - 1]}`;
}
