/**
 * 带 HTTP 状态码的业务错误。
 *
 * Service 层只负责抛错，Controller 统一用 statusCodeOf() 映射成响应状态，
 * 避免把「已投票」「未开始」这类业务冲突一律当成 400。
 */
export class AppError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

export function statusCodeOf(error: unknown, fallback = 400): number {
  if (error instanceof AppError) return error.status;
  return fallback;
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
