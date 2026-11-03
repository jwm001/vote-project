import crypto from "crypto";

/**
 * 身份证号规范化：去掉所有空白与连字符，末位 x 统一为大写。
 * 只做「同一个人输入不同写法」的归一，不做校验位校验。
 */
export function normalizeIdNumber(raw: string): string {
  return String(raw ?? "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
}

function hashKey(): string {
  return (
    process.env.ID_HASH_SECRET ||
    process.env.ENCRYPTION_KEY ||
    "test-encryption-key"
  );
}

/**
 * 身份证号摘要。
 *
 * 用 HMAC 而不是裸 SHA-256：身份证号空间很小（约 10^17 且有校验位约束），
 * 裸哈希可以被穷举反查；带密钥的 HMAC 在没有密钥时无法离线爆破。
 *
 * 同一身份 → 同一摘要，用于 User.idNumberHash 唯一索引实现「一人一号」。
 */
export function hashIdNumber(rawIdNumber: string): string {
  const normalized = normalizeIdNumber(rawIdNumber);
  return crypto.createHmac("sha256", hashKey()).update(normalized).digest("hex");
}
