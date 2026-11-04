import { execSync } from "node:child_process";

export default async function globalSetup() {
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "inherit",
  });
}
