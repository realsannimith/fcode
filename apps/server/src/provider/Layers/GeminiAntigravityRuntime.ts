/**
 * GeminiAntigravityRuntime - Antigravity CLI (`agy`) session runtime for the
 * Gemini provider.
 *
 * Google replaced the Gemini CLI with the Antigravity CLI in June 2026. `agy`
 * has no ACP mode, so this runtime drives sessions turn-by-turn: each user
 * turn spawns `agy --print <prompt> --output-format json` in the thread's
 * working directory, threads conversation state through `--conversation
 * <id>`, and projects the single JSON result envelope into canonical provider
 * runtime events.
 *
 * @module GeminiAntigravityRuntime
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import * as pty from "node-pty";
import xtermHeadless from "@xterm/headless";
import type { Terminal as HeadlessTerminalType } from "@xterm/headless";

import {
  type CanonicalItemType,
  EventId,
  type ProviderListModelsResult,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
  type ProviderTurnStartResult,
  RuntimeItemId,
  ThreadId,
  type ThreadTokenUsageSnapshot,
  TurnId,
} from "@t3tools/contracts";
import { prepareWindowsSafeProcess } from "@t3tools/shared/windowsProcess";
import { Effect } from "effect";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { appendFileAttachmentsPromptBlock } from "../attachmentProjection.ts";
import { isAntigravityAuthFailure, probeAntigravityCapabilities } from "../antigravityCliProbe.ts";
import { buildProviderBrowserAndSkillPrompt } from "../browserUsePrompt.ts";
import { asNumber, asRecord, asString, trimToUndefined } from "../geminiValue.ts";
import { killChildProcess } from "../processControl.ts";
import { extractProposedPlanMarkdown, withProviderPlanModePrompt } from "../planMode.ts";

const PROVIDER = "gemini" as const;
const ANTIGRAVITY_RESUME_FLAVOR = "antigravity" as const;
// Matches the 30 minute ACP prompt timeout; agy enforces it internally.
const ANTIGRAVITY_PRINT_TIMEOUT = "30m";
const MAX_CAPTURED_STDERR_LINES = 5;
const ANTIGRAVITY_STREAM_CHUNK_CHARS = 96;
const ANTIGRAVITY_STREAM_CHUNK_DELAY_MS = 12;
const ANTIGRAVITY_TUI_COLS = 120;
const ANTIGRAVITY_TUI_ROWS = 40;
const { Terminal: HeadlessTerminal } = xtermHeadless as typeof import("@xterm/headless");

interface AntigravityRecordedItem {
  readonly id: string;
  readonly itemType: CanonicalItemType;
  readonly title?: string;
  readonly status?: "inProgress" | "completed" | "failed";
  readonly text?: string;
}

interface AntigravityStoredTurn {
  readonly id: TurnId;
  readonly items: Array<unknown>;
}

interface AntigravityTurnState {
  readonly turnId: TurnId;
  readonly interactionMode: "default" | "plan";
  readonly assistantItemId: RuntimeItemId;
}

interface AntigravitySessionContext {
  session: ProviderSession;
  readonly binaryPath: string;
  readonly turns: AntigravityStoredTurn[];
  conversationId: string | undefined;
  threadStartedEmitted: boolean;
  turnState: AntigravityTurnState | undefined;
  activeChild: ChildProcessWithoutNullStreams | undefined;
  activePty: pty.IPty | undefined;
  interruptRequested: boolean;
  stopped: boolean;
  lastKnownTokenUsage: ThreadTokenUsageSnapshot | undefined;
}

export interface GeminiAntigravityRuntimeDeps {
  readonly attachmentsDir: string;
  readonly fcodeBaseDir: string;
  readonly emitEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly writeNativeRecord: (threadId: ThreadId | null, record: unknown) => Effect.Effect<void>;
}

export interface AntigravityResumeCursor {
  readonly flavor: typeof ANTIGRAVITY_RESUME_FLAVOR;
  readonly conversationId?: string;
  readonly turns?: ReadonlyArray<AntigravityStoredTurn>;
}

export function readAntigravityResumeCursor(
  resumeCursor: unknown,
): AntigravityResumeCursor | undefined {
  const record = asRecord(resumeCursor);
  if (asString(record?.flavor) !== ANTIGRAVITY_RESUME_FLAVOR) {
    return undefined;
  }

  const conversationId = trimToUndefined(record?.conversationId);
  const turns = Array.isArray(record?.turns)
    ? record.turns.reduce<Array<AntigravityStoredTurn>>((acc, entry) => {
        const turn = asRecord(entry);
        const turnId = trimToUndefined(turn?.id);
        if (turnId && Array.isArray(turn?.items)) {
          acc.push({ id: TurnId.makeUnsafe(turnId), items: [...turn.items] });
        }
        return acc;
      }, [])
    : [];

  return {
    flavor: ANTIGRAVITY_RESUME_FLAVOR,
    ...(conversationId ? { conversationId } : {}),
    ...(turns.length > 0 ? { turns } : {}),
  };
}

function buildAntigravityResumeCursor(context: AntigravitySessionContext): AntigravityResumeCursor {
  return {
    flavor: ANTIGRAVITY_RESUME_FLAVOR,
    ...(context.conversationId ? { conversationId: context.conversationId } : {}),
    ...(context.turns.length > 0
      ? { turns: context.turns.map((turn) => ({ id: turn.id, items: [...turn.items] })) }
      : {}),
  };
}

export function normalizeAntigravityUsage(value: unknown): ThreadTokenUsageSnapshot | undefined {
  const usage = asRecord(value);
  const usedTokens = asNumber(usage?.total_tokens);
  if (usedTokens === undefined || usedTokens <= 0) {
    return undefined;
  }

  const inputTokens = asNumber(usage?.input_tokens);
  const outputTokens = asNumber(usage?.output_tokens);
  const thinkingTokens = asNumber(usage?.thinking_tokens);

  return {
    usedTokens,
    totalProcessedTokens: usedTokens,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(thinkingTokens !== undefined ? { reasoningOutputTokens: thinkingTokens } : {}),
    lastUsedTokens: usedTokens,
    ...(inputTokens !== undefined ? { lastInputTokens: inputTokens } : {}),
    ...(outputTokens !== undefined ? { lastOutputTokens: outputTokens } : {}),
    ...(thinkingTokens !== undefined ? { lastReasoningOutputTokens: thinkingTokens } : {}),
  };
}

export interface AntigravityPrintEnvelope {
  readonly conversationId?: string;
  readonly status?: string;
  readonly response: string;
  readonly usage?: ThreadTokenUsageSnapshot;
  readonly raw?: unknown;
}

/**
 * `agy --print --output-format json` emits a single JSON envelope on stdout.
 * Older/newer builds may fall back to plain text, so unparseable output is
 * treated as a successful plain-text response.
 */
