// FILE: projectTerminalRunner.ts
// Purpose: Shared helper for launching project commands in managed terminal sessions.
// Layer: Web terminal orchestration helper
// Exports: runProjectCommandInTerminal.

import type { NativeApi, TerminalSessionSnapshot, ThreadId } from "@t3tools/contracts";
import {
  deriveTerminalCommandIdentity,
  type TerminalCodingAgentKind,
  type TerminalCliKind,
} from "@t3tools/shared/terminalThreads";

import { projectScriptRuntimeEnv } from "./projectScripts";

export interface ProjectCommandTerminalMetadata {
  agentKind: TerminalCodingAgentKind | null;
  cliKind: TerminalCliKind | null;
  label: string;
}

export async function runProjectCommandInTerminal(input: {
  api: NativeApi;
  threadId: ThreadId;
  terminalId: string;
  project: { cwd: string };
  cwd: string;
  command: string;
  worktreePath?: string | null;
  env?: Record<string, string>;
}): Promise<{
  snapshot: TerminalSessionSnapshot;
  metadata: ProjectCommandTerminalMetadata | null;
}> {
  const runtimeEnv = projectScriptRuntimeEnv({
    project: {
      cwd: input.project.cwd,
    },
    worktreePath: input.worktreePath ?? null,
    ...(input.env ? { extraEnv: input.env } : {}),
  });
  const terminalCommandIdentity = deriveTerminalCommandIdentity(input.command);
  // Intentionally omit cols/rows: the server reuses the live PTY's current size when a
  // terminal is already open (the frontend xterm fits it to its real pane width). Forcing a
  // fixed size here would resize an already-fitted PTY right before the command runs, so an
  // agent TUI (e.g. Claude Code) boots at the wrong width and then garbles when it snaps back.
  // A first/headless open with no size still falls back to the server's default dimensions.
  const snapshot = await input.api.terminal.open({
    threadId: input.threadId,
    terminalId: input.terminalId,
    cwd: input.cwd,
    env: runtimeEnv,
  });
  await input.api.terminal.write({
    threadId: input.threadId,
    terminalId: input.terminalId,
    data: `${input.command}\r`,
  });

  return {
    snapshot,
    metadata: terminalCommandIdentity
      ? {
          agentKind: terminalCommandIdentity.agentKind,
          cliKind: terminalCommandIdentity.cliKind,
          label: terminalCommandIdentity.title,
        }
      : null,
  };
}
