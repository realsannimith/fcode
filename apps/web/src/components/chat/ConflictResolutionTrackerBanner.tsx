// FILE: ConflictResolutionTrackerBanner.tsx
// Purpose: Live status strip above the composer while a conflict resolution is handed to the
//          agent: waiting → checking → resolved / still-conflicted, with a manual "Check now"
//          re-run and a dismiss control. Self-contained: reads the tracker store directly so
//          it never competes with the precedence-picked ComposerInputBanners.
// Layer: Chat composer UI
// Exports: ConflictResolutionTrackerBanner

import { memo, useCallback, useMemo } from "react";

import type { ThreadId } from "@t3tools/contracts";

import {
  runTrackedConflictCheck,
  useConflictResolutionStore,
  type ConflictResolutionTracker,
} from "~/conflictResolutionStore";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import { CircleCheckIcon, GitMergeIcon, LoaderIcon, TriangleAlertIcon, XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  ComposerStackedPanelRow,
  ComposerStackedPanelRowLabel,
  ComposerStackedPanelRowMain,
} from "./ComposerStackedPanelContent";
import { COMPOSER_STACKED_PANEL_ICON_CLASS_NAME } from "./composerStackedPanelStyles";

function statusIcon(tracker: ConflictResolutionTracker) {
  switch (tracker.status) {
    case "checking":
      return <LoaderIcon className={cn(COMPOSER_STACKED_PANEL_ICON_CLASS_NAME, "animate-spin")} />;
    case "resolved":
      return (
        <CircleCheckIcon className={cn(COMPOSER_STACKED_PANEL_ICON_CLASS_NAME, "text-success")} />
      );
    case "unresolved":
    case "check_failed":
      return (
        <TriangleAlertIcon className={cn(COMPOSER_STACKED_PANEL_ICON_CLASS_NAME, "text-warning")} />
      );
    case "waiting":
      return <GitMergeIcon className={COMPOSER_STACKED_PANEL_ICON_CLASS_NAME} />;
  }
}

function statusText(tracker: ConflictResolutionTracker): string {
  const fileCount = tracker.remainingFiles.length;
  switch (tracker.status) {
    case "waiting":
      return `Resolving conflicts — ${tracker.label}. Auto-checks when the agent finishes (${fileCount} file${fileCount === 1 ? "" : "s"}).`;
    case "checking":
      return `Verifying conflicts — ${tracker.label}…`;
    case "resolved":
      return `Conflicts resolved — ${tracker.label}.`;
    case "unresolved":
      return `${fileCount} file${fileCount === 1 ? "" : "s"} still conflicting — ${tracker.label}.`;
    case "check_failed":
      return `Conflict re-check failed — ${tracker.errorMessage ?? tracker.label}`;
  }
}

export const ConflictResolutionTrackerBanner = memo(function ConflictResolutionTrackerBanner({
  threadId,
  attachedToPrevious = false,
}: {
  threadId: ThreadId | null;
  attachedToPrevious?: boolean;
}) {
  const tracker = useConflictResolutionStore(
    useCallback(
      (state) => (threadId ? (state.trackersByThreadId[threadId] ?? null) : null),
      [threadId],
    ),
  );
  const dismiss = useConflictResolutionStore((state) => state.dismiss);

  const remainingFilesTitle = useMemo(
    () => (tracker && tracker.remainingFiles.length > 0 ? tracker.remainingFiles.join("\n") : ""),
    [tracker],
  );

  if (!tracker || !threadId) {
    return null;
  }

  const showCheckNow = tracker.status !== "checking" && tracker.status !== "resolved";

  return (
    <ComposerStackedPanel attachedToPrevious={attachedToPrevious} className="flex flex-col">
      <ComposerStackedPanelRow compact data-testid="conflict-resolution-tracker-row">
        <ComposerStackedPanelRowMain title={remainingFilesTitle || undefined}>
          {statusIcon(tracker)}
          <ComposerStackedPanelRowLabel>{statusText(tracker)}</ComposerStackedPanelRowLabel>
        </ComposerStackedPanelRowMain>
        <div className="flex shrink-0 items-center gap-1">
          {showCheckNow ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => void runTrackedConflictCheck(threadId)}
            >
              {tracker.status === "waiting" ? "Check now" : "Check again"}
            </Button>
          ) : null}
          <IconButton
            label="Dismiss conflict tracking"
            tooltip="Dismiss conflict tracking"
            size="icon-xs"
            variant="ghost"
            onClick={() => dismiss(threadId)}
          >
            <XIcon className="size-3.5" />
          </IconButton>
        </div>
      </ComposerStackedPanelRow>
    </ComposerStackedPanel>
  );
});
