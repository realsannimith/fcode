// FILE: providerUsage/antigravityQuota.test.ts
// Purpose: Guards the pure Antigravity usage parsers — the keychain token blob and the
// retrieveUserQuotaSummary response.

import { describe, expect, it } from "vitest";

import { parseAntigravityKeychainToken, parseAntigravityQuotaSummary } from "./antigravityQuota";

function goKeyring(payload: unknown): string {
  return `go-keyring-base64:${Buffer.from(JSON.stringify(payload)).toString("base64")}`;
}

describe("parseAntigravityKeychainToken", () => {
  it("extracts access/refresh/expiry from a go-keyring-base64 nested token blob", () => {
    const raw = goKeyring({
      token: {
        access_token: "ya29.access",
        refresh_token: "1//refresh",
        expiry: "2026-07-02T19:15:01.808Z",
      },
    });
    const token = parseAntigravityKeychainToken(raw);
    expect(token?.accessToken).toBe("ya29.access");
    expect(token?.refreshToken).toBe("1//refresh");
    expect(token?.expiryMs).toBe(Date.parse("2026-07-02T19:15:01.808Z"));
  });

  it("reads root-level camelCase fields when there is no nested token object", () => {
    const raw = goKeyring({ accessToken: "AT", refreshToken: "RT" });
    const token = parseAntigravityKeychainToken(raw);
    expect(token?.accessToken).toBe("AT");
    expect(token?.refreshToken).toBe("RT");
    expect(token?.expiryMs).toBeUndefined();
  });

  it("accepts a bare (non-JSON) token string as the access token", () => {
    expect(parseAntigravityKeychainToken("ya29.bare-token")?.accessToken).toBe("ya29.bare-token");
  });

  it("returns null when neither an access nor a refresh token is present", () => {
    expect(parseAntigravityKeychainToken(goKeyring({ token: { nope: 1 } }))).toBeNull();
  });
});

describe("parseAntigravityQuotaSummary", () => {
  const nowMs = Date.parse("2026-07-02T18:00:00.000Z");

  it("maps the gemini pool buckets to Session/Weekly used-percent limits", () => {
    const snapshot = parseAntigravityQuotaSummary(
      {
        response: {
          groups: [
            {
              buckets: [
                {
                  bucketId: "gemini-5h",
                  remainingFraction: 0.93,
                  resetTime: "2026-07-02T21:14:08.000Z",
                },
                { bucketId: "gemini-weekly", remainingFraction: 0.977 },
                // Non-Gemini pool bucket is ignored under the Gemini provider.
                { bucketId: "3p-5h", remainingFraction: 0.5 },
              ],
            },
          ],
        },
      },
      nowMs,
    );

    expect(snapshot?.status).toBe("ok");
    expect(snapshot?.limits).toEqual([
      {
        window: "5h",
        usedPercent: expect.closeTo(7, 5),
        windowDurationMins: 300,
        resetsAt: "2026-07-02T21:14:08.000Z",
      },
      {
        window: "Weekly",
        usedPercent: expect.closeTo(2.3, 5),
        windowDurationMins: 10_080,
      },
    ]);
  });

  it("accepts the bare (non-enveloped) groups payload", () => {
    const snapshot = parseAntigravityQuotaSummary(
      { groups: [{ buckets: [{ bucketId: "gemini-5h", remainingFraction: 1 }] }] },
      nowMs,
    );
    expect(snapshot?.limits).toHaveLength(1);
    expect(snapshot?.limits?.[0]?.usedPercent).toBe(0);
  });

  it("returns null when the payload has no decodable groups (caller falls back)", () => {
    expect(parseAntigravityQuotaSummary({ nope: true }, nowMs)).toBeNull();
  });

  it("drops a bucket with no usable remainingFraction rather than fabricating a value", () => {
    const snapshot = parseAntigravityQuotaSummary(
      { groups: [{ buckets: [{ bucketId: "gemini-5h" }] }] },
      nowMs,
    );
    expect(snapshot?.limits).toEqual([]);
  });
});
