// FILE: codexAccountAuth.ts
// Purpose: In-app login/logout for Codex accounts. Spawns `codex login` /
//          `codex logout` against the account's own CODEX_HOME (the shared home
//          for the primary account, the shadow home for additional accounts) so
//          each account authenticates independently. `codex login` opens the
//          browser OAuth flow itself; completion is observed via process exit,
//          after which the caller re-probes provider statuses.
// Layer: Server runtime utility
// Exports: makeCodexAccountAuthManager

import { spawn, type ChildProcess } from "node:child_process";

import type { CodexServerProviderSettings } from "@t3tools/contracts";
import { prepareWindowsSafeProcess } from "@t3tools/shared/windowsProcess";

import { prepareCodexAccountHome } from "./codexAccounts.ts";
import { buildCodexProcessEnv } from "./codexProcessEnv.ts";

const LOGOUT_TIMEOUT_MS = 15_000;

type CodexAuthSettings = Pick<CodexServerProviderSettings, "accounts" | "binaryPath" | "homePath">;

export type CodexAccountLoginStart =
  | { readonly status: "started" | "alreadyRunning" }
  | { readonly status: "error"; readonly reason: string };

export type CodexAccountLoginCancel = { readonly status: "cancelled" | "notRunning" };

export type CodexAccountLogoutResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export interface CodexAccountAuthManager {
  readonly login: (settings: CodexAuthSettings, accountId?: string) => CodexAccountLoginStart;
  readonly cancelLogin: (accountId?: string) => CodexAccountLoginCancel;
  readonly logout: (
    settings: CodexAuthSettings,
    accountId?: string,
  ) => Promise<CodexAccountLogoutResult>;
}

function accountKey(accountId: string | undefined): string {
  return accountId?.trim() ?? "";
}

function resolveAuthEnv(
  settings: CodexAuthSettings,
  accountId: string | undefined,
): { readonly env: NodeJS.ProcessEnv } | { readonly reason: string } {
  const prepared = prepareCodexAccountHome(settings, accountId);
  if (!prepared.ok) {
    return { reason: prepared.reason };
  }
  // Auth commands must write auth.json into the account home itself — not the
  // derived browser-plugin overlay a session runs against — so the login
  // survives overlay rebuilds and is shared by probes and sessions alike.
  const effectiveHomePath = prepared.resolution.effectiveHomePath;
  return {
    env: {
      ...buildCodexProcessEnv({ homePath: effectiveHomePath }),
      CODEX_HOME: effectiveHomePath,
    },
  };
}

function spawnCodexAuthCommand(input: {
  readonly settings: CodexAuthSettings;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}): ChildProcess {
  const executable = input.settings.binaryPath.trim() || "codex";
  const prepared = prepareWindowsSafeProcess(executable, [...input.args], { env: input.env });
  return spawn(prepared.command, [...prepared.args], {
    env: input.env,
    shell: prepared.shell,
    stdio: "ignore",
  });
}

export function makeCodexAccountAuthManager(options: {
  // Fired whenever an auth command finishes so provider statuses re-probe and
  // connected clients see the new login state.
  readonly onAuthStateChanged: () => void;
}): CodexAccountAuthManager {
  const runningLogins = new Map<string, ChildProcess>();

  const login: CodexAccountAuthManager["login"] = (settings, accountId) => {
    const key = accountKey(accountId);
    if (runningLogins.has(key)) {
      return { status: "alreadyRunning" };
    }
    const resolved = resolveAuthEnv(settings, accountId);
    if ("reason" in resolved) {
      return { status: "error", reason: resolved.reason };
    }

    let child: ChildProcess;
    try {
      child = spawnCodexAuthCommand({ settings, args: ["login"], env: resolved.env });
    } catch (error) {
      return {
        status: "error",
        reason: `Failed to start \`codex login\`: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    runningLogins.set(key, child);
    const finalize = () => {
      if (runningLogins.get(key) === child) {
        runningLogins.delete(key);
      }
      options.onAuthStateChanged();
    };
    child.once("exit", finalize);
    child.once("error", finalize);
    return { status: "started" };
  };

  const cancelLogin: CodexAccountAuthManager["cancelLogin"] = (accountId) => {
    const child = runningLogins.get(accountKey(accountId));
    if (!child) {
      return { status: "notRunning" };
    }
    child.kill("SIGTERM");
    return { status: "cancelled" };
  };

  const logout: CodexAccountAuthManager["logout"] = (settings, accountId) => {
    const resolved = resolveAuthEnv(settings, accountId);
    if ("reason" in resolved) {
      return Promise.resolve({ ok: false, reason: resolved.reason });
    }

    return new Promise<CodexAccountLogoutResult>((resolve) => {
      let child: ChildProcess;
      try {
        child = spawnCodexAuthCommand({ settings, args: ["logout"], env: resolved.env });
      } catch (error) {
        resolve({
          ok: false,
          reason: `Failed to run \`codex logout\`: ${error instanceof Error ? error.message : String(error)}`,
        });
        return;
      }

      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        resolve({ ok: false, reason: "`codex logout` timed out." });
      }, LOGOUT_TIMEOUT_MS);
      timeout.unref?.();

      child.once("error", (error) => {
        clearTimeout(timeout);
        resolve({ ok: false, reason: `Failed to run \`codex logout\`: ${error.message}` });
      });
      child.once("exit", () => {
        clearTimeout(timeout);
        // `codex logout` exits non-zero when already logged out; either way
        // the re-probe reflects the actual auth state, so treat exit as done.
        resolve({ ok: true });
      });
    });
  };

  return { login, cancelLogin, logout };
}
