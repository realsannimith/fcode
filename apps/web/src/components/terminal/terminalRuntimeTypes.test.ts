// FILE: terminalRuntimeTypes.test.ts
// Purpose: Cover stable runtime identity helpers without pulling browser-only runtime modules.
// Layer: Terminal runtime tests

import type { TerminalCodingAgentKind, TerminalCliKind } from "@t3tools/shared/terminalThreads";
import { describe, expect, it } from "vitest";

import { selectThreadTerminalVisualIdentities } from "../../terminalVisualIdentity";
import {
  buildTerminalRuntimeKey,
  resolveTerminalRuntimeActivityMetadata,
  type TerminalRuntimeActivityIdentity,
} from "./terminalRuntimeTypes";

describe("terminal runtime identity", () => {
  it("builds a thread-scoped runtime key for terminal persistence", () => {
    expect(buildTerminalRuntimeKey("thread-123", "terminal-abc")).toBe("thread-123::terminal-abc");
  });

  it("keeps the first Claude icon after Codex, Kiro, and Cursor launch", () => {
    const terminalIds = ["terminal-claude", "terminal-codex", "terminal-kiro", "terminal-cursor"];
    const identitiesByTerminalId: Record<string, TerminalRuntimeActivityIdentity> = {
      "terminal-claude": { agentKind: "claude", cliKind: "claude" },
      "terminal-codex": { agentKind: "codex", cliKind: "codex" },
      "terminal-kiro": { agentKind: "kiro", cliKind: null },
      "terminal-cursor": { agentKind: "cursor", cliKind: null },
    };

    // Claude's Stop/idle activity arrives after the later tabs launch. It must not be
    // interpreted as "this terminal no longer belongs to Claude".
    const claudeIdleMetadata = resolveTerminalRuntimeActivityMetadata({
      current: identitiesByTerminalId["terminal-claude"]!,
      event: { agentKind: null, cliKind: null },
    });
    expect(claudeIdleMetadata).toBeNull();

    const terminalAgentKindsById = Object.fromEntries(
      terminalIds.map((terminalId) => [terminalId, identitiesByTerminalId[terminalId]!.agentKind]),
    ) as Record<string, TerminalCodingAgentKind>;
    const terminalCliKindsById = Object.fromEntries(
      terminalIds.flatMap((terminalId) => {
        const cliKind = identitiesByTerminalId[terminalId]!.cliKind;
        return cliKind ? [[terminalId, cliKind] as const] : [];
      }),
    ) as Record<string, TerminalCliKind>;

    expect(
      selectThreadTerminalVisualIdentities({
        activeTerminalId: "terminal-cursor",
        entryPoint: "terminal",
        runningTerminalIds: [],
        terminalAttentionStatesById: {},
        terminalAgentKindsById,
        terminalCliKindsById,
        terminalIds,
        terminalLabelsById: {},
        terminalTitleOverridesById: {},
      }).map(({ identity }) => identity.iconKey),
    ).toEqual(["cursor", "claude", "openai", "kiro"]);
  });
});
