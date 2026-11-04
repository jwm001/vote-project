import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const apiRoot = path.resolve(__dirname, "../..");
const testDbPath = path.resolve(apiRoot, "prisma", "test.db");

export default async function globalSetup() {
  // Start from a clean slate so rows from previous runs cannot leak into tests.
  for (const suffix of ["", "-journal"]) {
    const dbPath = `${testDbPath}${suffix}`;
    if (fs.existsSync(dbPath)) {
      fs.rmSync(dbPath, { force: true });
    }
  }

  try {
    execSync("npx prisma db push --skip-generate --accept-data-loss", {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: "file:./test.db" },
      stdio: "pipe",
    });
  } catch (error: any) {
    throw new Error(
      `Failed to set up test database: ${error?.message}\nstdout: ${error?.stdout}\nstderr: ${error?.stderr}`
    );
  }
}
