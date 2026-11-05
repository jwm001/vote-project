import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../utils/prisma";
import { resetDb } from "../test/db";
import { cleanupLegacyIdentity } from "./cleanup-legacy-identity";

describe("cleanupLegacyIdentity", () => {
  let uploadsDir: string;

  beforeEach(async () => {
    await resetDb();
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-cleanup-"));
  });

  afterEach(() => {
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  });

  it("cleans legacy identity data and deletes the referenced id card image", async () => {
    const user = await prisma.user.create({
      data: {
        username: "legacy",
        password: "x",
        realName: "enc",
        idNumber: "encrypted-id",
        idCardImages: JSON.stringify(["uploads/a.jpg"]),
        status: "APPROVED",
      },
    });
    fs.writeFileSync(path.join(uploadsDir, "a.jpg"), "x");

    const result = await cleanupLegacyIdentity({ prisma, uploadsDir });

    expect(result.files).toBe(1);
    expect(result.users).toBe(1);
    expect(fs.existsSync(path.join(uploadsDir, "a.jpg"))).toBe(false);
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(saved.idNumber).toBe("");
    expect(saved.idCardImages).toBe("[]");
    expect(saved.identityVerificationRef).toBe("legacy");
    expect(saved.identityVerifiedAt).toEqual(saved.createdAt);
  });

  it("migrates legacy PENDING users to PENDING_VERIFICATION", async () => {
    const user = await prisma.user.create({
      data: {
        username: "pending",
        password: "x",
        realName: "enc",
        status: "PENDING",
      },
    });

    const result = await cleanupLegacyIdentity({ prisma, uploadsDir });

    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(saved.status).toBe("PENDING_VERIFICATION");
    expect(result.users).toBe(1);
  });

  it("ignores invalid JSON and empty filenames, and dedupes image entries", async () => {
    const user = await prisma.user.create({
      data: {
        username: "garbage",
        password: "x",
        realName: "enc",
        idNumber: "encrypted-id",
        idCardImages: "not-json{{",
        status: "APPROVED",
      },
    });
    fs.writeFileSync(path.join(uploadsDir, "should-not-exist.jpg"), "x");

    const result = await cleanupLegacyIdentity({ prisma, uploadsDir });

    expect(result.files).toBe(0);
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(saved.idCardImages).toBe("[]");
  });

  it("is idempotent and does not re-count already deleted files", async () => {
    const user = await prisma.user.create({
      data: {
        username: "legacy-again",
        password: "x",
        realName: "enc",
        idNumber: "encrypted-id",
        idCardImages: JSON.stringify(["uploads/a.jpg"]),
        status: "APPROVED",
      },
    });
    fs.writeFileSync(path.join(uploadsDir, "a.jpg"), "x");

    const first = await cleanupLegacyIdentity({ prisma, uploadsDir });
    expect(first.files).toBe(1);

    const second = await cleanupLegacyIdentity({ prisma, uploadsDir });

    expect(second.files).toBe(0);
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(saved.idNumber).toBe("");
    expect(saved.idCardImages).toBe("[]");
  });
});
