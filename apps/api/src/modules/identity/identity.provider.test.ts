import { beforeEach, describe, expect, it } from "vitest";
import { getIdentityProvider } from "./identity.provider";
import { MockIdentityProvider } from "./mock.provider";
import { HttpIdentityProvider } from "./http.provider";

describe("identity provider", () => {
  beforeEach(() => {
    delete process.env.MOCK_ID_NUMBERS;
    process.env.IDENTITY_PROVIDER = "mock";
  });

  it("returns the mock provider when IDENTITY_PROVIDER=mock", () => {
    expect(getIdentityProvider()).toBeInstanceOf(MockIdentityProvider);
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
});
