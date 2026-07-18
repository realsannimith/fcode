// FILE: sidebarTerminalIconStack.ts
// Purpose: Keeps the compact sidebar agent stack stable as terminal and agent counts grow.
// Layer: UI view-model

import type { TerminalIconKey } from "@t3tools/shared/terminalThreads";

const MAX_SIDEBAR_AGENT_CHIPS = 4;
const SIDEBAR_AGENT_CHIP_SIZE_PX = 12;
const SIDEBAR_AGENT_CHIP_STEP_PX = 8;

export interface SidebarTerminalIconStack {
  overflowCount: number;
  visibleIconKeys: readonly TerminalIconKey[];
}

export type SidebarTerminalIconStackChip =
  | {
      iconKey: TerminalIconKey;
      kind: "icon";
      leftPx: number;
      zIndex: number;
    }
  | {
      kind: "overflow";
      leftPx: number;
      overflowCount: number;
      zIndex: number;
    };

export interface SidebarTerminalIconStackLayout {
  chips: readonly SidebarTerminalIconStackChip[];
  widthPx: number;
}

export function resolveSidebarTerminalIconStack(
  iconKeys: readonly TerminalIconKey[],
): SidebarTerminalIconStack {
  if (iconKeys.length <= MAX_SIDEBAR_AGENT_CHIPS) {
    return { overflowCount: 0, visibleIconKeys: iconKeys };
  }

  // Reserve the final chip for "+N" so the stack never unexpectedly grows wider
  // than four chips and covers the task title.
  const visibleIconKeys = iconKeys.slice(0, MAX_SIDEBAR_AGENT_CHIPS - 1);
  return {
    overflowCount: iconKeys.length - visibleIconKeys.length,
    visibleIconKeys,
  };
}

export function resolveSidebarTerminalIconStackLayout(
  iconKeys: readonly TerminalIconKey[],
): SidebarTerminalIconStackLayout {
  const stack = resolveSidebarTerminalIconStack(iconKeys);
  const chips: SidebarTerminalIconStackChip[] = stack.visibleIconKeys.map((iconKey, index) => ({
    iconKey,
    kind: "icon",
    leftPx: index * SIDEBAR_AGENT_CHIP_STEP_PX,
    zIndex: index + 1,
  }));

  if (stack.overflowCount > 0) {
    const index = chips.length;
    chips.push({
      kind: "overflow",
      leftPx: index * SIDEBAR_AGENT_CHIP_STEP_PX,
      overflowCount: stack.overflowCount,
      zIndex: index + 1,
    });
  }

  return {
    chips,
    widthPx:
      chips.length === 0
        ? 0
        : SIDEBAR_AGENT_CHIP_SIZE_PX + SIDEBAR_AGENT_CHIP_STEP_PX * (chips.length - 1),
  };
}

export function shouldShowHandoffInSidebarAvatar(input: {
  hasHandoff: boolean;
  hasTerminalIcons: boolean;
  isAvatarVisible: boolean;
}): boolean {
  // A detected terminal identity is the primary visual identity for this row.
  // Keep handoff metadata in its normal meta chip instead of replacing the agent stack.
  return input.isAvatarVisible && input.hasHandoff && !input.hasTerminalIcons;
}

export function shouldShowStandaloneTerminalBadge(input: {
  hasAgentIcons: boolean;
  hasTerminalStatus: boolean;
  terminalCount: number;
}): boolean {
  // The old terminal badge sits on top of the avatar. On an agent stack it can
  // completely cover the final agent and make the row look like it reverted to
  // the generic terminal icon. The stack itself is the terminal indicator.
  return !input.hasAgentIcons && (input.terminalCount > 1 || input.hasTerminalStatus);
}
