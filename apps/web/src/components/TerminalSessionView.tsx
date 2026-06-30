// FILE: TerminalSessionView.tsx
// Purpose: Full-surface terminal for a single CMUX-style session. Opens a terminal in
//          the session's cwd and, on first mount, types the agent's CLI command into it.
// Layer: Web terminal surface
// Depends on: useTerminalSurfaceController + ThreadTerminalDrawer (shared terminal UI),
//             runProjectCommandInTerminal (open shell + write command).

import { type ResolvedKeybindingsConfig, ThreadId } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import { useTerminalSurfaceController } from "~/hooks/useTerminalSurfaceController";
import { resolveShortcutCommand, shortcutLabelForCommand } from "~/keybindings";
import { isTerminalFocused } from "~/lib/terminalFocus";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { readNativeApi } from "~/nativeApi";
import {
  agentLaunchCommand,
  agentLaunchLabel,
  type AgentLaunchCommandSpec,
} from "~/agentLaunchCommands";
import { projectScriptRuntimeEnv } from "~/projectScripts";
import { runProjectCommandInTerminal } from "~/projectTerminalRunner";
import { terminalRuntimeRegistry } from "./terminal/terminalRuntimeRegistry";
import { type TerminalSession, useTerminalSessionsStore } from "~/terminalSessionsStore";
import type { WorkspaceLayoutPresetId } from "~/workspaceTerminalLayoutPresets";
import { MainSurface, MainTopBar } from "./MainTopBar";
import ThreadTerminalDrawer from "./ThreadTerminalDrawer";

function folderName(cwd: string): string {
  const parts = cwd.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];

function terminalIdForLaunchCommand(index: number): string {
  return index === 0 ? "default" : `launch-${index + 1}`;
}

function normalizeLaunchCommands(session: TerminalSession): AgentLaunchCommandSpec[] {
  const explicitCommands = (session.launchCommands ?? [])
    .slice(0, 4)
    .map((command, index): AgentLaunchCommandSpec | null => {
      const rawCommand = command.command;
      const normalizedCommand =
        rawCommand === null ? null : typeof rawCommand === "string" ? rawCommand.trim() : "";
      if (normalizedCommand !== null && normalizedCommand.length === 0) {
        return null;
      }
      const id = typeof command.id === "string" ? command.id.trim() : "";
      const label = typeof command.label === "string" ? command.label.trim() : "";
      return {
        id: id || terminalIdForLaunchCommand(index),
        label: label || `Command ${index + 1}`,
        command: normalizedCommand,
      };
    })
    .filter((command): command is AgentLaunchCommandSpec => command !== null);

  if (explicitCommands.length > 0) {
    return explicitCommands;
  }

  return [
    {
      id: "default",
      label: agentLaunchLabel(session.agent),
      command: agentLaunchCommand(session.agent),
    },
  ];
}