export function parseAntigravityPrintOutput(stdout: string): AntigravityPrintEnvelope {
  const trimmed = stdout.trim();
  const candidates = [trimmed, trimmed.split(/\r?\n/).at(-1)?.trim() ?? ""];

  for (const candidate of candidates) {
    if (!candidate.startsWith("{")) {
      continue;
    }
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = asRecord(JSON.parse(candidate));
    } catch {
      continue;
    }
    if (!parsed || (!("response" in parsed) && !("status" in parsed))) {
      continue;
    }
    const conversationId = trimToUndefined(parsed.conversation_id);
    const status = trimToUndefined(parsed.status);
    const usage = normalizeAntigravityUsage(parsed.usage);
    return {
      response: asString(parsed.response) ?? "",
      ...(conversationId ? { conversationId } : {}),
      ...(status ? { status } : {}),
      ...(usage ? { usage } : {}),
      raw: parsed,
    };
  }

  return { response: stdout };
}

export function buildAntigravityTurnArgs(input: {
  readonly prompt: string;
  readonly conversationId?: string;
  readonly workspaceDirs?: ReadonlyArray<string>;
  readonly model?: string;
  readonly fullAccess: boolean;
}): Array<string> {
  const workspaceArgs = (input.workspaceDirs ?? []).flatMap((dir) => ["--add-dir", dir]);
  return [
    "--print",
    input.prompt,
    "--output-format",
    "json",
    "--print-timeout",
    ANTIGRAVITY_PRINT_TIMEOUT,
    ...workspaceArgs,
    ...(input.conversationId ? [] : ["--new-project"]),
    ...(input.conversationId ? ["--conversation", input.conversationId] : []),
    ...(input.model ? ["--model", input.model] : []),
    ...(input.fullAccess ? ["--dangerously-skip-permissions"] : []),
  ];
}

export function buildAntigravityInteractiveTurnArgs(input: {
  readonly prompt: string;
  readonly conversationId?: string;
  readonly workspaceDirs?: ReadonlyArray<string>;
  readonly model?: string;
  readonly fullAccess: boolean;
}): Array<string> {
  const workspaceArgs = (input.workspaceDirs ?? []).flatMap((dir) => ["--add-dir", dir]);
  return [
    "--prompt-interactive",
    input.prompt,
    ...workspaceArgs,
    ...(input.conversationId ? [] : ["--new-project"]),
    ...(input.conversationId ? ["--conversation", input.conversationId] : []),
    ...(input.model ? ["--model", input.model] : []),
    ...(input.fullAccess ? ["--dangerously-skip-permissions"] : []),
  ];
}

