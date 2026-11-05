/**
 * 进程内内存限流。
 *
 * key 通常是业务前缀 + 用户/IP，例如 `register:1.2.3.4`。
 * 返回 true 表示该请求通过限流，false 表示已超限（调用方应抛 429）。
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  key: string,
  limit = 5,
  windowMs = 3_600_000,
  now = Date.now()
): boolean {
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) {
    return false;
  }

  bucket.count += 1;
  return true;
}

export function resetRateLimits(): void {
  buckets.clear();
}