function layoutPresetForLaunchCommandCount(count: number): WorkspaceLayoutPresetId {
  if (count >= 4) return "quad";
  if (count === 3) return "left-main";
  if (count === 2) return "two-columns";
  return "single";
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function TerminalSessionView({ session }: { session: TerminalSession }) {
  const scopeId = useMemo(() => ThreadId.makeUnsafe(session.id), [session.id]);
  const cwd = session.cwd;
  const launchCommands = useMemo(() => normalizeLaunchCommands(session), [session]);
  const launchTerminalIds = useMemo(
    () => launchCommands.map((command) => command.id),
    [launchCommands],
  );
  const runtimeEnv = useMemo(
    () => (cwd ? projectScriptRuntimeEnv({ project: { cwd }, worktreePath: null }) : {}),
    [cwd],
  );
  const markLaunched = useTerminalSessionsStore((state) => state.markLaunched);

  const terminal = useTerminalSurfaceController(scopeId);
  const { terminalState, openTerminalThreadPage, bumpFocusRequest, newTerminalGroup } = terminal;

  // Split keyboard shortcuts (CMUX-style): mod+d → split right, mod+shift+d → split down.
  // This surface doesn't mount ChatView, so it owns its own terminal-split handler.
  const keybindings = useQuery(serverConfigQueryOptions()).data?.keybindings ?? EMPTY_KEYBINDINGS;
  const { splitRight, splitDown } = terminal;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const command = resolveShortcutCommand(event, keybindings, {
        context: { terminalFocus: isTerminalFocused(), terminalOpen: true },
      });
      let action: "right" | "down" | null = null;
      if (command === "terminal.split" || command === "terminal.splitRight") {
        action = "right";
      } else if (command === "terminal.splitDown") {
        action = "down";
      } else if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "d"
      ) {
        // Built-in fallback so ⌘D / ⌘⇧D split even when the server keybindings haven't
        // loaded the chord yet. ⌘⇧D splits down (stacked), ⌘D splits right.
        action = event.shiftKey ? "down" : "right";
      }
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === "right") splitRight();
      else splitDown();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [keybindings, splitDown, splitRight]);

  const splitShortcutLabel =
    shortcutLabelForCommand(keybindings, "terminal.splitRight") ??
    shortcutLabelForCommand(keybindings, "terminal.split") ??
    undefined;
  const splitDownShortcutLabel =
    shortcutLabelForCommand(keybindings, "terminal.splitDown") ?? undefined;

  // Always show a live terminal: open one on mount (and re-open if the last tab closes).
  useEffect(() => {
    if (terminalState.terminalOpen) return;
    openTerminalThreadPage(scopeId, { terminalOnly: true });
  }, [openTerminalThreadPage, scopeId, terminalState.terminalOpen]);

  useEffect(() => {
    if (session.launched || launchTerminalIds.length <= 1) return;
    if (arraysEqual(terminalState.terminalIds, launchTerminalIds)) return;
    terminal.applyWorkspaceLayoutPreset(
      scopeId,
      layoutPresetForLaunchCommandCount(launchTerminalIds.length),
      launchTerminalIds,
    );
  }, [launchTerminalIds, scopeId, session.launched, terminal, terminalState.terminalIds]);

  // Run the agent CLI once, after the terminal is open. Guarded by the persisted
  // `launched` flag so revisiting a session doesn't relaunch the agent.
  const launchingRef = useRef(false);
  useEffect(() => {
    if (session.launched || launchingRef.current) return;
    if (!terminalState.terminalOpen || !cwd) return;

    if (!launchTerminalIds.every((terminalId) => terminalState.terminalIds.includes(terminalId))) {
      return;
    }

    const runnableCommands = launchCommands.filter(
      (command): command is AgentLaunchCommandSpec & { command: string } =>
        command.command !== null && command.command.trim().length > 0,
    );
    if (runnableCommands.length === 0) {
      // Shell session: nothing to type, just mark it launched after the PTY is visible.
      markLaunched(session.id);
      return;
    }

    const api = readNativeApi();
    if (!api) return;

    launchingRef.current = true;
    void Promise.all(
      runnableCommands.map(async (launchCommand) => {
        // Wait until this pane's PTY is open at its real (fitted) width before typing the
        // agent command, so the agent's TUI boots at the correct size. Without this gate the
        // non-active split panes launch while still unsized and the TUI garbles (wraps to a
        // sliver) once the real fit lands. Best-effort: a timeout still launches.
        await terminalRuntimeRegistry.whenReady(scopeId, launchCommand.id);
        const { metadata } = await runProjectCommandInTerminal({
          api,
          threadId: scopeId,
          terminalId: launchCommand.id,
          project: { cwd },
          cwd,
          command: launchCommand.command,
        });
        terminal.setTerminalMetadata(launchCommand.id, {
          cliKind: metadata?.cliKind ?? null,
          label: metadata?.label ?? launchCommand.label,
        });
      }),
    )
      .then(() => {
        if (launchTerminalIds[0]) {
          terminal.activateTerminal(launchTerminalIds[0]);
        }
        markLaunched(session.id);
      })
      .catch(() => {
        launchingRef.current = false;
      });
  }, [
    cwd,
    launchCommands,
    launchTerminalIds,
    markLaunched,
    scopeId,
    session.id,
    session.launched,
    terminal,
    terminalState.terminalIds,
    terminalState.terminalOpen,
  ]);

  const createTerminal = () => {
    if (!terminalState.terminalOpen) {
      openTerminalThreadPage(scopeId, { terminalOnly: true });
      bumpFocusRequest();
      return;
    }
    newTerminalGroup();
  };

  return (
    <MainSurface>
      <MainTopBar
        title={
          <span className="truncate text-sm font-medium text-foreground" title={cwd}>
            {session.label || agentLaunchLabel(session.agent)}
            <span className="ml-1.5 font-normal text-muted-foreground">{folderName(cwd)}</span>
          </span>
        }
      />
      <div className="min-h-0 min-w-0 flex-1">
        <ThreadTerminalDrawer
          key={scopeId}
          threadId={scopeId}
          cwd={cwd}
          runtimeEnv={runtimeEnv}
          height={terminalState.terminalHeight}
          presentationMode="workspace"
          isVisible
          terminalIds={terminalState.terminalIds}
          terminalLabelsById={terminalState.terminalLabelsById}
          terminalTitleOverridesById={terminalState.terminalTitleOverridesById}
          terminalCliKindsById={terminalState.terminalCliKindsById}
          terminalAttentionStatesById={terminalState.terminalAttentionStatesById ?? {}}
          runningTerminalIds={terminalState.runningTerminalIds}
          activeTerminalId={terminalState.activeTerminalId}
          terminalGroups={terminalState.terminalGroups}
          activeTerminalGroupId={terminalState.activeTerminalGroupId}
          focusRequestId={terminal.focusRequestId}
          onSplitTerminal={terminal.splitRight}
          onSplitTerminalDown={terminal.splitDown}
          splitShortcutLabel={splitShortcutLabel}
          splitDownShortcutLabel={splitDownShortcutLabel}
          onNewTerminal={createTerminal}
          onNewTerminalTab={terminal.createTerminalTab}
          onMoveTerminalToGroup={terminal.moveTerminalToNewGroup}
          onActiveTerminalChange={terminal.activateTerminal}
          onCloseTerminal={terminal.closeTerminal}
          onCloseTerminalGroup={terminal.closeTerminalGroup}
          onHeightChange={terminal.setTerminalHeight}
          onResizeTerminalSplit={terminal.resizeTerminalSplit}
          onTerminalMetadataChange={terminal.setTerminalMetadata}
          onTerminalActivityChange={terminal.setTerminalActivity}
          onAddTerminalContext={() => {}}
        />
      </div>
    </MainSurface>
  );
}

export default TerminalSessionView;
