import { beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { AuthService } from "../auth/auth.service";
import { AdminService } from "./admin.service";
import { prisma } from "../../utils/prisma";
import { resetDb } from "../../test/db";
import { resetRateLimits } from "../../utils/rate-limit";

const okProvider = { verify: async () => ({ ok: true, reference: "ref-1" }) };
const authService = new AuthService(okProvider as any);
const adminService = new AdminService();

async function createUser(username: string) {
  return prisma.user.create({
    data: {
      username,
      password: await bcrypt.hash("oldpass", 10),
      realName: "enc",
      status: "APPROVED",
      idNumberHash: `hash-${username}`,
    },
  });
}

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

describe("AdminService.listUsers", () => {
  it("returns only safe fields and never sensitive data", async () => {
    const user = await createUser("alice");

    const users = await adminService.listUsers();
    const item = users.find((u) => u.id === user.id);

    expect(item).toBeDefined();
    expect(item!.username).toBe("alice");
    expect(item!.status).toBe("APPROVED");
    expect(item).not.toHaveProperty("password");
    expect(item).not.toHaveProperty("idNumber");
    expect(item).not.toHaveProperty("idNumberHash");
    expect(item).not.toHaveProperty("idCardImages");
  });
});

describe("AdminService.resetPassword", () => {
  it("returns a temporary password that can log in", async () => {
    const user = await createUser("bob");

    const result = await adminService.resetPassword(user.id);

    expect(result.temporaryPassword).toBeDefined();
    expect(typeof result.temporaryPassword).toBe("string");

    const login = await authService.login({
      username: user.username,
      password: result.temporaryPassword,
    });
    expect(login.token).toBeDefined();
  });

  it("throws 404 when the user does not exist", async () => {
    await expect(adminService.resetPassword("missing-user-id")).rejects.toMatchObject({ status: 404 });
  });
});

describe("AuthService.changePassword", () => {
  it("throws 400 when the current password is wrong", async () => {
    const user = await createUser("carol");

    await expect(authService.changePassword(user.id, "wrongpass", "newpass1")).rejects.toMatchObject({ status: 400 });
  });

  it("changes the password and invalidates the old one", async () => {
    const user = await createUser("dave");

    const result = await authService.changePassword(user.id, "oldpass", "newpass1");

    expect(result.user.id).toBe(user.id);

    await expect(authService.login({ username: user.username, password: "oldpass" })).rejects.toMatchObject({ status: 401 });
    const login = await authService.login({ username: user.username, password: "newpass1" });
    expect(login.token).toBeDefined();
  });

  it("throws 404 when the user does not exist", async () => {
    await expect(authService.changePassword("missing-user-id", "oldpass", "newpass1")).rejects.toMatchObject({ status: 404 });
  });
});
