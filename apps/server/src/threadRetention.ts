// FILE: threadRetention.ts
// Purpose: Runs the server-side retention loop that hides inactive orchestration threads.
// Layer: Server maintenance
// Exports: retention constants, inactive-thread selection, and scoped job startup.

import {
  CommandId,
  type OrchestrationReadModel,
  type OrchestrationShellSnapshot,
  type ThreadId,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";

import type { OrchestrationEngineShape } from "./orchestration/Services/OrchestrationEngine";
import type { ProjectionSnapshotQueryShape } from "./orchestration/Services/ProjectionSnapshotQuery";
import { ServerLifecycleEvents } from "./serverLifecycleEvents";
import type { TerminalManagerShape, TerminalThreadActivity } from "./terminal/Services/Manager";

export const THREAD_RETENTION_UNUSED_MS = 7 * 24 * 60 * 60 * 1000;
export const THREAD_RETENTION_INITIAL_SWEEP_DELAY_MS = 5 * 60 * 1000;
export const THREAD_RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const THREAD_RETENTION_BATCH_SIZE = 25;
const THREAD_RETENTION_BATCH_PAUSE_MS = 50;

type RetentionThread =
  | OrchestrationReadModel["threads"][number]
  | OrchestrationShellSnapshot["threads"][number];

type RetentionMaintenanceState = "started" | "progress" | "completed" | "failed";

function parseIsoMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function getThreadLastActivityMs(thread: RetentionThread): number | null {
  return (
    parseIsoMs(thread.latestUserMessageAt) ??
    parseIsoMs(thread.updatedAt) ??
    parseIsoMs(thread.createdAt)
  );
}

function isThreadBusy(thread: RetentionThread): boolean {
  if (thread.session?.status === "starting" || thread.session?.status === "running") {
    return true;
  }
  if (thread.session?.activeTurnId !== null && thread.session?.activeTurnId !== undefined) {
    return true;
  }
  if (thread.latestTurn?.state === "running") {
    return true;
  }
  if (thread.hasPendingApprovals === true || thread.hasPendingUserInput === true) {
    return true;
  }
  return false;
}

function chunkThreadIds(
  threadIds: Iterable<ThreadId>,
  size = THREAD_RETENTION_BATCH_SIZE,
): ThreadId[][] {
  const chunks: ThreadId[][] = [];
  let chunk: ThreadId[] = [];
  for (const threadId of threadIds) {
    chunk.push(threadId);
    if (chunk.length < size) continue;
    chunks.push(chunk);
    chunk = [];
  }
  if (chunk.length > 0) {
    chunks.push(chunk);
  }
  return chunks;
}

const pauseBetweenRetentionBatches = Effect.sleep(THREAD_RETENTION_BATCH_PAUSE_MS);

const publishRetentionMaintenance = Effect.fn("publishRetentionMaintenance")(function* (
  state: RetentionMaintenanceState,
  details: {
    readonly deletedCount?: number;
    readonly totalCount?: number;
    readonly error?: string;
  } = {},
) {
  const lifecycleEvents = yield* ServerLifecycleEvents;
  yield* lifecycleEvents
    .publish({
      type: "maintenance",
      payload: {
        task: "thread-retention",
        state,
        at: new Date().toISOString(),
        ...details,
      },
    })
    .pipe(
      Effect.catch((error) =>
        Effect.logDebug("failed to publish thread retention maintenance event").pipe(
          Effect.annotateLogs({ state, error: String(error) }),
        ),
      ),
    );
});

// Terminal usage never touches orchestration state (no turns, no messages, no
// updatedAt bumps), so a terminal-first thread looks permanently idle to the
// selection above. Threads with a live terminal session, or whose terminals were
// used inside the retention window, must never be hidden — hiding one closes its
// PTYs underneath an attached UI and kills whatever agent is running in them.
export function shouldRetainThreadForTerminalActivity(
  activity: TerminalThreadActivity,
  nowMs = Date.now(),
): boolean {
  if (activity.hasLiveSession) return true;
  const cutoffMs = nowMs - THREAD_RETENTION_UNUSED_MS;
  return activity.lastActivityMs !== null && activity.lastActivityMs > cutoffMs;
}

// Picks inactive threads to soft-delete from the app while keeping their DB rows for stats.
export function getInactiveThreadIdsForRetention(
  readModel: Pick<OrchestrationReadModel, "threads"> | Pick<OrchestrationShellSnapshot, "threads">,
  nowMs = Date.now(),
): ThreadId[] {
  const cutoffMs = nowMs - THREAD_RETENTION_UNUSED_MS;
  const inactiveThreadIds: ThreadId[] = [];

  for (const thread of readModel.threads) {
    if ("deletedAt" in thread && thread.deletedAt !== null) continue;
    if (thread.isPinned === true) continue;
    if (isThreadBusy(thread)) continue;
    const lastActivityMs = getThreadLastActivityMs(thread);
    if (lastActivityMs === null || lastActivityMs > cutoffMs) continue;
    inactiveThreadIds.push(thread.id);
  }

  return inactiveThreadIds;
}

export const runThreadRetentionSweep = Effect.fn("runThreadRetentionSweep")(function* (
  orchestrationEngine: OrchestrationEngineShape,
  projectionSnapshotQuery: ProjectionSnapshotQueryShape,
  terminalManager: TerminalManagerShape,
) {
  const shellSnapshot = yield* projectionSnapshotQuery.getShellSnapshot();
  const nowMs = Date.now();
  const candidateThreadIds = getInactiveThreadIdsForRetention(shellSnapshot, nowMs);

  // Drop candidates that are still in use through their terminals. On lookup
  // failure, retain the thread: hiding an active workspace is destructive, while
  // keeping an idle one another day is harmless.
  const inactiveThreadIds: ThreadId[] = [];
  for (const threadId of candidateThreadIds) {
    const retainForTerminals = yield* terminalManager.getThreadActivity(threadId).pipe(
      Effect.map((activity) => shouldRetainThreadForTerminalActivity(activity, nowMs)),
      Effect.catch((error) =>
        Effect.logWarning("failed to read terminal activity during retention sweep").pipe(
          Effect.annotateLogs({ threadId, error: String(error) }),
          Effect.as(true),
        ),
      ),
    );
    if (!retainForTerminals) {
      inactiveThreadIds.push(threadId);
    }
  }
  if (inactiveThreadIds.length < candidateThreadIds.length) {
    yield* Effect.logInfo("retention kept threads with recent terminal activity").pipe(
      Effect.annotateLogs({ count: candidateThreadIds.length - inactiveThreadIds.length }),
    );
  }

  const totalCandidateCount = inactiveThreadIds.length;
  let deletedCount = 0;

  if (inactiveThreadIds.length > 0) {
    yield* publishRetentionMaintenance("started", {
      deletedCount,
      totalCount: totalCandidateCount,
    });
    yield* Effect.logInfo("hiding inactive orchestration threads").pipe(
      Effect.annotateLogs({ count: inactiveThreadIds.length }),
    );
  }

  yield* Effect.forEach(
    chunkThreadIds(inactiveThreadIds),
    (threadBatch) =>
      Effect.forEach(
        threadBatch,
        (threadId) =>
          orchestrationEngine
            .dispatch({
              type: "thread.delete",
              commandId: CommandId.makeUnsafe(`thread-retention:${randomUUID()}`),
              threadId,
            })
            .pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  deletedCount += 1;
                }),
              ),
              Effect.catch((error) =>
                Effect.logWarning("failed to hide inactive thread during retention sweep").pipe(
                  Effect.annotateLogs({
                    threadId,
                    error: String(error),
                  }),
                ),
              ),
            ),
        { concurrency: 1 },
      ).pipe(
        Effect.tap(() =>
          publishRetentionMaintenance("progress", {
            deletedCount,
            totalCount: totalCandidateCount,
          }),
        ),
        Effect.tap(() => pauseBetweenRetentionBatches),
      ),
    { concurrency: 1 },
  ).pipe(Effect.asVoid);

  if (totalCandidateCount > 0) {
    yield* publishRetentionMaintenance("completed", {
      deletedCount,
      totalCount: totalCandidateCount,
    });
  }
});

export const startThreadRetentionJob = Effect.fn("startThreadRetentionJob")(function* (
  orchestrationEngine: OrchestrationEngineShape,
  projectionSnapshotQuery: ProjectionSnapshotQueryShape,
  terminalManager: TerminalManagerShape,
) {
  // Give startup/projection bootstrap a short settling window, then run one
  // hide pass promptly so desktop installs do not need to stay open for 24 hours.
  yield* Effect.gen(function* () {
    yield* Effect.sleep(THREAD_RETENTION_INITIAL_SWEEP_DELAY_MS);
    yield* runThreadRetentionSweep(orchestrationEngine, projectionSnapshotQuery, terminalManager);
    yield* Effect.forever(
      Effect.sleep(THREAD_RETENTION_SWEEP_INTERVAL_MS).pipe(
        Effect.flatMap(() =>
          runThreadRetentionSweep(orchestrationEngine, projectionSnapshotQuery, terminalManager),
        ),
      ),
      { disableYield: true },
    );
  }).pipe(Effect.forkScoped);
});
