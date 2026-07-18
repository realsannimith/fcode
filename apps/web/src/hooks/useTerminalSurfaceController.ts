// FILE: useTerminalSurfaceController.ts
// Purpose: Shared terminal-store controller for non-chat terminal surfaces
//          (right-dock terminal pane + workspace page). Owns the store selector
//          slice, the focus-request bump, and the standard create/split/tab/move/
//          activate/close handlers that were duplicated across those surfaces.
// Layer: Web terminal UI hook
// Note: ChatView is intentionally NOT a consumer — it adds split limits, placeholder
//       thread cleanup, and split-view navigation, so it shares only the lower-level
//       terminalSession helpers instead of this controller.

import { type ThreadId } from "@t3tools/contracts";
import {
  type TerminalCodingAgentKind,
  type TerminalCliKind,
} from "@t3tools/shared/terminalThreads";
import { useCallback, useRef, useState } from "react";

import { useAppSettings } from "~/appSettings";
import { resolveAgentLauncherTerminalTarget } from "~/agentLaunchers";
import {
  confirmTerminalTabClose,
  resolveTerminalCloseTitle,
  shouldPromptForTerminalClose,
} from "~/lib/terminalCloseConfirmation";
import { readNativeApi } from "~/nativeApi";
import { runProjectCommandInTerminal } from "~/projectTerminalRunner";
import { collectTerminalIdsFromLayout } from "~/terminalPaneLayout";
import { selectThreadTerminalState, useTerminalStateStore } from "~/terminalStateStore";
import { MAX_TERMINALS_PER_GROUP, type ThreadTerminalDropPosition } from "~/types";
import {
  disposeAndCloseTerminalSession,
  randomTerminalId,
} from "~/components/terminal/terminalSession";

type TerminalMetadata = {
  agentKind?: TerminalCodingAgentKind | null;
  cliKind: TerminalCliKind | null;
  label: string;
};
type TerminalActivity = {
  hasRunningSubprocess: boolean;
  agentState: "running" | "attention" | "review" | null;
};

