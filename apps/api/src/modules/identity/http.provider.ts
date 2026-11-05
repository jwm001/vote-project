import type { IdentityInput, IdentityProvider, IdentityResult } from "./identity.provider";

const TIMEOUT_MS = 8000;

export class HttpIdentityProvider implements IdentityProvider {
  async verify(input: IdentityInput): Promise<IdentityResult> {
    const url = process.env.IDENTITY_API_URL;
    if (!url) {
      throw new Error("IDENTITY_API_URL is not configured");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.IDENTITY_API_KEY ?? ""}`,
        },
        body: JSON.stringify({ realName: input.realName, idNumber: input.idNumber }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Identity API responded with status ${response.status}`);
      }

      const data = (await response.json()) as {
        ok?: boolean;
        reference?: string;
        reason?: string;
      };

      return {
        ok: Boolean(data?.ok),
        reference: data?.reference,
        reason: data?.reason,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
