// FILE: sidebarTerminalIconStack.test.ts
// Purpose: Verifies compact agent stacks never fall back or expand over the task row.
// Layer: UI view-model test

import { describe, expect, it } from "vitest";

import {
  resolveSidebarTerminalIconStack,
  resolveSidebarTerminalIconStackLayout,
  shouldShowHandoffInSidebarAvatar,
  shouldShowStandaloneTerminalBadge,
} from "./sidebarTerminalIconStack";

describe("sidebar terminal icon stack", () => {
  it("keeps up to four detected agent icons visible", () => {
    expect(resolveSidebarTerminalIconStack(["openai", "claude", "kiro", "cursor"])).toEqual({
      overflowCount: 0,
      visibleIconKeys: ["openai", "claude", "kiro", "cursor"],
    });
  });

  it("uses the fourth chip for overflow instead of reverting to a terminal icon", () => {
    expect(
      resolveSidebarTerminalIconStack(["openai", "claude", "kiro", "cursor", "agent"]),
    ).toEqual({
      overflowCount: 2,
      visibleIconKeys: ["openai", "claude", "kiro"],
    });
  });

  it("positions every chip with explicit overlap, layering, and total width", () => {
    expect(resolveSidebarTerminalIconStackLayout(["openai", "claude", "kiro"])).toEqual({
      chips: [
        { iconKey: "openai", kind: "icon", leftPx: 0, zIndex: 1 },
        { iconKey: "claude", kind: "icon", leftPx: 8, zIndex: 2 },
        { iconKey: "kiro", kind: "icon", leftPx: 16, zIndex: 3 },
      ],
      widthPx: 28,
    });

    expect(
      resolveSidebarTerminalIconStackLayout(["openai", "claude", "kiro", "cursor", "agent"]),
    ).toEqual({
      chips: [
        { iconKey: "openai", kind: "icon", leftPx: 0, zIndex: 1 },
        { iconKey: "claude", kind: "icon", leftPx: 8, zIndex: 2 },
        { iconKey: "kiro", kind: "icon", leftPx: 16, zIndex: 3 },
        { kind: "overflow", leftPx: 24, overflowCount: 2, zIndex: 4 },
      ],
      widthPx: 36,
    });
  });

  it("keeps a handoff in the avatar only when no terminal identity replaces it", () => {
    expect(
      shouldShowHandoffInSidebarAvatar({
        hasHandoff: true,
        hasTerminalIcons: false,
        isAvatarVisible: true,
      }),
    ).toBe(true);
    expect(
      shouldShowHandoffInSidebarAvatar({
        hasHandoff: true,
        hasTerminalIcons: true,
        isAvatarVisible: true,
      }),
    ).toBe(false);
  });

  it("does not place the generic terminal badge over detected agent icons", () => {
    expect(
      shouldShowStandaloneTerminalBadge({
        hasAgentIcons: true,
        hasTerminalStatus: true,
        terminalCount: 5,
      }),
    ).toBe(false);

    expect(
      shouldShowStandaloneTerminalBadge({
        hasAgentIcons: false,
        hasTerminalStatus: true,
        terminalCount: 1,
      }),
    ).toBe(true);
  });
});
