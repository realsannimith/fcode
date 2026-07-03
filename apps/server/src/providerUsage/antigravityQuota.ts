// FILE: providerUsage/antigravityQuota.ts
// Purpose: Fetch Gemini/Antigravity usage the way OpenUsage does — read the OAuth token straight
// from the macOS Keychain (service `gemini`, account `antigravity`, a `go-keyring-base64`-wrapped
// JSON blob written by the Antigravity app / `agy`), refresh it through Google OAuth when expired,
// and call Google Cloud Code `retrieveUserQuotaSummary` for the shared Gemini pool (5h + weekly).
// This is what lets FCode show Antigravity usage without spawning `agy` (whose background session
// can't reach the credential — see providerUsage/providers/gemini.ts for the legacy CLI path).
// Reference: robinebers/openusage Sources/OpenUsage/Providers/Antigravity.

import type { ServerProviderUsageLimit, ServerProviderUsageSnapshot } from "@t3tools/contracts";

import { readKeychainPassword } from "./credentials";
import { fetchJson, isAuthFailureStatus } from "./http";
import {
  asFiniteNumber,
  asRecord,
  asString,
  buildSnapshot,
  clampPercent,
  errorSnapshot,
  isoFromString,
  needsAuthSnapshot,
} from "./parse";
import type { ProviderUsageContext } from "./types";

const SOURCE = "antigravity-cloud-code";
const KEYCHAIN_SERVICE = "gemini";
const KEYCHAIN_ACCOUNT = "antigravity";
const GO_KEYRING_PREFIX = "go-keyring-base64:";

// Try the daily endpoint first (matches the Antigravity app), then the stable one.
const CLOUD_CODE_BASE_URLS = [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
] as const;
const QUOTA_SUMMARY_PATH = "/v1internal:retrieveUserQuotaSummary";
const GOOGLE_OAUTH_URL = "https://oauth2.googleapis.com/token";

// Google "installed application" OAuth client used for the refresh-token grant. The Antigravity
// app bundle ships its own pair, but no credentials are hardcoded here — supply them via
// T3CODE_ANTIGRAVITY_GOOGLE_CLIENT_ID / T3CODE_ANTIGRAVITY_GOOGLE_CLIENT_SECRET to enable token
// refresh. Without them, quota polling still works while the keychain access token is fresh and
// reports needs-auth once it expires.
const GOOGLE_CLIENT_ID = process.env.T3CODE_ANTIGRAVITY_GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.T3CODE_ANTIGRAVITY_GOOGLE_CLIENT_SECRET ?? "";

// Treat a token with less than this left as already expired (refresh proactively).
const TOKEN_REFRESH_BUFFER_MS = 60_000;

// The authoritative `retrieveUserQuotaSummary` pool buckets, matched by exact id. Only the Gemini
// pool is surfaced under FCode's Gemini provider (the `3p-*` buckets are the non-Gemini pool).
const GEMINI_SUMMARY_BUCKETS: ReadonlyArray<{
  readonly bucketId: string;
  readonly window: string;
  readonly windowDurationMins: number;
}> = [
  { bucketId: "gemini-5h", window: "5h", windowDurationMins: 300 },
  { bucketId: "gemini-weekly", window: "Weekly", windowDurationMins: 10_080 },
];

interface AntigravityToken {
  readonly accessToken: string | undefined;
  readonly refreshToken: string | undefined;
  readonly expiryMs: number | undefined;
}

// A refreshed access token lives longer than the 60s usage poll, so cache it in-memory to avoid a
// Google OAuth round-trip every cycle. Never written back to the Antigravity keychain item.
let cachedRefreshedToken: { accessToken: string; expiresAtMs: number } | null = null;

function unwrapGoKeyring(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(GO_KEYRING_PREFIX)) {
    return trimmed;
  }
  const encoded = trimmed.slice(GO_KEYRING_PREFIX.length).trim();
  try {
    return Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return trimmed;
  }
}

