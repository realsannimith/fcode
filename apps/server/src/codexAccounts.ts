// FILE: codexAccounts.ts
// Purpose: Multi-account support for the Codex provider. Every additional account
//          runs against a private "shadow home" directory that holds only the
//          account-specific state (auth.json, models_cache.json) while all other
//          Codex state (sessions, config, caches, sqlite) is symlinked back to the
//          shared CODEX_HOME. Accounts therefore share one session history but keep
//          independent logins, and threads stay resumable under any account.
// Layer: Server runtime utility
// Exports: account home resolution, shadow-home materialization, marker self-healing.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { CodexAccountSettings, CodexServerProviderSettings } from "@t3tools/contracts";

import { expandHomePath, resolveBaseCodexHomePath } from "./codexHomePaths.ts";

// Directories Codex is known to create inside CODEX_HOME that must be shared
// across accounts. Pre-created in the shared home so their symlinks exist in
// the shadow home before Codex first writes to them.
const CODEX_SHARED_HOME_DIRECTORIES = [
  "sessions",
  "archived_sessions",
  "sqlite",
  "shell_snapshots",
  "worktrees",
  "skills",
  "plugins",
  "cache",
  "logs",
] as const;

// Account-private state. These must be real files in the shadow home — a
// symlink back to the shared home would silently share the login and defeat
// account isolation.
const CODEX_ACCOUNT_PRIVATE_ENTRY_NAMES = new Set(["auth.json", "models_cache.json"]);

// Entries that are meaningful per-home and should neither be symlinked into
// the shadow home nor treated as shared state.
const CODEX_SHADOW_LOCAL_ENTRY_NAMES = new Set(["log", "memories", "tmp"]);

// Marker written into every shadow home recording which shared home it
// overlays. Lets the spawn path re-sync symlinks without settings access.
export const CODEX_SHADOW_HOME_MARKER_FILE = ".fcode-shadow-home.json";

export interface CodexAccountHomeResolution {
  readonly sharedHomePath: string;
  readonly effectiveHomePath: string;
  readonly account: CodexAccountSettings | undefined;
}

export type CodexShadowHomeMaterializeResult =
  | { readonly ok: true; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly reason: string };

type CodexAccountProviderSettings = Pick<CodexServerProviderSettings, "accounts" | "homePath">;

/**
 * Effective CODEX_HOME for one account: its explicit shadow path when set,
 * otherwise `<sharedHome>-accounts/<id>` so shadow homes never collide with
 * the shared home or each other.
 */
export function resolveCodexAccountShadowHomePath(
  sharedHomePath: string,
  account: CodexAccountSettings,
): string {
  const explicit = account.shadowHomePath.trim();
  if (explicit) {
    return path.resolve(expandHomePath(explicit));
  }
  return `${path.resolve(sharedHomePath)}-accounts${path.sep}${account.id}`;
}

/**
 * Resolve which CODEX_HOME a session/probe/login should run against.
 * An empty or undefined `accountId` selects the primary account (the shared
 * home itself). Unknown ids return `undefined` so callers can surface a
 * proper error instead of silently using the wrong login.
 */
export function resolveCodexAccountHome(
  settings: CodexAccountProviderSettings,
  accountId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): CodexAccountHomeResolution | undefined {
  const sharedHomePath = path.resolve(resolveBaseCodexHomePath(env, settings.homePath));
  const normalizedId = accountId?.trim() ?? "";
  if (!normalizedId) {
    return { sharedHomePath, effectiveHomePath: sharedHomePath, account: undefined };
  }
  const account = settings.accounts.find((entry) => entry.id === normalizedId);
  if (!account) {
    return undefined;
  }
  return {
    sharedHomePath,
    effectiveHomePath: resolveCodexAccountShadowHomePath(sharedHomePath, account),
    account,
  };
}

function readLinkTargetOrUndefined(linkPath: string): string | undefined {
  try {
    return readlinkSync(linkPath);
  } catch {
    return undefined;
  }
}

function ensureSharedEntrySymlink(input: {
  readonly sharedHomePath: string;
  readonly shadowHomePath: string;
  readonly entryName: string;
  readonly warnings: string[];
}): void {
  const sourcePath = path.join(input.sharedHomePath, input.entryName);
  const linkPath = path.join(input.shadowHomePath, input.entryName);

  let linkStat: ReturnType<typeof lstatSync> | undefined;
  try {
    linkStat = lstatSync(linkPath);
  } catch {
    linkStat = undefined;
  }

  if (linkStat && !linkStat.isSymbolicLink()) {
    // A real file/dir here shadows the shared state for this account only.
    // Left in place (it may be a deliberate override), but surfaced because a
    // diverging `sessions`/`sqlite` dir would break cross-account resume.
    input.warnings.push(
      `'${input.entryName}' exists as a real entry in '${input.shadowHomePath}' and is not shared with '${input.sharedHomePath}'.`,
    );
    return;
  }

  if (linkStat?.isSymbolicLink()) {
    const currentTarget = readLinkTargetOrUndefined(linkPath);
    if (
      currentTarget !== undefined &&
      path.resolve(path.dirname(linkPath), currentTarget) === sourcePath
    ) {
      return;
    }
    rmSync(linkPath, { force: true });
  }

  let sourceIsDirectory = true;
  try {
    sourceIsDirectory = lstatSync(sourcePath).isDirectory();
  } catch {
    // Known shared directories are pre-created; anything else came from
    // readdir so the source should exist. Default to a dir link if racing.
  }
  symlinkSync(sourcePath, linkPath, sourceIsDirectory ? "dir" : "file");
}

