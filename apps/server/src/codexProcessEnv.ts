// FILE: codexProcessEnv.ts
// Purpose: Builds the exact environment used when FCode launches Codex subprocesses.
// Layer: Server runtime utility
// Exports: Codex process env builder and browser-plugin overlay helpers.
// Depends on: Codex home path helpers, shared Codex config parsing, login-shell env reader.

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

import {
  codexBrowserUsePipeScanRoot,
  readBrowserUsePipePathFromEnv,
} from "@t3tools/shared/browserUsePipe";
import { readActiveCodexProviderEnvKey } from "@t3tools/shared/codexConfig";
import {
  readEnvironmentFromLoginShell,
  resolveLoginShell,
  type ShellEnvironmentReader,
} from "@t3tools/shared/shell";

import {
  CODEX_SHADOW_HOME_MARKER_FILE,
  rematerializeCodexShadowHomeIfMarked,
} from "./codexAccounts.ts";
import {
  resolveBaseCodexHomePath,
  resolveDpCodeCodexHomeOverlayPath,
  shouldDisableDpCodeBrowserPlugin,
} from "./codexHomePaths.ts";

const CODEX_PROCESS_SHELL_ENV_NAMES = ["PATH", "SSH_AUTH_SOCK"] as const;
const NODE_REPL_SANDBOX_ALLOWED_UNIX_SOCKETS = "NODE_REPL_SANDBOX_ALLOWED_UNIX_SOCKETS";
const DPCODE_BROWSER_PLUGIN_CONFIG_HEADER = '[plugins."dpcode-browser@local"]';
// OpenAI's bundled Browser Use plugin drives the in-app browser through a
// privileged `nodeRepl.nativePipe` bridge that only the official Codex desktop
// app injects. FCode spawns `codex app-server` directly, so the bridge is
// absent and the plugin's iab discovery finds zero backends ("Browser is not
// available: iab") — with no net-socket fallback. Left enabled, it advertises a
// broken in-app browser tool that the model tries first and then abandons the
// browser task (falling back to Playwright). Disabling it makes Codex use the
// portable `fcode-browser` skill instead, matching every other provider.
const OPENAI_BUNDLED_BROWSER_PLUGIN_CONFIG_HEADER = '[plugins."browser@openai-bundled"]';
const CODEX_DISABLED_PLUGIN_CONFIG_HEADERS = [
  DPCODE_BROWSER_PLUGIN_CONFIG_HEADER,
  OPENAI_BUNDLED_BROWSER_PLUGIN_CONFIG_HEADER,
] as const;
const CODEX_OVERLAY_SHARED_STATE_FILES = new Set(["auth.json"]);

export function resolveCodexBrowserUsePipePath(
  input: {
    readonly env?: NodeJS.ProcessEnv;
    readonly platform?: NodeJS.Platform;
  } = {},
): string {
  const env = input.env ?? process.env;
  const configured = readBrowserUsePipePathFromEnv(env);
  if (configured) {
    return configured;
  }
  return codexBrowserUsePipeScanRoot(input.platform ?? process.platform);
}

function disablePluginSectionInCodexConfig(config: string, targetHeader: string): string {
  const lines = config.split(/\r?\n/);
  const output: string[] = [];
  let inTargetSection = false;
  let sawTargetSection = false;
  let targetSectionHasEnabled = false;

  const closeTargetSection = () => {
    if (inTargetSection && !targetSectionHasEnabled) {
      output.push("enabled = false");
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      closeTargetSection();
      inTargetSection = trimmed === targetHeader;
      sawTargetSection ||= inTargetSection;
      targetSectionHasEnabled = false;
      output.push(line);
      continue;
    }

    if (inTargetSection && /^\s*enabled\s*=/.test(line)) {
      output.push("enabled = false");
      targetSectionHasEnabled = true;
      continue;
    }

    output.push(line);
  }

  closeTargetSection();

  if (!sawTargetSection) {
    if (output.length > 0 && output.at(-1)?.trim()) {
      output.push("");
    }
    output.push(targetHeader, "enabled = false");
  }

  return output.join("\n");
}

// Disables every FCode-incompatible Codex browser plugin (see the header
// constants for why each one cannot work under FCode's spawned app-server).
export function disableDpCodeBrowserPluginInCodexConfig(config: string): string {
  return CODEX_DISABLED_PLUGIN_CONFIG_HEADERS.reduce(
    (current, header) => disablePluginSectionInCodexConfig(current, header),
    config,
  );
}

function ensureCodexOverlaySymlink(input: {
  readonly entryName: string;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly type: "dir" | "file";
}): void {
  let targetStat: ReturnType<typeof lstatSync> | undefined;
  try {
    targetStat = lstatSync(input.targetPath);
  } catch {
    targetStat = undefined;
  }

  if (targetStat) {
    if (targetStat.isSymbolicLink() && readlinkSync(input.targetPath) === input.sourcePath) {
      return;
    }

    if (
      targetStat.isSymbolicLink() ||
      /^.+\.sqlite(?:-(?:wal|shm|journal))?$/.test(input.entryName) ||
      CODEX_OVERLAY_SHARED_STATE_FILES.has(input.entryName)
    ) {
      // SQLite files must stay generation-matched, and auth must mirror the
      // user's real Codex home so external `codex login` changes are visible.
      rmSync(input.targetPath, { recursive: true, force: true });
    } else {
      return;
    }
  }

  symlinkSync(input.sourcePath, input.targetPath, input.type);
}

