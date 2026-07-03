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
import { asNumber, asRecord, asString, trimToUndefined } from "../geminiValue.ts";
import { killChildProcess } from "../processControl.ts";
import { extractProposedPlanMarkdown, withProviderPlanModePrompt } from "../planMode.ts";

const PROVIDER = "gemini" as const;
const ANTIGRAVITY_RESUME_FLAVOR = "antigravity" as const;
// Matches the 30 minute ACP prompt timeout; agy enforces it internally.
const ANTIGRAVITY_PRINT_TIMEOUT = "30m";
const MAX_CAPTURED_STDERR_LINES = 5;

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
  interruptRequested: boolean;
  stopped: boolean;
  lastKnownTokenUsage: ThreadTokenUsageSnapshot | undefined;
}

export interface GeminiAntigravityRuntimeDeps {
  readonly attachmentsDir: string;
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
  readonly model?: string;
  readonly fullAccess: boolean;
}): Array<string> {
  return [
    "--print",
    input.prompt,
    "--output-format",
    "json",
    "--print-timeout",
    ANTIGRAVITY_PRINT_TIMEOUT,
    ...(input.conversationId ? ["--conversation", input.conversationId] : []),
    ...(input.model ? ["--model", input.model] : []),
    ...(input.fullAccess ? ["--dangerously-skip-permissions"] : []),
  ];
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
    yield* deps.emitEvent({
      ...makeEventBase(context),
      turnId: turnState.turnId,
      itemId: turnState.assistantItemId,
      type: "content.delta",
      payload: {
        streamKind: "assistant_text",
        delta: responseText,
      },
      raw: {
        source: "gemini.agy.result",
        method: "print.response",
        payload: rawPayload,
      },
    });
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

  const runTurn = Effect.fn("runAntigravityTurn")(function* (
    context: AntigravitySessionContext,
    turnState: AntigravityTurnState,
    args: ReadonlyArray<string>,
  ) {
    const spawnResult = yield* Effect.result(spawnTurnProcess(context, args));
    if (spawnResult._tag === "Failure") {
      const message = toMessage(spawnResult.failure, "Failed to spawn Antigravity CLI.");
      yield* emitRuntimeError(context, message, { detail: message }, turnState.turnId);
      yield* finishTurn(context, { state: "failed", errorMessage: message });
      return;
    }

    const child = spawnResult.success;
    context.activeChild = child;
    const processResult = yield* awaitTurnProcess(child);
    context.activeChild = undefined;
    const interrupted = context.interruptRequested;
    context.interruptRequested = false;

    yield* deps.writeNativeRecord(context.session.threadId, {
      source: "gemini.agy.result",
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

    const envelope = parseAntigravityPrintOutput(processResult.stdout);
    if (envelope.conversationId) {
      context.conversationId = envelope.conversationId;
      yield* emitThreadStartedOnce(context);
    }

    if (envelope.status && envelope.status !== "SUCCESS") {
      const message = `Antigravity CLI reported turn status '${envelope.status}'.${envelope.response ? ` ${envelope.response.trim()}` : ""}`;
      yield* emitRuntimeError(context, message, envelope.raw, turnState.turnId);
      yield* finishTurn(context, { state: "failed", errorMessage: message });
      return;
    }

    yield* emitAssistantMessage(context, turnState, envelope.response, envelope.raw);
    if (envelope.usage) {
      yield* emitUsage(context, envelope.usage, turnState.turnId, envelope.raw);
    }
    yield* finishTurn(context, { state: "completed", responseText: envelope.response });
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
    const promptText = appendFileAttachmentsPromptBlock({
      text: planPromptText,
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

    const args = buildAntigravityTurnArgs({
      prompt: promptText,
      ...(context.conversationId ? { conversationId: context.conversationId } : {}),
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
    if (!context.turnState || !context.activeChild) {
      return;
    }
    context.interruptRequested = true;
    killChildProcess(context.activeChild);
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

  const listModels = (binaryPath: string) =>
    probeAntigravityCapabilities({ binaryPath }).pipe(
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
