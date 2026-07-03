// FILE: geminiCli.ts
// Purpose: Resolve which Google agent CLI backs the Gemini provider. Google
// retired the consumer Gemini CLI (`gemini`) in June 2026 and replaced it with
// the Antigravity CLI (`agy`), which drops ACP support in favor of a
// non-interactive print mode. Both the health check and the adapter resolve
// binaries through this module so they always agree on the runtime flavor.

import path from "node:path";

import { resolveExecutableOnPath } from "../executableLookup.ts";

export const GEMINI_CLI_BINARY = "gemini";
export const ANTIGRAVITY_CLI_BINARY = "agy";

/**
 * "acp" drives the legacy `gemini --acp` JSON-RPC session runtime.
 * "antigravity" drives the `agy --print --output-format json` per-turn runtime.
 */
export type GeminiCliFlavor = "acp" | "antigravity";

export interface ResolvedGeminiCli {
  readonly binaryPath: string;
  readonly flavor: GeminiCliFlavor;
}

export function geminiCliFlavorForBinaryPath(binaryPath: string): GeminiCliFlavor {
  const base = path
    .basename(binaryPath.trim())
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1)$/, "");
  return base === ANTIGRAVITY_CLI_BINARY || base.includes("antigravity") ? "antigravity" : "acp";
}

/**
 * Binaries to probe, in order. A custom configured path short-circuits the
 * fallback chain; the default probes `gemini` first (still valid for
 * enterprise installs) and falls back to `agy`.
 */
export function geminiCliCandidates(configuredBinaryPath?: string): ReadonlyArray<string> {
  const configured = configuredBinaryPath?.trim();
  if (configured && configured.length > 0 && configured !== GEMINI_CLI_BINARY) {
    return [configured];
  }
  return [GEMINI_CLI_BINARY, ANTIGRAVITY_CLI_BINARY];
}

/**
 * Resolve the first Gemini provider CLI candidate that exists on PATH (or as
 * a direct path). Returns undefined when neither the Gemini CLI nor the
 * Antigravity CLI is installed.
 */
export function resolveGeminiCli(
  configuredBinaryPath?: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedGeminiCli | undefined {
  for (const candidate of geminiCliCandidates(configuredBinaryPath)) {
    if (resolveExecutableOnPath(candidate, env)) {
      return { binaryPath: candidate, flavor: geminiCliFlavorForBinaryPath(candidate) };
    }
  }
  return undefined;
}

export function geminiCliNotInstalledMessage(configuredBinaryPath?: string): string {
  const configured = configuredBinaryPath?.trim();
  if (configured && configured.length > 0 && configured !== GEMINI_CLI_BINARY) {
    return `The configured Gemini provider binary (\`${configured}\`) is not installed or not on PATH.`;
  }
  return "Neither the Gemini CLI (`gemini`) nor the Antigravity CLI (`agy`) is installed or on PATH. Google replaced the Gemini CLI with the Antigravity CLI in June 2026 — install Antigravity and ensure `agy` is on PATH.";
}
