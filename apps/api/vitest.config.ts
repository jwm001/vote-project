import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./src/test/global-setup.ts"],
    env: {
      DATABASE_URL: "file:./test.db",
      JWT_SECRET: "test-secret-key",
      ENCRYPTION_KEY: "test-encryption-key",
      ID_HASH_SECRET: "test-id-hash-secret",
      IDENTITY_PROVIDER: "mock",
    },
    fileParallelism: false,
  },
});
