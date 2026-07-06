// FILE: backendAdoption.ts
// Purpose: Persists which backend process a desktop session spawned ({pid, port, token,
//          version}) so a relaunched shell — most importantly the freshly-updated one — can
//          adopt the still-running backend instead of spawning a new one, keeping every agent
//          session and terminal alive across UI restarts (CMux-style).
// Layer: Desktop backend runtime
// Exports: record schema helpers, file IO, liveness/health probes

import * as FS from "node:fs";
import * as Path from "node:path";

export interface BackendAdoptionRecord {
  readonly pid: number;
  readonly port: number;
  readonly token: string;
  readonly version: string;
  readonly startedAt: string;
}

const ADOPTION_FILE_NAME = "backend-adoption.json";

export function resolveBackendAdoptionFilePath(userDataDir: string): string {
  return Path.join(userDataDir, ADOPTION_FILE_NAME);
}

/** Parses and shape-validates a persisted record; null for anything malformed. */
export function parseBackendAdoptionRecord(raw: string): BackendAdoptionRecord | null {
  try {
    const value = JSON.parse(raw) as Partial<BackendAdoptionRecord> | null;
    if (
      !value ||
      typeof value.pid !== "number" ||
      !Number.isInteger(value.pid) ||
      value.pid <= 0 ||
      typeof value.port !== "number" ||
      !Number.isInteger(value.port) ||
      value.port <= 0 ||
      value.port > 65_535 ||
      typeof value.token !== "string" ||
      value.token.length < 16 ||
      typeof value.version !== "string" ||
      value.version.length === 0 ||
      typeof value.startedAt !== "string"
    ) {
      return null;
    }
    return {
      pid: value.pid,
      port: value.port,
      token: value.token,
      version: value.version,
      startedAt: value.startedAt,
    };
  } catch {
    return null;
  }
}

export function readBackendAdoptionRecord(userDataDir: string): BackendAdoptionRecord | null {
  try {
    return parseBackendAdoptionRecord(
      FS.readFileSync(resolveBackendAdoptionFilePath(userDataDir), "utf8"),
    );
  } catch {
    return null;
  }
}

/** The token is a secret: the record is only ever readable by the current user. */
export function writeBackendAdoptionRecord(
  userDataDir: string,
  record: BackendAdoptionRecord,
): void {
  const filePath = resolveBackendAdoptionFilePath(userDataDir);
  FS.mkdirSync(userDataDir, { recursive: true });
  FS.writeFileSync(filePath, JSON.stringify(record, null, 2), { mode: 0o600 });
}

export function clearBackendAdoptionRecord(userDataDir: string): void {
  try {
    FS.rmSync(resolveBackendAdoptionFilePath(userDataDir), { force: true });
  } catch {
    // Best-effort: a stale record is re-validated (pid + health) before any adoption.
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Confirms a backend candidate is actually serving on its recorded port before adopting:
 * the pid may have been recycled by the OS, so liveness alone is not enough. /health is
 * unauthenticated and reports startupReady once subscriptions are up.
 */
export async function probeBackendHealth(port: number, timeoutMs = 3_000): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { status?: string; startupReady?: boolean } | null;
    return body?.status === "ok" && body.startupReady === true;
  } catch {
    return false;
  }
}