function firstString(
  record: Record<string, unknown>,
  keys: ReadonlyArray<string>,
): string | undefined {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

// Mirrors agy's shape: an optional nested `token` object over `{ access_token, refresh_token,
// expiry }`, with root-level and camelCase fallbacks.
export function parseAntigravityKeychainToken(raw: string): AntigravityToken | null {
  const text = unwrapGoKeyring(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A bare token string (not JSON) is still usable as the access token.
    const bare = text.trim();
    return bare.length > 0
      ? { accessToken: bare, refreshToken: undefined, expiryMs: undefined }
      : null;
  }

  const root = asRecord(parsed);
  if (!root) {
    return null;
  }
  const source = asRecord(root.token) ?? root;
  const accessToken = firstString(source, [
    "access_token",
    "accessToken",
    "token",
    "id_token",
    "idToken",
  ]);
  const refreshToken = firstString(source, ["refresh_token", "refreshToken"]);
  const expiryIso = firstString(source, ["expiry", "expires_at", "expiresAt"]);
  const expiryMs = expiryIso ? Date.parse(expiryIso) : undefined;

  if (!accessToken && !refreshToken) {
    return null;
  }
  return {
    accessToken,
    refreshToken,
    expiryMs: Number.isFinite(expiryMs) ? expiryMs : undefined,
  };
}

async function readAntigravityToken(ctx: ProviderUsageContext): Promise<AntigravityToken | null> {
  const raw = await readKeychainPassword({
    service: KEYCHAIN_SERVICE,
    account: KEYCHAIN_ACCOUNT,
    platform: ctx.platform,
  });
  if (!raw) {
    return null;
  }
  return parseAntigravityKeychainToken(raw);
}

function isUsable(expiryMs: number | undefined, nowMs: number): boolean {
  return expiryMs === undefined || expiryMs - nowMs > TOKEN_REFRESH_BUFFER_MS;
}

// Google's token endpoint wants form-encoded credentials incl. the installed-app client secret —
// distinct enough from the shared JSON refresh helper that it lives here.
async function refreshGoogleToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAtMs: number } | null> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return null;
  }
  const form = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  let response: Response;
  try {
    response = await fetch(GOOGLE_OAUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  const json = asRecord(await response.json().catch(() => null));
  const accessToken = asString(json?.access_token);
  if (!accessToken) {
    return null;
  }
  const expiresIn = asFiniteNumber(json?.expires_in) ?? 3600;
  return { accessToken, expiresAtMs: Date.now() + expiresIn * 1000 };
}

interface QuotaFetch {
  readonly ok: boolean;
  readonly authFailed: boolean;
  readonly json: unknown;
}

async function fetchQuotaSummary(accessToken: string): Promise<QuotaFetch> {
  let authFailed = false;
  for (const base of CLOUD_CODE_BASE_URLS) {
    let result;
    try {
      result = await fetchJson({
        url: base + QUOTA_SUMMARY_PATH,
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "antigravity",
        },
        body: {},
      });
    } catch {
      continue;
    }
    if (isAuthFailureStatus(result.status)) {
      authFailed = true;
      continue;
    }
    if (result.ok) {
      return { ok: true, authFailed: false, json: result.json };
    }
  }
  return { ok: false, authFailed, json: null };
}

// `retrieveUserQuotaSummary` → the Gemini pool's 5h + weekly meters. Accepts the LS envelope
// (`{response:{groups}}`) and the bare remote payload (`{groups}`). A bucket with no usable
// `remainingFraction` is dropped (its row reads "No data") rather than fabricated.
export function parseAntigravityQuotaSummary(
  json: unknown,
  nowMs: number,
): ServerProviderUsageSnapshot | null {
  const root = asRecord(json);
  const groupsSource = asRecord(root?.response)?.groups ?? root?.groups;
  if (!Array.isArray(groupsSource)) {
    return null;
  }

  const byBucketId = new Map<string, { fraction: number; resetsAt: string | undefined }>();
  for (const group of groupsSource) {
    const buckets = asRecord(group)?.buckets;
    if (!Array.isArray(buckets)) {
      continue;
    }
    for (const rawBucket of buckets) {
      const bucket = asRecord(rawBucket);
      const id = asString(bucket?.bucketId);
      const fraction = asFiniteNumber(bucket?.remainingFraction);
      if (!id || fraction === undefined || byBucketId.has(id)) {
        continue;
      }
      byBucketId.set(id, { fraction, resetsAt: isoFromString(bucket?.resetTime) });
    }
  }

  const limits: ServerProviderUsageLimit[] = [];
  for (const spec of GEMINI_SUMMARY_BUCKETS) {
    const entry = byBucketId.get(spec.bucketId);
    if (!entry) {
      continue;
    }
    const usedPercent = clampPercent((1 - entry.fraction) * 100);
    if (usedPercent === undefined) {
      continue;
    }
    limits.push({
      window: spec.window,
      usedPercent,
      windowDurationMins: spec.windowDurationMins,
      ...(entry.resetsAt ? { resetsAt: entry.resetsAt } : {}),
    });
  }

  return buildSnapshot({ provider: "gemini", nowMs, status: "ok", source: SOURCE, limits });
}

