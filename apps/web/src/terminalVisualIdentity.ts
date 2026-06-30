// FILE: terminalVisualIdentity.ts
// Purpose: Centralizes terminal icon/title/activity view-model rules for every web surface.
// Layer: UI state logic
// Exports: terminal identity map resolution plus representative-terminal selection.

import {
  type ResolvedTerminalVisualIdentity,
  resolveTerminalVisualIdentity,
  type TerminalActivityState,
  type TerminalCliKind,
  type TerminalVisualState,
} from "@t3tools/shared/terminalThreads";

export interface RepresentativeTerminalVisualIdentity {
  terminalId: string;
  identity: ResolvedTerminalVisualIdentity;
}

function terminalVisualStatePriority(state: TerminalVisualState): number {
  switch (state) {
    case "attention":
      return 4;
    case "running":
      return 3;
    case "review":
      return 2;
    case "idle":
      return 1;
  }
}

// Aggregate every terminal in one thread/session into a single visual state for compact
// surfaces (sidebar session rows, project headers, tabs). Priority follows
// terminalVisualStatePriority: attention > running > review > idle. "running" covers both an
// agent reporting itself busy (agentState) and a live subprocess (runningTerminalIds).
export function resolveThreadTerminalVisualState(input: {
  runningTerminalIds: readonly string[];
  terminalAttentionStatesById: Record<string, TerminalActivityState>;
}): TerminalVisualState {
  const attentionStates = Object.values(input.terminalAttentionStatesById ?? {});
  if (attentionStates.includes("attention")) return "attention";
  if (attentionStates.includes("running") || input.runningTerminalIds.length > 0) return "running";
  if (attentionStates.includes("review")) return "review";
  return "idle";
}

// Collapse several visual states into the most important one (e.g. every session under a
// collapsed project). Returns "idle" when the input is empty.
export function mergeTerminalVisualStates(
  states: Iterable<TerminalVisualState>,
): TerminalVisualState {
  let best: TerminalVisualState = "idle";
  for (const state of states) {
    if (terminalVisualStatePriority(state) > terminalVisualStatePriority(best)) {
      best = state;
    }
  }
  return best;
}

export function resolveTerminalVisualState(input: {
  runningTerminalIds: readonly string[];
  terminalAttentionStatesById: Record<string, TerminalActivityState>;
  terminalId: string;
}): TerminalVisualState {
  return resolveTerminalVisualStateFromSet({
    terminalAttentionStatesById: input.terminalAttentionStatesById,
    terminalId: input.terminalId,
  });
}

function resolveTerminalVisualStateFromSet(input: {
  terminalAttentionStatesById: Record<string, TerminalActivityState>;
  terminalId: string;
}): TerminalVisualState {
  const agentState = input.terminalAttentionStatesById[input.terminalId] ?? null;
  if (agentState !== null) {
    return agentState;
  }
  return "idle";
}

export function resolveTerminalVisualIdentityMap(input: {
  runningTerminalIds: readonly string[];
  terminalAttentionStatesById: Record<string, TerminalActivityState>;
  terminalCliKindsById: Record<string, TerminalCliKind>;
  terminalIds: readonly string[];
  terminalLabelsById: Record<string, string>;
  terminalTitleOverridesById: Record<string, string>;
}): ReadonlyMap<string, ResolvedTerminalVisualIdentity> {
  return new Map(
    input.terminalIds.map((terminalId, index) => [
      terminalId,
      resolveTerminalVisualIdentity({
        cliKind: input.terminalCliKindsById[terminalId] ?? null,
        fallbackTitle: `Terminal ${index + 1}`,
        state: resolveTerminalVisualStateFromSet({
          terminalAttentionStatesById: input.terminalAttentionStatesById,
          terminalId,
        }),
        title: input.terminalTitleOverridesById[terminalId] ?? input.terminalLabelsById[terminalId],
      }),
    ]),
  );
}

// Picks the terminal identity to represent a multi-terminal group or thread.
export function selectRepresentativeTerminalVisualIdentity(input: {
  activeTerminalId?: string | null | undefined;
  terminalIds: readonly string[];
  terminalVisualIdentityById: ReadonlyMap<string, ResolvedTerminalVisualIdentity>;
}): RepresentativeTerminalVisualIdentity | null {
  const fallbackTerminalId =
    input.activeTerminalId && input.terminalIds.includes(input.activeTerminalId)
      ? input.activeTerminalId
      : (input.terminalIds[0] ?? null);
  if (!fallbackTerminalId) {
    return null;
  }

  let representativeTerminalId = fallbackTerminalId;
  for (const terminalId of input.terminalIds) {
    const currentPriority = terminalVisualStatePriority(
      input.terminalVisualIdentityById.get(representativeTerminalId)?.state ?? "idle",
    );
    const nextPriority = terminalVisualStatePriority(
      input.terminalVisualIdentityById.get(terminalId)?.state ?? "idle",
    );
    if (nextPriority > currentPriority) {
      representativeTerminalId = terminalId;
    }
  }

  const identity = input.terminalVisualIdentityById.get(representativeTerminalId);
  return identity ? { terminalId: representativeTerminalId, identity } : null;
}