function removePrivateEntrySymlink(shadowHomePath: string, entryName: string): void {
  const entryPath = path.join(shadowHomePath, entryName);
  try {
    if (lstatSync(entryPath).isSymbolicLink()) {
      // A symlinked private entry (most importantly auth.json) would share
      // the login between accounts — the exact failure mode shadow homes
      // exist to prevent. Remove it so the account re-authenticates honestly.
      rmSync(entryPath, { force: true });
    }
  } catch {
    // Missing entry — nothing to isolate.
  }
}

function writeShadowHomeMarker(sharedHomePath: string, shadowHomePath: string): void {
  const markerPath = path.join(shadowHomePath, CODEX_SHADOW_HOME_MARKER_FILE);
  const nextContent = `${JSON.stringify({ sharedHomePath }, null, 2)}\n`;
  try {
    if (existsSync(markerPath) && readFileSync(markerPath, "utf8") === nextContent) {
      return;
    }
  } catch {
    // Unreadable marker — rewrite it below.
  }
  writeFileSync(markerPath, nextContent, "utf8");
}

/**
 * Bring a shadow home into shape: shared state symlinked, private state kept
 * as real files, marker recorded for later self-healing. Idempotent; safe to
 * run before every probe/login. Mirrors the Codex home layout used by
 * t3code's authOverlay mode.
 */
export function materializeCodexAccountShadowHome(input: {
  readonly sharedHomePath: string;
  readonly shadowHomePath: string;
}): CodexShadowHomeMaterializeResult {
  const sharedHomePath = path.resolve(input.sharedHomePath);
  const shadowHomePath = path.resolve(input.shadowHomePath);
  if (sharedHomePath === shadowHomePath) {
    return {
      ok: false,
      reason: `Account home '${shadowHomePath}' must differ from the shared Codex home.`,
    };
  }
  if (shadowHomePath.startsWith(`${sharedHomePath}${path.sep}`)) {
    return {
      ok: false,
      reason: `Account home '${shadowHomePath}' must not live inside the shared Codex home.`,
    };
  }

  try {
    mkdirSync(sharedHomePath, { recursive: true });
    mkdirSync(shadowHomePath, { recursive: true });
    for (const directory of CODEX_SHARED_HOME_DIRECTORIES) {
      mkdirSync(path.join(sharedHomePath, directory), { recursive: true });
    }

    const entryNames = new Set<string>(CODEX_SHARED_HOME_DIRECTORIES);
    for (const entryName of readdirSync(sharedHomePath)) {
      if (
        !CODEX_ACCOUNT_PRIVATE_ENTRY_NAMES.has(entryName) &&
        !CODEX_SHADOW_LOCAL_ENTRY_NAMES.has(entryName) &&
        entryName !== CODEX_SHADOW_HOME_MARKER_FILE
      ) {
        entryNames.add(entryName);
      }
    }

    const warnings: string[] = [];
    for (const entryName of entryNames) {
      ensureSharedEntrySymlink({ sharedHomePath, shadowHomePath, entryName, warnings });
    }
    for (const entryName of CODEX_ACCOUNT_PRIVATE_ENTRY_NAMES) {
      removePrivateEntrySymlink(shadowHomePath, entryName);
    }
    writeShadowHomeMarker(sharedHomePath, shadowHomePath);
    return { ok: true, warnings };
  } catch (error) {
    return {
      ok: false,
      reason: `Failed to prepare account home '${shadowHomePath}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * Resolve and materialize the home for an account in one step. This is the
 * entry point probes and the login flow should use so a broken layout is
 * reported instead of quietly running against the wrong login.
 */
export function prepareCodexAccountHome(
  settings: CodexAccountProviderSettings,
  accountId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
):
  | { readonly ok: true; readonly resolution: CodexAccountHomeResolution }
  | { readonly ok: false; readonly reason: string } {
  const resolution = resolveCodexAccountHome(settings, accountId, env);
  if (!resolution) {
    return { ok: false, reason: `Unknown Codex account '${accountId ?? ""}'.` };
  }
  if (resolution.account === undefined) {
    return { ok: true, resolution };
  }
  const materialized = materializeCodexAccountShadowHome({
    sharedHomePath: resolution.sharedHomePath,
    shadowHomePath: resolution.effectiveHomePath,
  });
  if (!materialized.ok) {
    return { ok: false, reason: materialized.reason };
  }
  return { ok: true, resolution };
}

/**
 * Self-healing hook for the spawn path: when a Codex process is about to run
 * against a home that carries a shadow marker, re-sync its symlinks so state
 * directories created in the shared home after account setup (or a moved
 * shared home) are picked up without waiting for the next settings change.
 */
export function rematerializeCodexShadowHomeIfMarked(homePath: string): void {
  try {
    const markerPath = path.join(homePath, CODEX_SHADOW_HOME_MARKER_FILE);
    if (!existsSync(markerPath)) {
      return;
    }
    const parsed: unknown = JSON.parse(readFileSync(markerPath, "utf8"));
    const sharedHomePath =
      typeof parsed === "object" &&
      parsed !== null &&
      "sharedHomePath" in parsed &&
      typeof parsed.sharedHomePath === "string"
        ? parsed.sharedHomePath.trim()
        : "";
    if (!sharedHomePath) {
      return;
    }
    materializeCodexAccountShadowHome({ sharedHomePath, shadowHomePath: homePath });
  } catch {
    // Best-effort: a failed re-sync must never block spawning Codex.
  }
}