function isAntigravityChromeLine(line: string, promptText: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return true;
  if (trimmed === `> ${promptText}` || trimmed === ">") return true;
  if (/^[─━]+$/.test(trimmed)) return true;
  if (/^[▄▀\s]+$/.test(trimmed)) return true;
  return (
    trimmed === "Generating..." ||
    trimmed.startsWith("Welcome to the Antigravity CLI") ||
    trimmed.startsWith("Accessing workspace:") ||
    trimmed.startsWith("Do you trust the contents of this project?") ||
    trimmed.startsWith("Antigravity CLI requires permission") ||
    trimmed.startsWith("Yes, I trust this folder") ||
    trimmed.startsWith("> Yes, I trust this folder") ||
    trimmed.startsWith("No, exit") ||
    trimmed.includes("Navigate · enter Confirm") ||
    trimmed.includes("for shortcuts") ||
    trimmed.includes("esc to cancel") ||
    trimmed.startsWith("Antigravity CLI ") ||
    trimmed.startsWith("Resume: agy --conversation=") ||
    trimmed.startsWith("└ Tip:") ||
    trimmed.includes("Gemini 3.5") ||
    trimmed.includes("Gemini 3.1") ||
    trimmed.includes("Google AI")
  );
}

export function extractAntigravityAssistantTextFromScreen(
  screenText: string,
  promptText: string,
): string {
  const lines = screenText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !isAntigravityChromeLine(line, promptText));

  const promptIndex = lines.findIndex((line) => line.trim() === `> ${promptText}`);
  const candidateLines = promptIndex >= 0 ? lines.slice(promptIndex + 1) : lines;
  return candidateLines.join("\n").trim();
}

export function chunkAntigravityResponseDeltas(
  responseText: string,
  maxChunkChars = ANTIGRAVITY_STREAM_CHUNK_CHARS,
): ReadonlyArray<string> {
  if (responseText.length === 0) {
    return [];
  }
  const limit = Math.max(1, maxChunkChars);
  const chunks: string[] = [];
  let offset = 0;

  while (offset < responseText.length) {
    const hardEnd = Math.min(responseText.length, offset + limit);
    let end = hardEnd;
    if (hardEnd < responseText.length) {
      const candidate = responseText.slice(offset, hardEnd);
      const whitespaceIndex = Math.max(
        candidate.lastIndexOf(" "),
        candidate.lastIndexOf("\n"),
        candidate.lastIndexOf("\t"),
      );
      if (whitespaceIndex > 0) {
        end = offset + whitespaceIndex + 1;
      }
    }
    chunks.push(responseText.slice(offset, end));
    offset = end;
  }

  return chunks;
}

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }
  return fallback;
}

function stderrTail(stderr: string): string | undefined {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.slice(-MAX_CAPTURED_STDERR_LINES).join(" ") || undefined;
}

interface AntigravityTurnProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly spawnError?: Error;
}

interface AntigravityInteractiveTurnResult {
  readonly responseText: string;
  readonly conversationId?: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly signal: number | null;
  readonly spawnError?: Error;
}

