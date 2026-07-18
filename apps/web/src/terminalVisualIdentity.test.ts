// FILE: terminalVisualIdentity.test.ts
// Purpose: Verifies shared terminal visual identity rules used by chrome and recent views.
// Layer: UI state logic test

import { describe, expect, it } from "vitest";

import {
  resolveTerminalVisualIdentityMap,
  resolveTerminalVisualState,
  selectRepresentativeTerminalVisualIdentity,
  selectThreadTerminalVisualIdentities,
  selectThreadTerminalVisualIdentity,
} from "./terminalVisualIdentity";

describe("terminal visual identity", () => {
  it("resolves terminal icon, title, and activity state from shared metadata", () => {
    const identities = resolveTerminalVisualIdentityMap({
      terminalIds: ["terminal-1", "terminal-2"],
      runningTerminalIds: [" terminal-1 "],
      terminalAttentionStatesById: { "terminal-1": "running", "terminal-2": "attention" },
      terminalCliKindsById: { "terminal-1": "codex" },
      terminalLabelsById: { "terminal-1": "Codex 1", "terminal-2": "bun dev" },
      terminalTitleOverridesById: { "terminal-2": "Dev server" },
    });

    expect(identities.get("terminal-1")).toMatchObject({
      cliKind: "codex",
      iconKey: "openai",
      state: "running",
      title: "Codex 1",
    });
    expect(identities.get("terminal-2")).toMatchObject({
      cliKind: null,
      iconKey: "terminal",
      state: "attention",
      title: "Dev server",
    });
  });

  it("does not infer provider icons from stale provider-looking labels", () => {
    const identities = resolveTerminalVisualIdentityMap({
      terminalIds: ["terminal-1"],
      runningTerminalIds: [],
      terminalAttentionStatesById: {},
      terminalCliKindsById: {},
      terminalLabelsById: { "terminal-1": "Codex 1" },
      terminalTitleOverridesById: {},
    });

    expect(identities.get("terminal-1")).toMatchObject({
      cliKind: null,
      iconKey: "terminal",
      title: "Codex 1",
    });
  });

  it("selects the highest-priority terminal identity while preserving active-tab ties", () => {
    const identities = resolveTerminalVisualIdentityMap({
      terminalIds: ["terminal-1", "terminal-2"],
      runningTerminalIds: ["terminal-1"],
      terminalAttentionStatesById: { "terminal-1": "running", "terminal-2": "attention" },
      terminalCliKindsById: { "terminal-1": "codex" },
      terminalLabelsById: { "terminal-1": "Codex 1", "terminal-2": "bun dev" },
      terminalTitleOverridesById: {},
    });

    expect(
      selectRepresentativeTerminalVisualIdentity({
        activeTerminalId: "terminal-1",
        terminalIds: ["terminal-1", "terminal-2"],
        terminalVisualIdentityById: identities,
      }),
    ).toMatchObject({
      terminalId: "terminal-2",
      identity: { iconKey: "terminal", state: "attention" },
    });

    const idleIdentities = resolveTerminalVisualIdentityMap({
      terminalIds: ["terminal-1", "terminal-2"],
      runningTerminalIds: [],
      terminalAttentionStatesById: {},
      terminalCliKindsById: { "terminal-1": "codex" },
      terminalLabelsById: { "terminal-1": "Codex 1", "terminal-2": "bun dev" },
      terminalTitleOverridesById: {},
    });

    expect(
      selectRepresentativeTerminalVisualIdentity({
        activeTerminalId: "terminal-1",
        terminalIds: ["terminal-1", "terminal-2"],
        terminalVisualIdentityById: idleIdentities,
      }),
    ).toMatchObject({
      terminalId: "terminal-1",
      identity: { iconKey: "openai", state: "idle" },
    });
  });

  it("keeps attention ahead of running when resolving a single terminal state", () => {
    expect(
      resolveTerminalVisualState({
        runningTerminalIds: ["terminal-1"],
        terminalAttentionStatesById: { "terminal-1": "attention" },
        terminalId: "terminal-1",
      }),
    ).toBe("attention");
  });

  it("does not show agent-working state from subprocess activity alone", () => {
    expect(
      resolveTerminalVisualState({
        runningTerminalIds: ["terminal-1"],
        terminalAttentionStatesById: {},
        terminalId: "terminal-1",
      }),
    ).toBe("idle");
  });

  it("uses a detected terminal agent as the thread identity", () => {
    expect(
      selectThreadTerminalVisualIdentity({
        activeTerminalId: "terminal-1",
        entryPoint: "chat",
        runningTerminalIds: [],
        terminalAttentionStatesById: {},
        terminalCliKindsById: { "terminal-1": "claude" },
        terminalIds: ["terminal-1"],
        terminalLabelsById: { "terminal-1": "Claude" },
        terminalTitleOverridesById: {},
      }),
    ).toMatchObject({
      terminalId: "terminal-1",
      identity: { cliKind: "claude", iconKey: "claude" },
    });
  });

  it("uses a generic terminal identity for terminal-first threads without an agent", () => {
    expect(
      selectThreadTerminalVisualIdentity({
        activeTerminalId: "terminal-1",
        entryPoint: "terminal",
        runningTerminalIds: [],
        terminalAttentionStatesById: {},
        terminalCliKindsById: {},
        terminalIds: ["terminal-1"],
        terminalLabelsById: {},
        terminalTitleOverridesById: {},
      }),
    ).toMatchObject({
      terminalId: "terminal-1",
      identity: { cliKind: null, iconKey: "terminal" },
    });
  });

  it("keeps chat-first threads on their provider identity without a detected agent", () => {
    expect(
      selectThreadTerminalVisualIdentity({
        activeTerminalId: "terminal-1",
        entryPoint: "chat",
        runningTerminalIds: [],
        terminalAttentionStatesById: {},
        terminalCliKindsById: {},
        terminalIds: ["terminal-1"],
        terminalLabelsById: {},
        terminalTitleOverridesById: {},
      }),
    ).toBeNull();
  });

  it("returns one stacked identity for every distinct detected terminal agent", () => {
    expect(
      selectThreadTerminalVisualIdentities({
        activeTerminalId: "terminal-cursor",
        entryPoint: "terminal",
        runningTerminalIds: [],
        terminalAttentionStatesById: {},
        terminalAgentKindsById: {
          "terminal-codex": "codex",
          "terminal-claude": "claude",
          "terminal-kiro": "kiro",
          "terminal-cursor": "cursor",
          "terminal-codex-2": "codex",
        },
        terminalCliKindsById: {
          "terminal-codex": "codex",
          "terminal-claude": "claude",
          "terminal-codex-2": "codex",
        },
        terminalIds: [
          "terminal-codex",
          "terminal-claude",
          "terminal-kiro",
          "terminal-cursor",
          "terminal-codex-2",
        ],
        terminalLabelsById: {},
        terminalTitleOverridesById: {},
      }).map(({ identity }) => identity.iconKey),
    ).toEqual(["cursor", "openai", "claude", "kiro"]);
  });
});
