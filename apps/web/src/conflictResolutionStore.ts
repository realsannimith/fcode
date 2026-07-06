// FILE: conflictResolutionStore.ts
// Purpose: Tracks agent conflict-resolution handoffs per thread so the UI can show live
//          status (waiting → checking → resolved/unresolved) and auto re-verify conflicts
//          once the agent's turn completes. Session-scoped (not persisted): the tracker
//          describes an in-flight handoff, which does not outlive the app.
// Layer: Web state store
// Exports: tracker types, useConflictResolutionStore, shouldCheckAfterTurn, runTrackedConflictCheck

import type { OrchestrationLatestTurn, ThreadId, TurnId } from "@t3tools/contracts";
import { create } from "zustand";

import { ensureNativeApi } from "./nativeApi";

export type ConflictResolutionKind = "merge" | "pr";

export type ConflictResolutionStatus =
  | "waiting" // handed to the agent; waiting for its turn to complete
  | "checking" // re-running the conflict simulation
  | "resolved" // last check found no conflicts
  | "unresolved" // last check still found conflicting files
  | "check_failed"; // last check errored (e.g. branch gone); user can retry

export interface ConflictResolutionTracker {
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly kind: ConflictResolutionKind;
  /** Human-facing scope label, e.g. `feature → main` or `PR #12 — Fix login`. */
  readonly label: string;
  /** Merge checks re-run with these; null for PR trackers. */
  readonly sourceBranch: string | null;
  readonly targetBranch: string | null;
  /** PR checks re-run with this reference; null for merge trackers. */
  readonly prReference: string | null;
  /** Turn that was already the latest at handoff — its completion must not trigger a check. */
  readonly handoffTurnId: TurnId | null;
  /** Last turn a check ran for, so one completion triggers exactly one check. */
  readonly lastCheckedTurnId: TurnId | null;
  readonly status: ConflictResolutionStatus;
  readonly initialFiles: readonly string[];
  readonly remainingFiles: readonly string[];
  readonly errorMessage: string | null;
}

export type StartConflictResolutionTrackingInput = Omit<
  ConflictResolutionTracker,
  "status" | "lastCheckedTurnId" | "remainingFiles" | "errorMessage"
>;

export type ConflictCheckOutcome =
  | { readonly kind: "resolved"; readonly label: string }
  | { readonly kind: "unresolved"; readonly label: string; readonly files: readonly string[] }
  | { readonly kind: "failed"; readonly label: string; readonly message: string };

interface ConflictResolutionStoreState {
  trackersByThreadId: Readonly<Record<ThreadId, ConflictResolutionTracker>>;
  startTracking: (input: StartConflictResolutionTrackingInput) => void;
  markChecking: (threadId: ThreadId, checkedTurnId: TurnId | null) => void;
  applyCheckResult: (
    threadId: ThreadId,
    result: { mergeable: boolean; conflictingFiles: readonly string[] },
  ) => void;
  markCheckFailed: (threadId: ThreadId, message: string) => void;
  dismiss: (threadId: ThreadId) => void;
}

function patchTracker(
  trackersByThreadId: Readonly<Record<ThreadId, ConflictResolutionTracker>>,
  threadId: ThreadId,
  patch: Partial<ConflictResolutionTracker>,
): Readonly<Record<ThreadId, ConflictResolutionTracker>> {
  const tracker = trackersByThreadId[threadId];
  if (!tracker) return trackersByThreadId;
  return { ...trackersByThreadId, [threadId]: { ...tracker, ...patch } };
}

export const useConflictResolutionStore = create<ConflictResolutionStoreState>()((set) => ({
  trackersByThreadId: {},
  startTracking: (input) =>
    set((state) => ({
      trackersByThreadId: {
        ...state.trackersByThreadId,
        [input.threadId]: {
          ...input,
          status: "waiting",
          lastCheckedTurnId: null,
          remainingFiles: input.initialFiles,
          errorMessage: null,
        },
      },
    })),
  markChecking: (threadId, checkedTurnId) =>
    set((state) => ({
      trackersByThreadId: patchTracker(state.trackersByThreadId, threadId, {
        status: "checking",
        ...(checkedTurnId ? { lastCheckedTurnId: checkedTurnId } : {}),
        errorMessage: null,
      }),
    })),
  applyCheckResult: (threadId, result) =>
    set((state) => ({
      trackersByThreadId: patchTracker(state.trackersByThreadId, threadId, {
        status: result.mergeable ? "resolved" : "unresolved",
        remainingFiles: result.mergeable ? [] : result.conflictingFiles,
        errorMessage: null,
      }),
    })),
  markCheckFailed: (threadId, message) =>
    set((state) => ({
      trackersByThreadId: patchTracker(state.trackersByThreadId, threadId, {
        status: "check_failed",
        errorMessage: message,
      }),
    })),
  dismiss: (threadId) =>
    set((state) => {
      if (!state.trackersByThreadId[threadId]) return state;
      const next = { ...state.trackersByThreadId };
      delete next[threadId];
      return { trackersByThreadId: next };
    }),
}));

/**
 * A completed turn should trigger exactly one automatic re-check, and only for turns that
 * started after the handoff (the turn that was already latest when the user handed off must
 * not re-check — the agent hasn't done anything yet).
 */
export function shouldCheckAfterTurn(
  tracker: ConflictResolutionTracker | undefined,
  latestTurn: OrchestrationLatestTurn | null,
): boolean {
  if (!tracker) return false;
  if (tracker.status !== "waiting" && tracker.status !== "unresolved") return false;
  if (!latestTurn?.completedAt) return false;
  if (latestTurn.turnId === tracker.handoffTurnId) return false;
  if (latestTurn.turnId === tracker.lastCheckedTurnId) return false;
  return true;
}

/**
 * Re-runs the read-only conflict simulation for a tracked handoff and folds the result into
 * the store. Safe to call from the watcher (auto) and the banner (manual "Check now"); a
 * check already in flight makes this a no-op.
 */
export async function runTrackedConflictCheck(
  threadId: ThreadId,
  checkedTurnId: TurnId | null = null,
): Promise<ConflictCheckOutcome | null> {
  const store = useConflictResolutionStore.getState();
  const tracker = store.trackersByThreadId[threadId];
  if (!tracker || tracker.status === "checking") return null;
  store.markChecking(threadId, checkedTurnId);

  try {
    const api = ensureNativeApi();
    const result =
      tracker.kind === "merge" && tracker.targetBranch
        ? await api.git.checkMergeConflicts({
            cwd: tracker.cwd,
            targetBranch: tracker.targetBranch,
            ...(tracker.sourceBranch ? { sourceBranch: tracker.sourceBranch } : {}),
          })
        : tracker.prReference
          ? await api.git.checkPullRequestConflicts({
              cwd: tracker.cwd,
              reference: tracker.prReference,
            })
          : null;
    if (!result) {
      const message = "Tracker is missing the branch or PR reference needed to re-check.";
      useConflictResolutionStore.getState().markCheckFailed(threadId, message);
      return { kind: "failed", label: tracker.label, message };
    }

    useConflictResolutionStore.getState().applyCheckResult(threadId, {
      mergeable: result.mergeable,
      conflictingFiles: result.conflictingFiles,
    });
    return result.mergeable
      ? { kind: "resolved", label: tracker.label }
      : { kind: "unresolved", label: tracker.label, files: result.conflictingFiles };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Conflict re-check failed.";
    useConflictResolutionStore.getState().markCheckFailed(threadId, message);
    return { kind: "failed", label: tracker.label, message };
  }
}