function updateSession(
  context: AntigravitySessionContext,
  patch: Partial<ProviderSession>,
): ProviderSession {
  context.session = {
    ...context.session,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  return context.session;
}

export const makeGeminiAntigravityRuntime = (deps: GeminiAntigravityRuntimeDeps) => {
  const sessions = new Map<ThreadId, AntigravitySessionContext>();

  const makeEventBase = (context: AntigravitySessionContext) => ({
    eventId: EventId.makeUnsafe(crypto.randomUUID()),
    provider: PROVIDER,
    threadId: context.session.threadId,
    createdAt: new Date().toISOString(),
  });

  const requireSession = Effect.fn("requireAntigravitySession")(function* (threadId: ThreadId) {
    const context = sessions.get(threadId);
    if (!context) {
      return yield* new ProviderAdapterSessionNotFoundError({
        provider: PROVIDER,
        threadId,
      });
    }
    if (context.stopped) {
      return yield* new ProviderAdapterSessionClosedError({
        provider: PROVIDER,
        threadId,
      });
    }
    return context;
  });

  const emitSessionState = Effect.fn("emitAntigravitySessionState")(function* (
    context: AntigravitySessionContext,
    state: "starting" | "ready" | "running" | "stopped" | "error",
    reason?: string,
  ) {
    yield* deps.emitEvent({
      ...makeEventBase(context),
      type: "session.state.changed",
      payload: {
        state,
        ...(reason ? { reason } : {}),
      },
    });
  });

  const emitRuntimeWarning = Effect.fn("emitAntigravityRuntimeWarning")(function* (
    context: AntigravitySessionContext,
    message: string,
  ) {
    yield* deps.emitEvent({
      ...makeEventBase(context),
      type: "runtime.warning",
      payload: { message },
    });
  });

  const emitRuntimeError = Effect.fn("emitAntigravityRuntimeError")(function* (
    context: AntigravitySessionContext,
    message: string,
    detail?: unknown,
    turnId?: TurnId,
  ) {
    yield* deps.emitEvent({
      ...makeEventBase(context),
      ...(turnId ? { turnId } : {}),
      type: "runtime.error",
      payload: {
        message,
        class: "provider_error",
        ...(detail !== undefined ? { detail } : {}),
      },
      ...(detail !== undefined
        ? {
            raw: {
              source: "gemini.agy.result",
              method: "runtime.error",
              payload: detail,
            },
          }
        : {}),
    });
  });

  const emitThreadStartedOnce = Effect.fn("emitAntigravityThreadStarted")(function* (
    context: AntigravitySessionContext,
  ) {
    if (context.threadStartedEmitted || !context.conversationId) {
      return;
    }
    context.threadStartedEmitted = true;
    yield* deps.emitEvent({
      ...makeEventBase(context),
      type: "thread.started",
      payload: {
        providerThreadId: context.conversationId,
      },
    });
  });

  const emitUsage = Effect.fn("emitAntigravityUsage")(function* (
    context: AntigravitySessionContext,
    usage: ThreadTokenUsageSnapshot,
    turnId: TurnId,
    rawPayload: unknown,
  ) {
    context.lastKnownTokenUsage = {
      ...context.lastKnownTokenUsage,
      ...usage,
      usedTokens: usage.usedTokens,
    };
    yield* deps.emitEvent({
      ...makeEventBase(context),
      turnId,
      type: "thread.token-usage.updated",
      payload: { usage: context.lastKnownTokenUsage },
      raw: {
        source: "gemini.agy.result",
        method: "print.usage",
        payload: rawPayload,
      },
    });
  });

  const finishTurn = Effect.fn("finishAntigravityTurn")(function* (
    context: AntigravitySessionContext,
    result: {
      readonly state: "completed" | "failed" | "cancelled";
      readonly responseText?: string;
      readonly errorMessage?: string;
    },
  ) {
    const turnState = context.turnState;
    if (!turnState) {
      return;
    }

    const items: Array<AntigravityRecordedItem> = [];
    const responseText = result.responseText ?? "";
    if (responseText.length > 0) {
      const proposedPlanMarkdown =
        result.state === "completed" && turnState.interactionMode === "plan"
          ? extractProposedPlanMarkdown(responseText)
          : undefined;
      if (proposedPlanMarkdown) {
        yield* deps.emitEvent({
          ...makeEventBase(context),
          turnId: turnState.turnId,
          itemId: turnState.assistantItemId,
          type: "turn.proposed.completed",
          payload: {
            planMarkdown: proposedPlanMarkdown,
          },
          raw: {
            source: "gemini.agy.result",
            method: "assistant/proposed-plan-block",
            payload: { text: responseText },
          },
        });
      }

      yield* deps.emitEvent({
        ...makeEventBase(context),
        turnId: turnState.turnId,
        itemId: turnState.assistantItemId,
        type: "item.completed",
        payload: {
          itemType: "assistant_message",
          status: result.state === "failed" ? "failed" : "completed",
          title: "Assistant message",
        },
      });
      items.push({
        id: turnState.assistantItemId,
        itemType: "assistant_message",
        title: "Assistant message",
        status: result.state === "failed" ? "failed" : "completed",
        text: responseText,
      });
    }

    yield* deps.emitEvent({
      ...makeEventBase(context),
      turnId: turnState.turnId,
      type: "turn.completed",
      payload: {
        state: result.state,
        ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
      },
    });

    context.turns.push({ id: turnState.turnId, items: [...items] });
    context.turnState = undefined;
    updateSession(context, {
      status: "ready",
      activeTurnId: undefined,
      resumeCursor: buildAntigravityResumeCursor(context),
      ...(result.state === "failed" && result.errorMessage
        ? { lastError: result.errorMessage }
        : {}),
    });
    yield* emitSessionState(context, "ready");
  });

  const emitAssistantMessage = Effect.fn("emitAntigravityAssistantMessage")(function* (
    context: AntigravitySessionContext,
    turnState: AntigravityTurnState,
    responseText: string,
    rawPayload: unknown,
  ) {
    if (responseText.length === 0) {
      return;
    }
    yield* deps.emitEvent({
      ...makeEventBase(context),
      turnId: turnState.turnId,
      itemId: turnState.assistantItemId,
      type: "item.started",
      payload: {
        itemType: "assistant_message",
        status: "inProgress",
        title: "Assistant message",
      },
    });
    const deltas = chunkAntigravityResponseDeltas(responseText);
    for (let index = 0; index < deltas.length; index += 1) {
      yield* deps.emitEvent({
        ...makeEventBase(context),
        turnId: turnState.turnId,
        itemId: turnState.assistantItemId,
        type: "content.delta",
        payload: {
          streamKind: "assistant_text",
          delta: deltas[index] ?? "",
        },
        raw: {
          source: "gemini.agy.result",
          method: "print.response",
          payload: rawPayload,
        },
      });
      if (index < deltas.length - 1) {
        yield* Effect.sleep(ANTIGRAVITY_STREAM_CHUNK_DELAY_MS);
      }
    }
  });

  const spawnTurnProcess = Effect.fn("spawnAntigravityTurnProcess")(function* (
    context: AntigravitySessionContext,
    args: ReadonlyArray<string>,
  ) {
    const cwd = context.session.cwd ?? process.cwd();
    return yield* Effect.try({
      try: () => {
        const prepared = prepareWindowsSafeProcess(context.binaryPath, [...args], {
          cwd,
          env: process.env,
        });
        const child = spawn(prepared.command, prepared.args, {
          cwd,
          env: process.env,
          stdio: ["pipe", "pipe", "pipe"],
          shell: prepared.shell,
          windowsHide: prepared.windowsHide,
        });
        child.stdin.end();
        return child;
      },
      catch: (cause) =>
        new ProviderAdapterProcessError({
          provider: PROVIDER,
          threadId: context.session.threadId,
          detail: `Failed to spawn Antigravity CLI: ${toMessage(cause, "spawn failed")}`,
          cause,
        }),
    });
  });

  const awaitTurnProcess = (
    child: ChildProcessWithoutNullStreams,
  ): Effect.Effect<AntigravityTurnProcessResult> =>
    Effect.callback<AntigravityTurnProcessResult>((resume) => {
      let stdout = "";
      let stderr = "";
      let settled = false;

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.once("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        resume(Effect.succeed({ stdout, stderr, code: null, signal: null, spawnError: error }));
      });
      child.once("close", (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        resume(Effect.succeed({ stdout, stderr, code, signal }));
      });
    });

  const runInteractiveTurnProcess = (
    context: AntigravitySessionContext,
    args: ReadonlyArray<string>,
    promptText: string,
    turnState: AntigravityTurnState,
  ): Effect.Effect<AntigravityInteractiveTurnResult> =>
    Effect.callback<AntigravityInteractiveTurnResult>((resume) => {
      let term: HeadlessTerminalType;
      let proc: pty.IPty;
      try {
        term = new HeadlessTerminal({
          cols: ANTIGRAVITY_TUI_COLS,
          rows: ANTIGRAVITY_TUI_ROWS,
          allowProposedApi: true,
        });
        proc = pty.spawn(context.binaryPath, [...args], {
          cwd: context.session.cwd ?? process.cwd(),
          env: process.env,
          cols: ANTIGRAVITY_TUI_COLS,
          rows: ANTIGRAVITY_TUI_ROWS,
          name: "xterm-256color",
        });
      } catch (cause) {
        resume(
          Effect.succeed({
            responseText: "",
            stdout: "",
            stderr: "",
            code: null,
            signal: null,
            spawnError: cause instanceof Error ? cause : new Error(String(cause)),
          }),
        );
        return;
      }

      context.activePty = proc;
      let stdout = "";
      let settled = false;
      let trustConfirmed = false;
      let itemStarted = false;
      let emittedText = "";
      let conversationId: string | undefined;
      let eventChain: Promise<void> = Promise.resolve();

      const enqueue = (effect: Effect.Effect<void>) => {
        eventChain = eventChain.then(() => Effect.runPromise(effect)).catch(() => undefined);
      };

      const screenText = () => {
        const lines: string[] = [];
        const buffer = term.buffer.active;
        for (let index = 0; index < buffer.length; index += 1) {
          lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
        }
        return lines.join("\n");
      };

      const emitDelta = (delta: string, rawPayload: unknown) => {
        if (delta.length === 0) return;
        if (!itemStarted) {
          itemStarted = true;
          enqueue(
            deps.emitEvent({
              ...makeEventBase(context),
              turnId: turnState.turnId,
              itemId: turnState.assistantItemId,
              type: "item.started",
              payload: {
                itemType: "assistant_message",
                status: "inProgress",
                title: "Assistant message",
              },
            }),
          );
        }
        enqueue(
          deps.emitEvent({
            ...makeEventBase(context),
            turnId: turnState.turnId,
            itemId: turnState.assistantItemId,
            type: "content.delta",
            payload: {
              streamKind: "assistant_text",
              delta,
            },
            raw: {
              source: "gemini.agy.result",
              method: "interactive.tui",
              payload: rawPayload,
            },
          }),
        );
      };

      const onData = proc.onData((data) => {
        stdout += data;
        const resumeMatch = stdout.match(/Resume:\s+agy --conversation=([0-9a-f-]+)/i);
        if (resumeMatch?.[1]) {
          conversationId = resumeMatch[1];
        }
        if (!trustConfirmed && data.includes("Do you trust the contents of this project?")) {
          trustConfirmed = true;
          setTimeout(() => proc.write("\r"), 100);
        }
        term.write(data, () => {
          const nextText = extractAntigravityAssistantTextFromScreen(screenText(), promptText);
          if (nextText.length > emittedText.length && nextText.startsWith(emittedText)) {
            const delta = nextText.slice(emittedText.length);
            emittedText = nextText;
            emitDelta(delta, { screen: nextText });
          }
        });
      });

      const onExit = proc.onExit(({ exitCode, signal }) => {
        if (settled) return;
        settled = true;
        context.activePty = undefined;
        onData.dispose();
        onExit.dispose();
        void eventChain.finally(() => {
          resume(
            Effect.succeed({
              responseText: emittedText,
              ...(conversationId ? { conversationId } : {}),
              stdout,
              stderr: "",
              code: exitCode,
              signal: signal ?? null,
            }),
          );
        });
      });
    });

  const runTurn = Effect.fn("runAntigravityTurn")(function* (
    context: AntigravitySessionContext,
    turnState: AntigravityTurnState,
    args: ReadonlyArray<string>,
  ) {
    const processResult = yield* runInteractiveTurnProcess(context, args, args[1] ?? "", turnState);
    const interrupted = context.interruptRequested;
    context.interruptRequested = false;

    yield* deps.writeNativeRecord(context.session.threadId, {
      source: "gemini.agy.result",
      runtime: "interactive-pty",
      exitCode: processResult.code,
      signal: processResult.signal,
      stdout: processResult.stdout,
      stderr: processResult.stderr,
    });

    if (context.stopped) {
      yield* finishTurn(context, { state: "cancelled" });
      return;
    }

    if (interrupted) {
      yield* finishTurn(context, { state: "cancelled" });
      return;
    }

    if (processResult.spawnError) {
      const message = `Antigravity CLI process error: ${processResult.spawnError.message}`;
      yield* emitRuntimeError(context, message, { detail: message }, turnState.turnId);
      yield* finishTurn(context, { state: "failed", errorMessage: message });
      return;
    }

    if (processResult.code !== 0) {
      const detail = stderrTail(processResult.stderr) ?? stderrTail(processResult.stdout);
      const message =
        detail && isAntigravityAuthFailure(detail)
          ? `Antigravity is not authenticated. ${detail} Run \`agy\` in a terminal (or open the Antigravity app) to sign in.`
          : `Antigravity CLI turn failed (exit code ${processResult.code ?? "null"}${processResult.signal ? `, signal ${processResult.signal}` : ""}).${detail ? ` ${detail}` : ""}`;
      yield* emitRuntimeError(context, message, { detail: message }, turnState.turnId);
      yield* finishTurn(context, { state: "failed", errorMessage: message });
      return;
    }

    if (processResult.conversationId) {
      context.conversationId = processResult.conversationId;
      yield* emitThreadStartedOnce(context);
    }

    yield* finishTurn(context, { state: "completed", responseText: processResult.responseText });
  });

  const startSession = Effect.fn("startAntigravitySession")(function* (
    input: ProviderSessionStartInput,
    binaryPath: string,
  ) {
    const existing = sessions.get(input.threadId);
    if (existing) {
      existing.stopped = true;
      if (existing.activeChild) {
        killChildProcess(existing.activeChild);
      }
      if (existing.activePty) {
        existing.activePty.kill();
        existing.activePty = undefined;
      }
      sessions.delete(input.threadId);
    }

    const cwd = input.cwd ?? process.cwd();
    const resumeCursor = readAntigravityResumeCursor(input.resumeCursor);
    const now = new Date().toISOString();
    const selectedModel =
      input.modelSelection?.provider === PROVIDER ? input.modelSelection.model : undefined;
    const context: AntigravitySessionContext = {
      session: {
        provider: PROVIDER,
        status: "ready",
        runtimeMode: input.runtimeMode,
        cwd,
        threadId: input.threadId,
        createdAt: now,
        updatedAt: now,
        ...(selectedModel ? { model: selectedModel } : {}),
      },
      binaryPath,
      turns: resumeCursor?.turns ? resumeCursor.turns.map((turn) => ({ ...turn })) : [],
      conversationId: resumeCursor?.conversationId,
      threadStartedEmitted: false,
      turnState: undefined,
      activeChild: undefined,
      activePty: undefined,
      interruptRequested: false,
      stopped: false,
      lastKnownTokenUsage: undefined,
    };
    updateSession(context, { resumeCursor: buildAntigravityResumeCursor(context) });
    sessions.set(input.threadId, context);

    yield* deps.emitEvent({
      ...makeEventBase(context),
      type: "session.started",
      payload: input.resumeCursor !== undefined ? { resume: input.resumeCursor } : {},
    });
    yield* deps.emitEvent({
      ...makeEventBase(context),
      type: "session.configured",
      payload: {
        config: {
          cwd,
          runtime: "antigravity",
          ...(context.session.model ? { model: context.session.model } : {}),
        },
      },
    });
    yield* emitSessionState(context, "ready");
    yield* emitThreadStartedOnce(context);

    return context.session;
  });

  const sendTurn = Effect.fn("sendAntigravityTurn")(function* (input: ProviderSendTurnInput) {
    const context = yield* requireSession(input.threadId);
    if (context.turnState) {
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "sendTurn",
        issue: "A Gemini turn is already in progress for this thread.",
      });
    }

    const imageAttachments = (input.attachments ?? []).filter(
      (attachment) => attachment.type === "image",
    );
    if (imageAttachments.length > 0) {
      yield* emitRuntimeWarning(
        context,
        "Image attachments are not supported by the Antigravity CLI (`agy`) print mode and were omitted from this turn.",
      );
    }

    const planPromptText = trimToUndefined(
      withProviderPlanModePrompt({
        text: input.input?.trim() ?? "",
        interactionMode: input.interactionMode,
      }),
    );
    const browserAndSkillPrompt = yield* Effect.tryPromise({
      try: () =>
        buildProviderBrowserAndSkillPrompt({
          provider: PROVIDER,
          fcodeBaseDir: deps.fcodeBaseDir,
          skills: input.skills,
          maxChars: 24_000,
        }),
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "turn/start",
          detail: "Failed to prepare provider skill instructions.",
          cause,
        }),
    });
    const workspacePrompt =
      context.session.cwd && context.session.cwd.trim().length > 0
        ? `FCode current project workspace: ${context.session.cwd}\nUse this directory as "my project" and the primary workspace. Do not treat Antigravity scratch directories as the user's project unless the user explicitly asks for them.`
        : undefined;
    const promptText = appendFileAttachmentsPromptBlock({
      text: [browserAndSkillPrompt, workspacePrompt, planPromptText]
        .filter((text): text is string => Boolean(text?.trim()))
        .join("\n\nUser request:\n"),
      attachments: input.attachments,
      attachmentsDir: deps.attachmentsDir,
      include: "all-files",
    });
    if (!promptText) {
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "sendTurn",
        issue: "Either input text or at least one file attachment is required.",
      });
    }

    const selectedModel =
      input.modelSelection?.provider === PROVIDER ? input.modelSelection.model : undefined;
    const turnId = TurnId.makeUnsafe(crypto.randomUUID());
    const turnState: AntigravityTurnState = {
      turnId,
      interactionMode: input.interactionMode === "plan" ? "plan" : "default",
      assistantItemId: RuntimeItemId.makeUnsafe(`gemini-assistant-${crypto.randomUUID()}`),
    };
    context.turnState = turnState;
    updateSession(context, {
      status: "running",
      activeTurnId: turnId,
      ...(selectedModel ? { model: selectedModel } : {}),
    });

    yield* emitSessionState(context, "running");
    yield* deps.emitEvent({
      ...makeEventBase(context),
      turnId,
      type: "turn.started",
      payload: context.session.model ? { model: context.session.model } : {},
    });

    const args = buildAntigravityInteractiveTurnArgs({
      prompt: promptText,
      ...(context.conversationId ? { conversationId: context.conversationId } : {}),
      ...(context.session.cwd ? { workspaceDirs: [context.session.cwd] } : {}),
      ...(context.session.model ? { model: context.session.model } : {}),
      fullAccess: context.session.runtimeMode === "full-access",
    });

    yield* Effect.forkDetach(runTurn(context, turnState, args));

    return {
      threadId: input.threadId,
      turnId,
      resumeCursor: buildAntigravityResumeCursor(context),
    } satisfies ProviderTurnStartResult;
  });

  const interruptTurn = Effect.fn("interruptAntigravityTurn")(function* (
    threadId: ThreadId,
    turnId?: TurnId,
  ) {
    const context = yield* requireSession(threadId);
    if (turnId && context.turnState && context.turnState.turnId !== turnId) {
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "interruptTurn",
        issue: `Turn '${turnId}' is not active for thread '${threadId}'.`,
      });
    }
    if (!context.turnState || (!context.activeChild && !context.activePty)) {
      return;
    }
    context.interruptRequested = true;
    if (context.activeChild) {
      killChildProcess(context.activeChild);
    }
    if (context.activePty) {
      context.activePty.kill();
      context.activePty = undefined;
    }
  });

  const respondToRequest = (threadId: ThreadId) =>
    Effect.fail(
      new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "respondToRequest",
        issue: `The Antigravity CLI (\`agy\`) runtime does not emit approval requests for thread '${threadId}'.`,
      }),
    );

  const stopSession = Effect.fn("stopAntigravitySession")(function* (threadId: ThreadId) {
    const context = yield* requireSession(threadId);
    context.stopped = true;
    if (context.activeChild) {
      killChildProcess(context.activeChild);
      context.activeChild = undefined;
    }
    if (context.activePty) {
      context.activePty.kill();
      context.activePty = undefined;
    }
    updateSession(context, { status: "closed", activeTurnId: undefined });
    yield* emitSessionState(context, "stopped", "session_closed");
    yield* deps.emitEvent({
      ...makeEventBase(context),
      type: "session.exited",
      payload: {
        reason: "Antigravity session stopped.",
        exitKind: "graceful",
      },
    });
    sessions.delete(threadId);
  });

  const listSessions = () =>
    Effect.succeed(
      Array.from(sessions.values())
        .filter((context) => !context.stopped)
        .map((context) => context.session),
    );

  const hasSession = (threadId: ThreadId) =>
    Effect.succeed(Boolean(sessions.get(threadId) && !sessions.get(threadId)?.stopped));

  const readThread = Effect.fn("readAntigravityThread")(function* (threadId: ThreadId) {
    const context = yield* requireSession(threadId);
    return {
      threadId: context.session.threadId,
      turns: context.turns.map((turn) => ({ id: turn.id, items: [...turn.items] })),
    };
  });

  const rollbackThread = (threadId: ThreadId) =>
    Effect.fail(
      new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "rollbackThread",
        issue: `The Antigravity CLI (\`agy\`) runtime does not support rolling back turns for thread '${threadId}'.`,
      }),
    );

  const stopAll = () =>
    Effect.forEach(Array.from(sessions.keys()), (threadId) => stopSession(threadId), {
      concurrency: "unbounded",
      discard: true,
    }).pipe(Effect.ignore, Effect.asVoid);

  const listModels = (input: { readonly binaryPath: string; readonly cwd?: string }) =>
    probeAntigravityCapabilities(input).pipe(
      Effect.map(
        (result) =>
          ({
            models: result.models,
            source: "gemini.agy",
            cached: false,
          }) satisfies ProviderListModelsResult,
      ),
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "model/list",
            detail: toMessage(cause, "Failed to list Antigravity models."),
            cause,
          }),
      ),
    );

  const disposeAll = (): void => {
    for (const context of Array.from(sessions.values())) {
      context.stopped = true;
      if (context.activeChild) {
        killChildProcess(context.activeChild);
        context.activeChild = undefined;
      }
      if (context.activePty) {
        context.activePty.kill();
        context.activePty = undefined;
      }
      sessions.delete(context.session.threadId);
    }
  };

  return {
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
    listModels,
    disposeAll,
  };
};

export type GeminiAntigravityRuntime = ReturnType<typeof makeGeminiAntigravityRuntime>;
