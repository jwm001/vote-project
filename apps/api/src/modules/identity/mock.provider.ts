import type { IdentityInput, IdentityProvider, IdentityResult } from "./identity.provider";
import { hashIdNumber, normalizeIdNumber } from "../../utils/identity";

const DEFAULT_MOCK_ID_NUMBERS = "110101199001011234";

export class MockIdentityProvider implements IdentityProvider {
  async verify(input: IdentityInput): Promise<IdentityResult> {
    const idNumber = normalizeIdNumber(input.idNumber);

    if (!/^\d{17}[\dX]$/.test(idNumber)) {
      return { ok: false, reason: "invalid_id_number" };
    }

    const allowed = (process.env.MOCK_ID_NUMBERS || DEFAULT_MOCK_ID_NUMBERS)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const allowedSet = new Set(allowed);

    if (!allowedSet.has(idNumber)) {
      return { ok: false, reason: "mock_rejected" };
    }

    return { ok: true, reference: "mock:" + hashIdNumber(idNumber).slice(0, 16) };
  }
}