function prepareDpCodeCodexHomeOverlay(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly homePath?: string;
}): string | undefined {
  const sourceHomePath = resolveBaseCodexHomePath(input.env, input.homePath);
  const overlayHomePath = resolveDpCodeCodexHomeOverlayPath(input.env, sourceHomePath);
  if (path.resolve(sourceHomePath) === path.resolve(overlayHomePath)) {
    return undefined;
  }

  mkdirSync(overlayHomePath, { recursive: true });

  try {
    for (const entry of readdirSync(sourceHomePath)) {
      // The shadow-home marker stays out of the overlay so the overlay can
      // never be mistaken for (and re-materialized as) an account home.
      if (entry === "config.toml" || entry === CODEX_SHADOW_HOME_MARKER_FILE) {
        continue;
      }
      const sourcePath = path.join(sourceHomePath, entry);
      const targetPath = path.join(overlayHomePath, entry);
      const stat = lstatSync(sourcePath);
      ensureCodexOverlaySymlink({
        entryName: entry,
        sourcePath,
        targetPath,
        type: stat.isDirectory() ? "dir" : "file",
      });
    }
  } catch {
    // If the source home is partially missing, Codex can still start with the
    // overlay config and create any required state lazily.
  }

  const sourceConfigPath = path.join(sourceHomePath, "config.toml");
  const sourceConfig = existsSync(sourceConfigPath) ? readFileSync(sourceConfigPath, "utf8") : "";
  writeFileSync(
    path.join(overlayHomePath, "config.toml"),
    disableDpCodeBrowserPluginInCodexConfig(sourceConfig),
    "utf8",
  );

  return overlayHomePath;
}

export function buildCodexProcessEnv(
  input: {
    readonly env?: NodeJS.ProcessEnv;
    readonly homePath?: string;
    readonly platform?: NodeJS.Platform;
    readonly readEnvironment?: ShellEnvironmentReader;
  } = {},
): NodeJS.ProcessEnv {
  const baseEnv = { ...(input.env ?? process.env) };
  // Account shadow homes re-sync their shared-state symlinks before every
  // spawn so directories Codex created in the shared home after account
  // setup are visible to this account too.
  rematerializeCodexShadowHomeIfMarked(resolveBaseCodexHomePath(baseEnv, input.homePath));
  const overlayHomePath = shouldDisableDpCodeBrowserPlugin(baseEnv)
    ? prepareDpCodeCodexHomeOverlay({
        env: baseEnv,
        ...(input.homePath ? { homePath: input.homePath } : {}),
      })
    : undefined;
  const effectiveEnv =
    overlayHomePath || input.homePath
      ? { ...baseEnv, CODEX_HOME: overlayHomePath ?? input.homePath }
      : baseEnv;
  const platform = input.platform ?? process.platform;

  if (platform === "darwin" || platform === "linux") {
    try {
      const shell = resolveLoginShell(platform, effectiveEnv.SHELL);
      const providerEnvKey = readActiveCodexProviderEnvKey(effectiveEnv);
      if (shell && providerEnvKey && !effectiveEnv[providerEnvKey]?.trim()) {
        const shellEnvironment = (input.readEnvironment ?? readEnvironmentFromLoginShell)(shell, [
          ...CODEX_PROCESS_SHELL_ENV_NAMES,
          providerEnvKey,
        ]);

        if (shellEnvironment.PATH) {
          effectiveEnv.PATH = shellEnvironment.PATH;
        }
        if (!effectiveEnv.SSH_AUTH_SOCK && shellEnvironment.SSH_AUTH_SOCK) {
          effectiveEnv.SSH_AUTH_SOCK = shellEnvironment.SSH_AUTH_SOCK;
        }
        if (shellEnvironment[providerEnvKey]) {
          effectiveEnv[providerEnvKey] = shellEnvironment[providerEnvKey];
        }
      }
    } catch {
      // Keep inherited environment if shell lookup fails.
    }
  }

  if (platform !== "win32") {
    const allowedSockets =
      effectiveEnv[NODE_REPL_SANDBOX_ALLOWED_UNIX_SOCKETS]
        ?.split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0) ?? [];
    // Allow both the FCode-configured pipe and Codex's fixed scan root — the
    // official control-in-app-browser plugin always dials sockets under the
    // latter (the sandbox allowance is subpath-rooted).
    const requiredSockets = [
      resolveCodexBrowserUsePipePath({ env: effectiveEnv, platform }),
      codexBrowserUsePipeScanRoot(platform),
    ];
    const missingSockets = requiredSockets.filter((entry) => !allowedSockets.includes(entry));
    if (missingSockets.length > 0) {
      effectiveEnv[NODE_REPL_SANDBOX_ALLOWED_UNIX_SOCKETS] = [
        ...allowedSockets,
        ...new Set(missingSockets),
      ].join(",");
    }
  }

  return effectiveEnv;
}
