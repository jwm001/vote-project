import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app";

const originalCorsOrigin = process.env.CORS_ORIGIN;

afterEach(() => {
  if (originalCorsOrigin === undefined) {
    delete process.env.CORS_ORIGIN;
  } else {
    process.env.CORS_ORIGIN = originalCorsOrigin;
  }
});

describe("app", () => {
  it("GET /health returns ok", async () => {
    const res = await request(createApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  // 同域部署不需要 CORS 头；默认全开会让任意站点带着用户 token 调接口。
  it("does not send CORS headers by default", async () => {
    delete process.env.CORS_ORIGIN;
    const res = await request(createApp())
      .get("/health")
      .set("Origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows only the origins listed in CORS_ORIGIN", async () => {
    process.env.CORS_ORIGIN = "https://vote.example.com";

    const allowed = await request(createApp())
      .get("/health")
      .set("Origin", "https://vote.example.com");
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "https://vote.example.com"
    );

    const blocked = await request(createApp())
      .get("/health")
      .set("Origin", "https://evil.example");
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });

  // 部署在 Nginx 后面时，限流按 req.ip 计数，必须信任代理头里的真实地址。
  it("trusts the forwarded client ip from the proxy", async () => {
    const app = createApp();
    app.get("/whoami", (req, res) => res.json({ ip: req.ip }));

    const res = await request(app)
      .get("/whoami")
      .set("X-Forwarded-For", "203.0.113.9");
    expect(res.body.ip).toBe("203.0.113.9");
  });
});
