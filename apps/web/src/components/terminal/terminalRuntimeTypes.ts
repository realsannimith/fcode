// FILE: terminalRuntimeTypes.ts
// Purpose: Shared types and stable identity helpers for persistent terminal runtimes.
// Layer: Terminal runtime infrastructure

import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import {
  defaultTerminalTitleForCodingAgentKind,
  type TerminalActivityState,
  type TerminalCodingAgentKind,
  type TerminalCliKind,
} from "@t3tools/shared/terminalThreads";
import { Terminal, type IDisposable } from "@xterm/xterm";
import type { TerminalLinkMatch } from "../../terminal-links";

export interface TerminalRuntimeCallbacks {
  onSessionExited: () => void;
  onTerminalMetadataChange: (
    terminalId: string,
    metadata: {
      agentKind?: TerminalCodingAgentKind | null;
      cliKind: TerminalCliKind | null;
      label: string;
    },
  ) => void;
  onTerminalActivityChange: (
    terminalId: string,
    activity: { hasRunningSubprocess: boolean; agentState: TerminalActivityState | null },
  ) => void;
  onTerminalRuntimeStatusChange?: (terminalId: string, status: TerminalRuntimeStatus) => void;
}

export function buildTerminalRuntimeKey(threadId: string, terminalId: string): string {
  return `${threadId}::${terminalId}`;
}

export interface TerminalRuntimeActivityIdentity {
  agentKind: TerminalCodingAgentKind | null;
  cliKind: TerminalCliKind | null;
}

export interface TerminalRuntimeMetadataIdentity extends TerminalRuntimeActivityIdentity {
  label: string;
}

export function resolveTerminalRuntimeActivityMetadata(input: {
  current: TerminalRuntimeActivityIdentity;
  event: {
    agentKind?: TerminalCodingAgentKind | null;
    cliKind: TerminalCliKind | null;
  };
}): TerminalRuntimeMetadataIdentity | null {
  const eventAgentKind = input.event.agentKind ?? input.event.cliKind;
  // Activity events deliberately use null identity when an agent is idle or emits a Stop hook.
  // Branding is terminal history, not live activity, so only a concrete detected agent may
  // replace it. This also keeps older tabs represented when newer agent tabs become active.
  if (eventAgentKind === null) return null;
  if (input.current.agentKind === eventAgentKind && input.current.cliKind === input.event.cliKind) {
    return null;
  }
  return {
    agentKind: eventAgentKind,
    cliKind: input.event.cliKind,
    label: defaultTerminalTitleForCodingAgentKind(eventAgentKind),
  };
}

export interface TerminalRuntimeConfig {
  runtimeKey: string;
  threadId: string;
  terminalId: string;
  terminalLabel: string;
  terminalAgentKind?: TerminalCodingAgentKind | null;
  terminalCliKind?: TerminalCliKind | null;
  cwd: string;
  runtimeEnv?: Record<string, string>;
  callbacks: TerminalRuntimeCallbacks;
}

export interface TerminalRuntimeViewState {
  autoFocus: boolean;
  isVisible: boolean;
}

export interface TerminalPendingWrite {
  data: string;
  byteLength: number;
  queuedAt: number;
}

export type TerminalRuntimeStatus = "connecting" | "replaying" | "ready" | "error";

export interface TerminalRuntimeEntry {
  runtimeKey: string;
  threadId: string;
  terminalId: string;
  terminalLabel: string;
  terminalAgentKind: TerminalCodingAgentKind | null;
  terminalCliKind: TerminalCliKind | null;
  cwd: string;
  runtimeEnv?: Record<string, string>;
  callbacks: TerminalRuntimeCallbacks;
  wrapper: HTMLDivElement;
  container: HTMLDivElement | null;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  titleInputBuffer: string;
  hasHandledExit: boolean;
  runtimeStatus: TerminalRuntimeStatus;
  opened: boolean;
  // Pending retry of openTerminal when the native API wasn't ready at attach time.
  openRetryTimer: number | null;
  // Last system message written into the terminal plus its timestamp, used to
  // collapse repeated identical failures (e.g. every keystroke against a lost
  // session) into a single line instead of flooding the scrollback.
  lastSystemMessage: string | null;
  lastSystemMessageAt: number;
  // Wall-clock of the last automatic re-open triggered by a lost-session write
  // failure, so self-healing stays throttled.
  lastLostSessionRecoveryAt: number;
  // GPU renderer, kept warm across visibility changes up to a global context
  // budget so tab switches reuse the initialized renderer. Browsers cap live
  // WebGL contexts (~16); least-recently-visible hidden panes are reclaimed
  // under budget pressure rather than silently downgrading to the DOM renderer.
  webglAddon: IDisposable | null;
  // Pending retry after a WebGL context loss (usually transient eviction).
  webglRetryTimer: number | null;
  // Recency stamp for the context-budget LRU (updated on show and hide).
  lastVisibleAt: number;
  disposed: boolean;
  resizeObserver: ResizeObserver | null;
  resizeDispatchTimer: number | null;
  visualResizeFrame: number | null;
  visualResizeTimer: number | null;
  lastVisualResizeAt: number;
  lastSentResize: { cols: number; rows: number } | null;
  pendingResize: { cols: number; rows: number } | null;
  writeRafHandle: number | null;
  writeFlushTimeout: number | null;
  pendingWrites: TerminalPendingWrite[];
  pendingWriteLength: number;
  pendingWriteBytes: number;
  linkMatchCache: Map<string, TerminalLinkMatch[]>;
  outputEventVersion: number;
  snapshotReconcileRequestId: number;
  themeRefreshFrame: number;
  themeObserver: MutationObserver | null;
  visibilityCleanup: (() => void) | null;
  terminalDisposables: IDisposable[];
  attachDisposables: Array<() => void>;
  persistentDisposables: Array<() => void>;
  querySuppressionDispose: (() => void) | null;
  viewState: TerminalRuntimeViewState;
  unsubscribeTerminalEvents: (() => void) | null;
}
