// FILE: antigravityCliProbe.ts
// Purpose: Capability probing for the Antigravity CLI (`agy`). Antigravity has
// no ACP mode, so instead of an ACP handshake the probe runs `agy models`,
// which is cheap, requires authentication, and yields the runtime model list.

import { spawn } from "node:child_process";

import type { ProviderModelDescriptor } from "@t3tools/contracts";
import { prepareWindowsSafeProcess } from "@t3tools/shared/windowsProcess";
import { Effect } from "effect";

import { buildGeminiProbeEnv, type GeminiCapabilityProbeResult } from "./geminiAcpProbe.ts";

// A working `agy models` answers in a few seconds (it reuses the authenticated
// Antigravity sidecar); when FCode's background agy can't reach that session it
// hangs indefinitely. Keep the window generous enough for a genuine cold start
// but short enough that the status check fails fast instead of blocking for
// half a minute.
export const ANTIGRAVITY_PROBE_TIMEOUT_MS = 15_000;

export const ANTIGRAVITY_AUTH_GUIDANCE =
  "Run `agy` in a terminal (or open the Antigravity app) to sign in, then refresh provider status.";

const ANTIGRAVITY_AUTH_FAILURE_PATTERNS = [
  /not (?:logged|signed) in/i,
  /sign in/i,
  /log ?in/i,
  /unauthorized/i,
  /unauthenticated/i,
  /authentication/i,
  /credential/i,
  /auth token/i,
];

export interface AntigravityCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export function isAntigravityAuthFailure(detail: string): boolean {
  return ANTIGRAVITY_AUTH_FAILURE_PATTERNS.some((pattern) => pattern.test(detail));
}

/**
 * `agy models` prints one display name per line (e.g. "Gemini 3.1 Pro (Low)").
 * Those display names double as `--model` values, so they are used verbatim
 * as model slugs.
 */
export function parseAntigravityModels(stdout: string): ReadonlyArray<ProviderModelDescriptor> {
  const models: ProviderModelDescriptor[] = [];
  const seen = new Set<string>();

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (
      line.length === 0 ||
      line.length > 128 ||
      line.startsWith("Error") ||
      line.startsWith("Usage")
    ) {
      continue;
    }
    if (seen.has(line)) {
      continue;
    }
    seen.add(line);
    models.push({ slug: line, name: line });
  }

  return models;
}

export function antigravityCapabilityResultFromModelsCommand(
  result: AntigravityCommandResult,
): GeminiCapabilityProbeResult {
  const detail =
    result.stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .findLast((line) => line.length > 0) ?? result.stdout.trim().split(/\r?\n/).at(-1)?.trim();

  if (result.code !== 0) {
    if (detail && isAntigravityAuthFailure(detail)) {
      return {
        status: "error",
        auth: { status: "unauthenticated" },
        models: [],
        message: `Antigravity is not authenticated. ${detail} ${ANTIGRAVITY_AUTH_GUIDANCE}`,
      };
    }
    return {
      status: "warning",
      auth: { status: "unknown" },
      models: [],
      message: `Antigravity CLI (\`agy\`) is installed, but FCode could not verify authentication or discover models.${detail ? ` ${detail}` : ""}`,
    };
  }

  const models = parseAntigravityModels(result.stdout);
  if (models.length === 0) {
    return {
      status: "ready",
      auth: { status: "authenticated" },
      models: [],
      message:
        "Antigravity CLI (`agy`) is installed and authenticated, but it did not report any available models. FCode will use the Antigravity default model.",
    };
  }

  return {
    status: "ready",
    auth: { status: "authenticated" },
    models,
    message: "Antigravity CLI (`agy`) is installed and authenticated.",
  };
}

/**
 * Plain-spawn runner for Antigravity CLI probe commands, for callers that sit
 * outside the ChildProcessSpawner service (the provider adapter). Never
 * launches OAuth browser flows.
 */
export const runAntigravityCliCommand = (input: {
  readonly binaryPath: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly timeoutMs?: number;
}) =>
  Effect.tryPromise({
    try: () =>
      new Promise<AntigravityCommandResult>((resolve, reject) => {
        const env = buildGeminiProbeEnv();
        const prepared = prepareWindowsSafeProcess(input.binaryPath, [...input.args], {
          ...(input.cwd ? { cwd: input.cwd } : {}),
          env,
        });
        const child = spawn(prepared.command, prepared.args, {
          ...(input.cwd ? { cwd: input.cwd } : {}),
          env,
          shell: prepared.shell,
          windowsHide: prepared.windowsHide,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        let settled = false;

        const timeout = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          child.kill();
          reject(
            new Error(
              `Antigravity CLI command timed out after ${input.timeoutMs ?? ANTIGRAVITY_PROBE_TIMEOUT_MS}ms.`,
            ),
          );
        }, input.timeoutMs ?? ANTIGRAVITY_PROBE_TIMEOUT_MS);
        timeout.unref?.();

        child.stdout?.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });
        child.once("error", (error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          reject(error);
        });
        child.once("close", (code) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          resolve({ stdout, stderr, code: code ?? 1 });
        });
      }),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

export const probeAntigravityCapabilities = (input: {
  readonly binaryPath: string;
  readonly cwd?: string;
}) =>
  runAntigravityCliCommand({
    binaryPath: input.binaryPath,
    args: ["models"],
    ...(input.cwd ? { cwd: input.cwd } : {}),
  }).pipe(Effect.map(antigravityCapabilityResultFromModelsCommand));
