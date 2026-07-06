// FILE: conflictResolutionWatcher.tsx
// Purpose: Watches threads with an active conflict-resolution handoff and, when the agent's
//          turn completes, re-runs the read-only conflict check automatically — updating the
//          per-thread tracker (rendered above the composer) and toasting the outcome.
// Layer: Notification runtime
// Exports: ConflictResolutionWatcher

import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { toastManager } from "../components/ui/toast";
import {
  type ConflictCheckOutcome,
  runTrackedConflictCheck,
  shouldCheckAfterTurn,
  useConflictResolutionStore,
} from "../conflictResolutionStore";
import { useStore } from "../store";
import { createAllThreadsSelector } from "../storeSelectors";
import type { Thread } from "../types";

function toastCheckOutcome(
  outcome: ConflictCheckOutcome,
  threadId: Thread["id"],
  navigate: ReturnType<typeof useNavigate>,
): void {
  const copy =
    outcome.kind === "resolved"
      ? {
          tone: "success" as const,
          title: "Conflicts resolved",
          description: `${outcome.label} — the agent's changes pass the conflict check.`,
        }
      : outcome.kind === "unresolved"
        ? {
            tone: "warning" as const,
            title: "Conflicts remain",
            description: `${outcome.label} — ${outcome.files.length} file${outcome.files.length === 1 ? "" : "s"} still conflicting.`,
          }
        : {
            tone: "warning" as const,
            title: "Conflict re-check failed",
            description: `${outcome.label} — ${outcome.message}`,
          };

  toastManager.add({
    type: copy.tone,
    title: copy.title,
    description: copy.description,
    data: {
      allowCrossThreadVisibility: true,
      threadId,
      dismissAfterVisibleMs: 8000,
    },
    actionProps: {
      children: "Open",
      onClick: () => {
        void navigate({
          to: "/$threadId",
          params: { threadId },
          search: (previous) => ({ ...previous, splitViewId: undefined }),
        });
      },
    },
  });
}

export function ConflictResolutionWatcher() {
  const navigate = useNavigate();
  const threads = useStore(useRef(createAllThreadsSelector()).current);
  const trackersByThreadId = useConflictResolutionStore((state) => state.trackersByThreadId);

  useEffect(() => {
    for (const thread of threads) {
      const tracker = trackersByThreadId[thread.id];
      if (!shouldCheckAfterTurn(tracker, thread.latestTurn)) {
        continue;
      }
      // markChecking records the turn id synchronously, so a re-render during the async
      // check cannot re-trigger for the same turn.
      void runTrackedConflictCheck(thread.id, thread.latestTurn?.turnId ?? null).then((outcome) => {
        if (outcome) {
          toastCheckOutcome(outcome, thread.id, navigate);
        }
      });
    }
  }, [navigate, threads, trackersByThreadId]);

  return null;
}