/**
 * Fetch Antigravity usage via the Keychain token → Google Cloud Code path. Returns null when there
 * is no Antigravity keychain token at all (the caller then falls back to the legacy Gemini CLI
 * credential file). Never throws.
 */
export async function fetchAntigravityUsageSnapshot(
  ctx: ProviderUsageContext,
): Promise<ServerProviderUsageSnapshot | null> {
  const token = await readAntigravityToken(ctx);
  if (!token) {
    return null;
  }

  // Assemble the tokens to try: a live keychain access token, then any cached refreshed token.
  const candidates: string[] = [];
  if (token.accessToken && isUsable(token.expiryMs, ctx.nowMs)) {
    candidates.push(token.accessToken);
  }
  if (
    cachedRefreshedToken &&
    cachedRefreshedToken.expiresAtMs - ctx.nowMs > TOKEN_REFRESH_BUFFER_MS &&
    !candidates.includes(cachedRefreshedToken.accessToken)
  ) {
    candidates.push(cachedRefreshedToken.accessToken);
  }

  let sawAuthFailure = false;
  for (const accessToken of candidates) {
    const result = await fetchQuotaSummary(accessToken);
    if (result.ok) {
      const snapshot = parseAntigravityQuotaSummary(result.json, ctx.nowMs);
      return (
        snapshot ??
        errorSnapshot("gemini", ctx.nowMs, SOURCE, "Antigravity quota response was unrecognized.")
      );
    }
    if (result.authFailed) {
      sawAuthFailure = true;
    }
  }

  // Refresh only on evidence of auth failure (or nothing to try) — a transient outage must not
  // trigger a Google OAuth refresh every cycle.
  if ((sawAuthFailure || candidates.length === 0) && token.refreshToken) {
    const refreshed = await refreshGoogleToken(token.refreshToken);
    if (!refreshed) {
      // A dead refresh token reads as sign-in needed; a transient refresh outage is reported the
      // same way here (the next cycle retries) rather than as a hard error.
      return needsAuthSnapshot("gemini", ctx.nowMs, SOURCE);
    }
    cachedRefreshedToken = refreshed;
    const result = await fetchQuotaSummary(refreshed.accessToken);
    if (result.ok) {
      const snapshot = parseAntigravityQuotaSummary(result.json, ctx.nowMs);
      return (
        snapshot ??
        errorSnapshot("gemini", ctx.nowMs, SOURCE, "Antigravity quota response was unrecognized.")
      );
    }
    if (result.authFailed) {
      return needsAuthSnapshot("gemini", ctx.nowMs, SOURCE);
    }
    return errorSnapshot(
      "gemini",
      ctx.nowMs,
      SOURCE,
      "Could not reach the Antigravity quota service.",
    );
  }

  // Had a token but every attempt failed without a clear auth error → transient outage.
  if (candidates.length > 0) {
    return errorSnapshot(
      "gemini",
      ctx.nowMs,
      SOURCE,
      "Could not reach the Antigravity quota service.",
    );
  }
  // A keychain entry with neither a usable access token nor a refresh token → needs sign-in.
  return needsAuthSnapshot("gemini", ctx.nowMs, SOURCE);
}
