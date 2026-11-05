import { beforeEach, describe, expect, it } from "vitest";
import { AuthService, toPublicUser } from "./auth.service";
import { prisma } from "../../utils/prisma";
import { resetDb } from "../../test/db";
import { resetRateLimits } from "../../utils/rate-limit";

const okProvider = { verify: async () => ({ ok: true, reference: "ref-1" }) };
const badProvider = { verify: async () => ({ ok: false, reason: "mismatch" }) };
const downProvider = { verify: async () => { throw new Error("timeout"); } };

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

describe("AuthService.register", () => {
  it("approves and creates account when the identity provider verifies", async () => {
    const { user } = await new AuthService(okProvider as any).register({
      username: "alice",
      password: "secret1",
      realName: "张三",
      idNumber: "110101199001011234",
      ip: "1.1.1.1",
    });

    expect(user.status).toBe("APPROVED");

    const saved = await prisma.user.findUniqueOrThrow({ where: { username: "alice" } });
    expect(saved.idNumber).toBe("");
    expect(saved.idCardImages).toBe("[]");
    expect(saved.idNumberHash).toHaveLength(64);
    expect(saved.identityVerificationRef).toBe("ref-1");
  });

  it("rejects registration when the identity provider denies", async () => {
    await expect(
      new AuthService(badProvider as any).register({
        username: "alice",
        password: "secret1",
        realName: "张三",
        idNumber: "110101199001011234",
        ip: "1.1.1.1",
      })
    ).rejects.toMatchObject({ status: 400 });

    expect(await prisma.user.count()).toBe(0);
  });

  it("keeps PENDING_VERIFICATION when the identity provider is unavailable", async () => {
    const { user } = await new AuthService(downProvider as any).register({
      username: "alice",
      password: "secret1",
      realName: "张三",
      idNumber: "110101199001011234",
      ip: "1.1.1.1",
    });

    expect(user.status).toBe("PENDING_VERIFICATION");

    const saved = await prisma.user.findUniqueOrThrow({ where: { username: "alice" } });
    expect(saved.identityVerifiedAt).toBeNull();
  });

  it("rejects malformed id numbers", async () => {
    await expect(
      new AuthService(okProvider as any).register({
        username: "alice",
        password: "secret1",
        realName: "张三",
        idNumber: "123",
        ip: "1.1.1.1",
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("AuthService.register uniqueness / rate limit", () => {
  it("allows only one account per id number", async () => {
    const input = {
      password: "secret1",
      realName: "张三",
      idNumber: "110101199001011234",
      ip: "3.3.3.3",
    };
    await new AuthService(okProvider as any).register({ ...input, username: "alice" });
    await expect(
      new AuthService(okProvider as any).register({ ...input, username: "bob" })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("throws 429 when the registration rate limit is exceeded", async () => {
    const ids = [
      "110101199001011234",
      "110101199001011235",
      "110101199001011236",
      "110101199001011237",
      "110101199001011238",
    ];
    for (let i = 0; i < ids.length; i++) {
      await new AuthService(okProvider as any).register({
        username: `user-${i}`,
        password: "secret1",
        realName: "张三",
        idNumber: ids[i],
        ip: "4.4.4.4",
      });
    }

    await expect(
      new AuthService(okProvider as any).register({
        username: "user-5",
        password: "secret1",
        realName: "张三",
        idNumber: "110101199001011239",
        ip: "4.4.4.4",
      })
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe("AuthService.reverifyIdentity", () => {
  it("approves a pending user after a successful verification", async () => {
    const pending = await new AuthService(downProvider as any).register({
      username: "bob",
      password: "secret1",
      realName: "李四",
      idNumber: "110101199001019999",
      ip: "2.2.2.2",
    });

    const result = await new AuthService(okProvider as any).reverifyIdentity(
      pending.user.id,
      { realName: "李四", idNumber: "110101199001019999", ip: "2.2.2.2" }
    );

    expect(result.user.status).toBe("APPROVED");

    const saved = await prisma.user.findUniqueOrThrow({ where: { username: "bob" } });
    expect(saved.identityVerificationRef).toBe("ref-1");
    expect(saved.identityVerifiedAt).not.toBeNull();
  });

  it("keeps PENDING_VERIFICATION and rejects when the provider denies", async () => {
    const pending = await new AuthService(downProvider as any).register({
      username: "bob",
      password: "secret1",
      realName: "李四",
      idNumber: "110101199001019999",
      ip: "2.2.2.2",
    });

    await expect(
      new AuthService(badProvider as any).reverifyIdentity(pending.user.id, {
        realName: "李四",
        idNumber: "110101199001019999",
        ip: "2.2.2.2",
      })
    ).rejects.toMatchObject({ status: 400 });

    const saved = await prisma.user.findUniqueOrThrow({ where: { username: "bob" } });
    expect(saved.status).toBe("PENDING_VERIFICATION");
  });

  it("returns 503 and keeps PENDING_VERIFICATION when the provider is unavailable", async () => {
    const pending = await new AuthService(downProvider as any).register({
      username: "bob",
      password: "secret1",
      realName: "李四",
      idNumber: "110101199001019999",
      ip: "2.2.2.2",
    });

    await expect(
      new AuthService(downProvider as any).reverifyIdentity(pending.user.id, {
        realName: "李四",
        idNumber: "110101199001019999",
        ip: "2.2.2.2",
      })
    ).rejects.toMatchObject({ status: 503 });

    const saved = await prisma.user.findUniqueOrThrow({ where: { username: "bob" } });
    expect(saved.status).toBe("PENDING_VERIFICATION");
  });

  it("rejects re-verification of an already approved user", async () => {
    const approved = await new AuthService(okProvider as any).register({
      username: "carol",
      password: "secret1",
      realName: "王五",
      idNumber: "110101199001019998",
      ip: "6.6.6.6",
    });

    await expect(
      new AuthService(okProvider as any).reverifyIdentity(approved.user.id, {
        realName: "王五",
        idNumber: "110101199001019998",
        ip: "6.6.6.6",
      })
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("toPublicUser", () => {
  it("omits sensitive fields", async () => {
    const { user } = await new AuthService(okProvider as any).register({
      username: "alice",
      password: "secret1",
      realName: "张三",
      idNumber: "110101199001011234",
      ip: "5.5.5.5",
    });

    const saved = await prisma.user.findUniqueOrThrow({ where: { username: "alice" } });
    const published = toPublicUser(saved);

    expect(published.id).toBe(saved.id);
    expect(published.username).toBe("alice");
    expect(published.status).toBe("APPROVED");
    expect(published.realName).toBe("张三");
    expect(published).not.toHaveProperty("idNumber");
    expect(published).not.toHaveProperty("idCardImages");
    expect(published).not.toHaveProperty("password");
  });
});
