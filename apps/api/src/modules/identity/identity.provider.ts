import { MockIdentityProvider } from "./mock.provider";
import { HttpIdentityProvider } from "./http.provider";

export interface IdentityInput {
  realName: string;
  idNumber: string;
}

export interface IdentityResult {
  ok: boolean;
  reference?: string;
  unavailable?: boolean;
  reason?: string;
}

export interface IdentityProvider {
  verify(input: IdentityInput): Promise<IdentityResult>;
}

export function getIdentityProvider(): IdentityProvider {
  const mode = (process.env.IDENTITY_PROVIDER || "").trim().toLowerCase();
  if (mode === "http") {
    return new HttpIdentityProvider();
  }
  if (mode === "mock") {
    return new MockIdentityProvider();
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("IDENTITY_PROVIDER must be configured (mock or http) in production");
  }
  return new MockIdentityProvider();
}