export function useTerminalSurfaceController(threadId: ThreadId) {
  const { settings } = useAppSettings();
  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadId, threadId),
  );
  const openTerminalThreadPage = useTerminalStateStore((s) => s.openTerminalThreadPage);
  const applyWorkspaceLayoutPreset = useTerminalStateStore((s) => s.applyWorkspaceLayoutPreset);
  const newTerminal = useTerminalStateStore((s) => s.newTerminal);
  const newTerminalTab = useTerminalStateStore((s) => s.newTerminalTab);
  const splitTerminalRightStore = useTerminalStateStore((s) => s.splitTerminalRight);
  const splitTerminalDownStore = useTerminalStateStore((s) => s.splitTerminalDown);
  const setActiveTerminalStore = useTerminalStateStore((s) => s.setActiveTerminal);
  const closeTerminalStore = useTerminalStateStore((s) => s.closeTerminal);
  const closeTerminalGroupStore = useTerminalStateStore((s) => s.closeTerminalGroup);
  const moveTerminalGroupStore = useTerminalStateStore((s) => s.moveTerminalGroup);
  const mergeTerminalGroupsStore = useTerminalStateStore((s) => s.mergeTerminalGroups);
  const moveTerminalToPaneStore = useTerminalStateStore((s) => s.moveTerminalToPane);
  const setTerminalHeightStore = useTerminalStateStore((s) => s.setTerminalHeight);
  const resizeTerminalSplitStore = useTerminalStateStore((s) => s.resizeTerminalSplit);
  const setTerminalMetadataStore = useTerminalStateStore((s) => s.setTerminalMetadata);
  const setTerminalActivityStore = useTerminalStateStore((s) => s.setTerminalActivity);
  const launchingAgentTerminalIdsRef = useRef<Set<string>>(new Set());

  const [focusRequestId, setFocusRequestId] = useState(0);
  const bumpFocusRequest = useCallback(() => setFocusRequestId((value) => value + 1), []);

  const newTerminalGroup = useCallback(() => {
    newTerminal(threadId, randomTerminalId());
    bumpFocusRequest();
  }, [bumpFocusRequest, newTerminal, threadId]);

  const splitRight = useCallback(() => {
    splitTerminalRightStore(threadId, randomTerminalId());
    bumpFocusRequest();
  }, [bumpFocusRequest, splitTerminalRightStore, threadId]);

  const splitDown = useCallback(() => {
    splitTerminalDownStore(threadId, randomTerminalId());
    bumpFocusRequest();
  }, [bumpFocusRequest, splitTerminalDownStore, threadId]);

  const createTerminalTab = useCallback(
    (targetTerminalId: string) => {
      newTerminalTab(threadId, targetTerminalId, randomTerminalId());
      bumpFocusRequest();
    },
    [bumpFocusRequest, newTerminalTab, threadId],
  );

  // Type a quick-launch AI CLI into an untouched terminal, then use a fresh tab once an agent
  // session is already present. The command is user-configured (Settings → Behavior → Agent
  // launchers); provider icon/title are derived by runProjectCommandInTerminal and persisted.
  const launchAgentCommand = useCallback(
    async (input: {
      command: string;
      label: string;
      cwd: string;
      projectCwd: string;
      worktreePath: string | null;
    }) => {
      const api = readNativeApi();
      if (!api || input.cwd.trim().length === 0 || input.projectCwd.trim().length === 0) {
        return;
      }
      const anchorTerminalId = terminalState.activeTerminalId || terminalState.terminalIds[0] || "";
      const target = resolveAgentLauncherTerminalTarget({
        baseTerminalId: anchorTerminalId,
        createTerminalId: randomTerminalId,
        hasRunningTerminal:
          terminalState.runningTerminalIds.length > 0 ||
          launchingAgentTerminalIdsRef.current.size > 0,
        hasLaunchedAgent: Object.keys(terminalState.terminalAgentKindsById ?? {}).length > 0,
      });
      const terminalId = target.terminalId;
      launchingAgentTerminalIdsRef.current.add(terminalId);
      // Reuse an untouched terminal for the first launcher. Once the active terminal has a
      // running subprocess or an identified agent session, launch into a new tab beside it;
      // only overflow past the per-group tab limit (or a missing anchor) falls back to a group.
      const anchorGroup =
        terminalState.terminalGroups.find(
          (group) => group.id === terminalState.activeTerminalGroupId,
        ) ??
        terminalState.terminalGroups.find((group) =>
          collectTerminalIdsFromLayout(group.layout).includes(anchorTerminalId),
        ) ??
        null;
      const anchorGroupFull = anchorGroup
        ? collectTerminalIdsFromLayout(anchorGroup.layout).length >= MAX_TERMINALS_PER_GROUP
        : false;
      if (target.shouldCreateNewTerminal && (anchorTerminalId.length === 0 || anchorGroupFull)) {
        newTerminal(threadId, terminalId);
      } else if (target.shouldCreateNewTerminal) {
        newTerminalTab(threadId, anchorTerminalId, terminalId);
      } else {
        setActiveTerminalStore(threadId, terminalId);
      }
      bumpFocusRequest();
      try {
        const { metadata } = await runProjectCommandInTerminal({
          api,
          threadId,
          terminalId,
          project: { cwd: input.projectCwd },
          cwd: input.cwd,
          command: input.command,
          worktreePath: input.worktreePath,
        });
        if (metadata) {
          setTerminalMetadataStore(threadId, terminalId, {
            agentKind: metadata.agentKind,
            cliKind: metadata.cliKind,
            label: metadata.label,
          });
        }
      } catch {
        // These surfaces have no thread-error channel; a failed spawn just leaves the new
        // (empty) terminal open, matching how a manual "new terminal" behaves on failure.
      } finally {
        launchingAgentTerminalIdsRef.current.delete(terminalId);
      }
    },
    [
      bumpFocusRequest,
      newTerminal,
      newTerminalTab,
      setActiveTerminalStore,
      setTerminalMetadataStore,
      terminalState.activeTerminalGroupId,
      terminalState.activeTerminalId,
      terminalState.runningTerminalIds,
      terminalState.terminalAgentKindsById,
      terminalState.terminalCliKindsById,
      terminalState.terminalGroups,
      terminalState.terminalIds,
      threadId,
    ],
  );

  const activateTerminal = useCallback(
    (terminalId: string) => {
      setActiveTerminalStore(threadId, terminalId);
      bumpFocusRequest();
    },
    [bumpFocusRequest, setActiveTerminalStore, threadId],
  );

  const closeTerminal = useCallback(
    async (terminalId: string) => {
      const api = readNativeApi();
      const confirmed = await confirmTerminalTabClose({
        api,
        enabled: shouldPromptForTerminalClose({
          confirmationEnabled: settings.confirmTerminalTabClose,
          runningTerminalIds: terminalState.runningTerminalIds,
          terminalAttentionStatesById: terminalState.terminalAttentionStatesById,
          terminalId,
        }),
        terminalTitle: resolveTerminalCloseTitle({
          terminalId,
          terminalLabelsById: terminalState.terminalLabelsById,
          terminalTitleOverridesById: terminalState.terminalTitleOverridesById,
        }),
      });
      if (!confirmed) {
        return;
      }
      disposeAndCloseTerminalSession({ api, threadId, terminalId });
      closeTerminalStore(threadId, terminalId);
      bumpFocusRequest();
    },
    [
      bumpFocusRequest,
      closeTerminalStore,
      settings.confirmTerminalTabClose,
      terminalState.runningTerminalIds,
      terminalState.terminalAttentionStatesById,
      terminalState.terminalLabelsById,
      terminalState.terminalTitleOverridesById,
      threadId,
    ],
  );

  const closeTerminalGroup = useCallback(
    (groupId: string) => closeTerminalGroupStore(threadId, groupId),
    [closeTerminalGroupStore, threadId],
  );

  const moveTerminalGroup = useCallback(
    (activeGroupId: string, overGroupId: string) =>
      moveTerminalGroupStore(threadId, activeGroupId, overGroupId),
    [moveTerminalGroupStore, threadId],
  );

  const mergeTerminalGroups = useCallback(
    (sourceGroupId: string, targetGroupId: string, position: ThreadTerminalDropPosition) =>
      mergeTerminalGroupsStore(threadId, sourceGroupId, targetGroupId, position),
    [mergeTerminalGroupsStore, threadId],
  );

  const moveTerminalToPane = useCallback(
    (terminalId: string, targetTerminalId: string, position: ThreadTerminalDropPosition) =>
      moveTerminalToPaneStore(threadId, terminalId, targetTerminalId, position),
    [moveTerminalToPaneStore, threadId],
  );

  const setTerminalHeight = useCallback(
    (height: number) => setTerminalHeightStore(threadId, height),
    [setTerminalHeightStore, threadId],
  );

  const resizeTerminalSplit = useCallback(
    (groupId: string, splitId: string, weights: number[]) =>
      resizeTerminalSplitStore(threadId, groupId, splitId, weights),
    [resizeTerminalSplitStore, threadId],
  );

  const setTerminalMetadata = useCallback(
    (terminalId: string, metadata: TerminalMetadata) =>
      setTerminalMetadataStore(threadId, terminalId, metadata),
    [setTerminalMetadataStore, threadId],
  );

  const setTerminalActivity = useCallback(
    (terminalId: string, activity: TerminalActivity) =>
      setTerminalActivityStore(threadId, terminalId, activity),
    [setTerminalActivityStore, threadId],
  );

  return {
    terminalState,
    focusRequestId,
    bumpFocusRequest,
    openTerminalThreadPage,
    applyWorkspaceLayoutPreset,
    newTerminalGroup,
    splitRight,
    splitDown,
    createTerminalTab,
    launchAgentCommand,
    activateTerminal,
    closeTerminal,
    closeTerminalGroup,
    moveTerminalGroup,
    mergeTerminalGroups,
    moveTerminalToPane,
    setTerminalHeight,
    resizeTerminalSplit,
    setTerminalMetadata,
    setTerminalActivity,
  };
}
