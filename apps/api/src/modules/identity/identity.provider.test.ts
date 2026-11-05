import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getIdentityProvider } from "./identity.provider";
import { MockIdentityProvider } from "./mock.provider";
import { HttpIdentityProvider } from "./http.provider";
import { isValidIdNumber } from "../../utils/identity";

const ENV_KEYS = ["IDENTITY_PROVIDER", "MOCK_ID_NUMBERS", "NODE_ENV"];
const originals: Record<string, string | undefined> = {};

describe("identity provider", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originals[key] = process.env[key];
    }
    process.env.MOCK_ID_NUMBERS = "";
    process.env.IDENTITY_PROVIDER = "mock";
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      process.env[key] = originals[key];
    }
  });

  it("returns the mock provider when IDENTITY_PROVIDER=mock", () => {
    expect(getIdentityProvider()).toBeInstanceOf(MockIdentityProvider);
  });

  it("returns the http provider when IDENTITY_PROVIDER=http", () => {
    process.env.IDENTITY_PROVIDER = "http";
    expect(getIdentityProvider()).toBeInstanceOf(HttpIdentityProvider);
  });

  it("returns the mock provider when IDENTITY_PROVIDER is unset and not production", () => {
    process.env.IDENTITY_PROVIDER = "";
    expect(getIdentityProvider()).toBeInstanceOf(MockIdentityProvider);
  });

  it("throws when IDENTITY_PROVIDER is unset in production", () => {
    process.env.IDENTITY_PROVIDER = "";
    process.env.NODE_ENV = "production";
    expect(() => getIdentityProvider()).toThrow();
  });

  it("mock verifies the default whitelisted id number", async () => {
    const result = await getIdentityProvider().verify({
      realName: "张三",
      idNumber: "110101199001011234",
    });
    expect(result.ok).toBe(true);
    expect(result.reference).toBeTruthy();
  });

  it("mock rejects malformed or non-whitelisted id numbers", async () => {
    const provider = getIdentityProvider();
    expect((await provider.verify({ realName: "张三", idNumber: "123" })).ok).toBe(false);
    expect((await provider.verify({ realName: "张三", idNumber: "110101199001011235" })).ok).toBe(false);
  });

  it("validates the 18-digit mainland id format", () => {
    expect(isValidIdNumber("110101199001011234")).toBe(true);
    expect(isValidIdNumber("11010119900101123x")).toBe(true);
    expect(isValidIdNumber("11010119900101123")).toBe(false);
    expect(isValidIdNumber("1101011990010112345")).toBe(false);
  });
});
