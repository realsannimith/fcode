import { ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

// The store persists through window.localStorage, which the node test runtime
// does not provide; back it with an in-memory Map before the store module loads.
if (globalThis.localStorage === undefined) {
  const backing = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (name: string) => backing.get(name) ?? null,
    setItem: (name: string, value: string) => void backing.set(name, value),
    removeItem: (name: string) => void backing.delete(name),
    clear: () => backing.clear(),
    key: (index: number) => [...backing.keys()][index] ?? null,
    get length() {
      return backing.size;
    },
  } as Storage;
}

const { collectTerminalIdsFromLayout } = await import("./terminalPaneLayout");
const {
  sanitizePersistedTerminalStateByThreadId,
  selectThreadTerminalState,
  useTerminalStateStore,
} = await import("./terminalStateStore");

const THREAD_ID = ThreadId.makeUnsafe("thread-1");

function summarizeTerminalGroups(
  terminalGroups: ReturnType<typeof selectThreadTerminalState>["terminalGroups"],
) {
  return terminalGroups.map((group) => ({
    id: group.id,
    activeTerminalId: group.activeTerminalId,
    terminalIds: collectTerminalIdsFromLayout(group.layout),
  }));
}

describe("terminalStateStore actions", () => {
  beforeEach(() => {
    useTerminalStateStore.setState({ terminalStateByThreadId: {} });
  });

  it("returns a closed default terminal state for unknown threads", () => {
    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState).toMatchObject({
      entryPoint: "chat",
      terminalOpen: false,
      presentationMode: "drawer",
      workspaceLayout: "both",
      workspaceActiveTab: "terminal",
      terminalHeight: 280,
      terminalIds: ["default"],
      terminalLabelsById: { default: "Terminal 1" },
      terminalTitleOverridesById: {},
      terminalCliKindsById: {},
      terminalAttentionStatesById: {},
      runningTerminalIds: [],
      activeTerminalId: "default",
      activeTerminalGroupId: "group-default",
    });
    expect(summarizeTerminalGroups(terminalState.terminalGroups)).toEqual([
      {
        id: "group-default",
        activeTerminalId: "default",
        terminalIds: ["default"],
      },
    ]);
  });

  it("seeds server-declared terminal threads that have no local state", () => {
    const store = useTerminalStateStore.getState();
    store.seedTerminalEntryPoints([THREAD_ID]);

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.entryPoint).toBe("terminal");
    // Seeding restores identity only; the terminal UI opens on activation.
    expect(terminalState.terminalOpen).toBe(false);
  });

  it("keeps seeded entry points across persistence sanitization", () => {
    useTerminalStateStore.getState().seedTerminalEntryPoints([THREAD_ID]);

    const sanitized = sanitizePersistedTerminalStateByThreadId(
      useTerminalStateStore.getState().terminalStateByThreadId,
    );

    expect(sanitized[THREAD_ID]?.entryPoint).toBe("terminal");
  });

  it("does not overwrite a thread the user explicitly switched to the chat surface", () => {
    const store = useTerminalStateStore.getState();
    store.openTerminalThreadPage(THREAD_ID, { terminalOnly: true });
    store.openChatThreadPage(THREAD_ID);

    store.seedTerminalEntryPoints([THREAD_ID]);

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.entryPoint).toBe("chat");
  });

  it("marks chat-first threads without forcing open terminal UI", () => {
    const store = useTerminalStateStore.getState();
    store.openTerminalThreadPage(THREAD_ID, { terminalOnly: true });
    store.openChatThreadPage(THREAD_ID);

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.entryPoint).toBe("chat");
    expect(terminalState.workspaceLayout).toBe("both");
    expect(terminalState.workspaceActiveTab).toBe("chat");
  });

  it("opens terminal-first threads in the workspace terminal tab", () => {
    const store = useTerminalStateStore.getState();
    store.openTerminalThreadPage(THREAD_ID, { terminalOnly: true });

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.entryPoint).toBe("terminal");
    expect(terminalState.terminalOpen).toBe(true);
    expect(terminalState.presentationMode).toBe("workspace");
    expect(terminalState.workspaceLayout).toBe("terminal-only");
    expect(terminalState.workspaceActiveTab).toBe("terminal");
  });

  it("opens and splits terminals into the active group", () => {
    const store = useTerminalStateStore.getState();
    store.setTerminalOpen(THREAD_ID, true);
    store.splitTerminal(THREAD_ID, "terminal-2");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.terminalOpen).toBe(true);
    expect(terminalState.terminalIds).toEqual(["default", "terminal-2"]);
    expect(terminalState.activeTerminalId).toBe("terminal-2");
    expect(summarizeTerminalGroups(terminalState.terminalGroups)).toEqual([
      {
        id: "group-default",
        activeTerminalId: "terminal-2",
        terminalIds: ["default", "terminal-2"],
      },
    ]);
  });

  it("restores the last-used presentation mode when reopened", () => {
    const store = useTerminalStateStore.getState();
    store.setTerminalPresentationMode(THREAD_ID, "workspace");
    store.setTerminalOpen(THREAD_ID, false);
    store.setTerminalOpen(THREAD_ID, true);

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.terminalOpen).toBe(true);
    expect(terminalState.presentationMode).toBe("workspace");
  });

  it("enters workspace mode on the terminal tab by default", () => {
    const store = useTerminalStateStore.getState();
    store.setTerminalPresentationMode(THREAD_ID, "workspace");
    store.setTerminalWorkspaceTab(THREAD_ID, "chat");
    store.setTerminalPresentationMode(THREAD_ID, "drawer");
    store.setTerminalPresentationMode(THREAD_ID, "workspace");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.presentationMode).toBe("workspace");
    expect(terminalState.workspaceActiveTab).toBe("terminal");
  });

  it("opens a new full-width terminal in terminal-only workspace mode", () => {
    const store = useTerminalStateStore.getState();
    store.openNewFullWidthTerminal(THREAD_ID, "terminal-2");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.terminalOpen).toBe(true);
    expect(terminalState.presentationMode).toBe("workspace");
    expect(terminalState.workspaceLayout).toBe("terminal-only");
    expect(terminalState.workspaceActiveTab).toBe("terminal");
    expect(terminalState.activeTerminalId).toBe("terminal-2");
    expect(terminalState.terminalIds).toEqual(["default", "terminal-2"]);
  });

  it("restores chat when selecting the chat workspace tab from terminal-only mode", () => {
    const store = useTerminalStateStore.getState();
    store.openNewFullWidthTerminal(THREAD_ID, "terminal-2");
    store.setTerminalWorkspaceTab(THREAD_ID, "chat");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.entryPoint).toBe("chat");
    expect(terminalState.workspaceLayout).toBe("both");
    expect(terminalState.workspaceActiveTab).toBe("chat");
  });

  it("closes workspace chat into terminal-only mode without closing terminals", () => {
    const store = useTerminalStateStore.getState();
    store.setTerminalPresentationMode(THREAD_ID, "workspace");
    store.setTerminalWorkspaceTab(THREAD_ID, "chat");
    store.closeWorkspaceChat(THREAD_ID);

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.terminalOpen).toBe(true);
    expect(terminalState.presentationMode).toBe("workspace");
    expect(terminalState.entryPoint).toBe("terminal");
    expect(terminalState.workspaceLayout).toBe("terminal-only");
    expect(terminalState.workspaceActiveTab).toBe("terminal");
    expect(terminalState.terminalIds).toEqual(["default"]);
  });

  it("preserves terminal-only workspace layout when collapsing to drawer and reopening", () => {
    const store = useTerminalStateStore.getState();
    store.openNewFullWidthTerminal(THREAD_ID, "terminal-2");
    store.setTerminalPresentationMode(THREAD_ID, "drawer");
    store.setTerminalPresentationMode(THREAD_ID, "workspace");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.presentationMode).toBe("workspace");
    expect(terminalState.workspaceLayout).toBe("terminal-only");
    expect(terminalState.workspaceActiveTab).toBe("terminal");
  });

  it("keeps split terminals in the same group up to the current group limit", () => {
    const store = useTerminalStateStore.getState();
    store.splitTerminal(THREAD_ID, "terminal-2");
    store.splitTerminal(THREAD_ID, "terminal-3");
    store.splitTerminal(THREAD_ID, "terminal-4");
    store.splitTerminal(THREAD_ID, "terminal-5");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.terminalIds).toEqual([
      "default",
      "terminal-2",
      "terminal-3",
      "terminal-4",
      "terminal-5",
    ]);
    expect(summarizeTerminalGroups(terminalState.terminalGroups)).toEqual([
      {
        id: "group-default",
        activeTerminalId: "terminal-5",
        terminalIds: ["default", "terminal-2", "terminal-3", "terminal-4", "terminal-5"],
      },
    ]);
  });

  it("creates new terminals in a separate group", () => {
    useTerminalStateStore.getState().newTerminal(THREAD_ID, "terminal-2");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.terminalIds).toEqual(["default", "terminal-2"]);
    expect(terminalState.activeTerminalId).toBe("terminal-2");
    expect(terminalState.activeTerminalGroupId).toBe("group-terminal-2");
    expect(summarizeTerminalGroups(terminalState.terminalGroups)).toEqual([
      { id: "group-default", activeTerminalId: "default", terminalIds: ["default"] },
      { id: "group-terminal-2", activeTerminalId: "terminal-2", terminalIds: ["terminal-2"] },
    ]);
  });

  it("reorders terminal group tabs and keeps the flat terminal order aligned", () => {
    const store = useTerminalStateStore.getState();
    store.newTerminal(THREAD_ID, "terminal-2");
    store.newTerminal(THREAD_ID, "terminal-3");

    // Drag the last group tab (group-terminal-3) onto the first (group-default),
    // so it lands at the front — the remove-then-insert model of the tab strip.
    store.moveTerminalGroup(THREAD_ID, "group-terminal-3", "group-default");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(summarizeTerminalGroups(terminalState.terminalGroups)).toEqual([
      { id: "group-terminal-3", activeTerminalId: "terminal-3", terminalIds: ["terminal-3"] },
      { id: "group-default", activeTerminalId: "default", terminalIds: ["default"] },
      { id: "group-terminal-2", activeTerminalId: "terminal-2", terminalIds: ["terminal-2"] },
    ]);
    expect(terminalState.terminalIds).toEqual(["terminal-3", "default", "terminal-2"]);
    // Reordering tabs must not change which terminal is active.
    expect(terminalState.activeTerminalId).toBe("terminal-3");
  });

  it("ignores a group reorder onto itself or an unknown group", () => {
    const store = useTerminalStateStore.getState();
    store.newTerminal(THREAD_ID, "terminal-2");

    const before = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    store.moveTerminalGroup(THREAD_ID, "group-terminal-2", "group-terminal-2");
    store.moveTerminalGroup(THREAD_ID, "group-terminal-2", "group-missing");

    const after = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(summarizeTerminalGroups(after.terminalGroups)).toEqual(
      summarizeTerminalGroups(before.terminalGroups),
    );
    expect(after.terminalIds).toEqual(before.terminalIds);
  });

  it("merges a dragged group into the active group as an edge split", () => {
    const store = useTerminalStateStore.getState();
    store.newTerminal(THREAD_ID, "terminal-2");

    // Drop group-terminal-2's tab on the right edge of group-default's viewport.
    store.mergeTerminalGroups(THREAD_ID, "group-terminal-2", "group-default", "right");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(summarizeTerminalGroups(terminalState.terminalGroups)).toEqual([
      {
        id: "group-default",
        activeTerminalId: "terminal-2",
        terminalIds: ["default", "terminal-2"],
      },
    ]);
    const layout = terminalState.terminalGroups[0]?.layout;
    expect(layout?.type).toBe("split");
    if (layout?.type === "split") {
      expect(layout.direction).toBe("horizontal");
      expect(collectTerminalIdsFromLayout(layout)).toEqual(["default", "terminal-2"]);
    }
    expect(terminalState.activeTerminalGroupId).toBe("group-default");
    expect(terminalState.activeTerminalId).toBe("terminal-2");
  });

  it("merges a dragged group into the target's pane tabs on a center drop", () => {
    const store = useTerminalStateStore.getState();
    store.newTerminal(THREAD_ID, "terminal-2");

    store.mergeTerminalGroups(THREAD_ID, "group-terminal-2", "group-default", "center");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(summarizeTerminalGroups(terminalState.terminalGroups)).toEqual([
      {
        id: "group-default",
        activeTerminalId: "terminal-2",
        terminalIds: ["default", "terminal-2"],
      },
    ]);
    // A center drop stacks the terminals as tabs in one pane, not a split.
    expect(terminalState.terminalGroups[0]?.layout.type).toBe("terminal");
  });

  it("moves a pane tab into another split pane on a center drop", () => {
    const store = useTerminalStateStore.getState();
    store.splitTerminal(THREAD_ID, "terminal-2");
    store.newTerminalTab(THREAD_ID, "default", "claude-1");

    // Drag claude-1 from the left pane onto the center of terminal-2's pane.
    store.moveTerminalToPane(THREAD_ID, "claude-1", "terminal-2", "center");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    const layout = terminalState.terminalGroups[0]?.layout;
    expect(layout?.type).toBe("split");
    if (layout?.type === "split") {
      expect(layout.children.map((child) => collectTerminalIdsFromLayout(child))).toEqual([
        ["default"],
        ["terminal-2", "claude-1"],
      ]);
    }
    expect(terminalState.activeTerminalId).toBe("claude-1");
  });

  it("splits another pane with a dragged pane tab on an edge drop", () => {
    const store = useTerminalStateStore.getState();
    store.splitTerminal(THREAD_ID, "terminal-2");
    store.newTerminalTab(THREAD_ID, "default", "claude-1");

    // Drag claude-1 onto the bottom edge of terminal-2's pane.
    store.moveTerminalToPane(THREAD_ID, "claude-1", "terminal-2", "bottom");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    const layout = terminalState.terminalGroups[0]?.layout;
    expect(layout?.type).toBe("split");
    if (layout?.type === "split") {
      expect(layout.direction).toBe("horizontal");
      expect(collectTerminalIdsFromLayout(layout.children[0]!)).toEqual(["default"]);
      const rightChild = layout.children[1];
      expect(rightChild?.type).toBe("split");
      if (rightChild?.type === "split") {
        expect(rightChild.direction).toBe("vertical");
        expect(rightChild.children.map((child) => collectTerminalIdsFromLayout(child))).toEqual([
          ["terminal-2"],
          ["claude-1"],
        ]);
      }
    }
    expect(terminalState.activeTerminalId).toBe("claude-1");
  });

  it("ignores a pane move onto itself or an unknown terminal", () => {
    const store = useTerminalStateStore.getState();
    store.splitTerminal(THREAD_ID, "terminal-2");

    const before = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    store.moveTerminalToPane(THREAD_ID, "terminal-2", "terminal-2", "right");
    store.moveTerminalToPane(THREAD_ID, "terminal-2", "terminal-missing", "right");

    const after = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(summarizeTerminalGroups(after.terminalGroups)).toEqual(
      summarizeTerminalGroups(before.terminalGroups),
    );
  });

  it("ignores a group merge onto itself, an unknown group, or past the group limit", () => {
    const store = useTerminalStateStore.getState();
    store.newTerminal(THREAD_ID, "terminal-2");
    // Fill group-default up to the per-group terminal limit.
    store.setActiveTerminal(THREAD_ID, "default");
    for (let index = 2; index <= 6; index += 1) {
      store.newTerminalTab(THREAD_ID, "default", `tab-${index}`);
    }

    const before = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    store.mergeTerminalGroups(THREAD_ID, "group-terminal-2", "group-terminal-2", "right");
    store.mergeTerminalGroups(THREAD_ID, "group-terminal-2", "group-missing", "right");
    // group-default already holds 6 terminals, so merging one more must no-op.
    store.mergeTerminalGroups(THREAD_ID, "group-terminal-2", "group-default", "right");

    const after = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(summarizeTerminalGroups(after.terminalGroups)).toEqual(
      summarizeTerminalGroups(before.terminalGroups),
    );
  });

  it("stores terminal labels and removes them when a terminal closes", () => {
    const store = useTerminalStateStore.getState();
    store.newTerminal(THREAD_ID, "terminal-2");
    store.setTerminalMetadata(THREAD_ID, "terminal-2", {
      cliKind: "codex",
      label: "Codex CLI",
    });

    let terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.terminalLabelsById).toEqual({
      default: "Terminal 1",
      "terminal-2": "Codex 1",
    });
    expect(terminalState.terminalCliKindsById).toEqual({ "terminal-2": "codex" });
    expect(terminalState.terminalAgentKindsById).toEqual({ "terminal-2": "codex" });

    store.closeTerminal(THREAD_ID, "terminal-2");

    terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.terminalLabelsById).toEqual({ default: "Terminal 1" });
    expect(terminalState.terminalCliKindsById).toEqual({});
    expect(terminalState.terminalAgentKindsById).toEqual({});
  });

  it("stores non-resumable coding-agent identities independently from CLI sessions", () => {
    const store = useTerminalStateStore.getState();
    store.newTerminal(THREAD_ID, "terminal-kiro");
    store.setTerminalMetadata(THREAD_ID, "terminal-kiro", {
      agentKind: "kiro",
      cliKind: null,
      label: "Kiro",
    });

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.terminalAgentKindsById).toEqual({ "terminal-kiro": "kiro" });
    expect(terminalState.terminalCliKindsById).toEqual({});
    expect(terminalState.terminalLabelsById["terminal-kiro"]).toBe("Kiro 1");
  });

  it("clears terminal provider identity when metadata cliKind is null", () => {
    const store = useTerminalStateStore.getState();
    store.newTerminal(THREAD_ID, "terminal-2");
    store.setTerminalMetadata(THREAD_ID, "terminal-2", {
      cliKind: "codex",
      label: "Codex CLI",
    });
    store.setTerminalMetadata(THREAD_ID, "terminal-2", {
      cliKind: null,
      label: "bun dev",
    });

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.terminalLabelsById["terminal-2"]).toBe("bun dev");
    expect(terminalState.terminalCliKindsById).toEqual({});
  });

  it("allows unlimited groups while keeping each group capped at four terminals", () => {
    const store = useTerminalStateStore.getState();
    store.splitTerminal(THREAD_ID, "terminal-2");
    store.splitTerminal(THREAD_ID, "terminal-3");
    store.splitTerminal(THREAD_ID, "terminal-4");
    store.newTerminal(THREAD_ID, "terminal-5");
    store.newTerminal(THREAD_ID, "terminal-6");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.terminalIds).toEqual([
      "default",
      "terminal-2",
      "terminal-3",
      "terminal-4",
      "terminal-5",
      "terminal-6",
    ]);
    expect(summarizeTerminalGroups(terminalState.terminalGroups)).toEqual([
      {
        id: "group-default",
        activeTerminalId: "terminal-4",
        terminalIds: ["default", "terminal-2", "terminal-3", "terminal-4"],
      },
      { id: "group-terminal-5", activeTerminalId: "terminal-5", terminalIds: ["terminal-5"] },
      { id: "group-terminal-6", activeTerminalId: "terminal-6", terminalIds: ["terminal-6"] },
    ]);
  });

  it("tracks and clears terminal subprocess activity", () => {
    const store = useTerminalStateStore.getState();
    store.splitTerminal(THREAD_ID, "terminal-2");
    store.setTerminalActivity(THREAD_ID, "terminal-2", {
      hasRunningSubprocess: true,
      agentState: null,
    });
    expect(
      selectThreadTerminalState(useTerminalStateStore.getState().terminalStateByThreadId, THREAD_ID)
        .runningTerminalIds,
    ).toEqual(["terminal-2"]);

    store.setTerminalActivity(THREAD_ID, "terminal-2", {
      hasRunningSubprocess: false,
      agentState: null,
    });
    expect(
      selectThreadTerminalState(useTerminalStateStore.getState().terminalStateByThreadId, THREAD_ID)
        .runningTerminalIds,
    ).toEqual([]);
  });

  it("tracks explicit terminal agent running state separately from subprocess activity", () => {
    const store = useTerminalStateStore.getState();
    store.splitTerminal(THREAD_ID, "terminal-2");
    store.setTerminalActivity(THREAD_ID, "terminal-2", {
      hasRunningSubprocess: false,
      agentState: "running",
    });

    expect(
      selectThreadTerminalState(useTerminalStateStore.getState().terminalStateByThreadId, THREAD_ID)
        .terminalAttentionStatesById,
    ).toEqual({ "terminal-2": "running" });

    store.setTerminalActivity(THREAD_ID, "terminal-2", {
      hasRunningSubprocess: false,
      agentState: null,
    });
    expect(
      selectThreadTerminalState(useTerminalStateStore.getState().terminalStateByThreadId, THREAD_ID)
        .terminalAttentionStatesById,
    ).toEqual({});
  });

  it("strips volatile runtime flags from persisted terminal state", () => {
    const store = useTerminalStateStore.getState();
    store.splitTerminal(THREAD_ID, "terminal-2");
    store.setTerminalTitleOverride(THREAD_ID, "terminal-2", "New keybinds set");
    store.setTerminalActivity(THREAD_ID, "terminal-2", {
      hasRunningSubprocess: false,
      agentState: "attention",
    });

    const sanitized = sanitizePersistedTerminalStateByThreadId(
      useTerminalStateStore.getState().terminalStateByThreadId,
    );

    expect(sanitized[THREAD_ID]?.terminalTitleOverridesById).toEqual({
      "terminal-2": "New keybinds set",
    });
    expect(sanitized[THREAD_ID]?.terminalAttentionStatesById).toEqual({});
    expect(sanitized[THREAD_ID]?.runningTerminalIds).toEqual([]);
  });

  it("resets to default and clears persisted entry when closing the last terminal", () => {
    const store = useTerminalStateStore.getState();
    store.closeTerminal(THREAD_ID, "default");

    expect(useTerminalStateStore.getState().terminalStateByThreadId[THREAD_ID]).toBeUndefined();
    expect(
      selectThreadTerminalState(useTerminalStateStore.getState().terminalStateByThreadId, THREAD_ID)
        .terminalIds,
    ).toEqual(["default"]);
  });

  it("returns terminal-first threads to chat after closing the last terminal", () => {
    const store = useTerminalStateStore.getState();
    store.openTerminalThreadPage(THREAD_ID, { terminalOnly: true });
    store.closeTerminal(THREAD_ID, "default");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.entryPoint).toBe("chat");
    expect(terminalState.terminalOpen).toBe(false);
    expect(terminalState.presentationMode).toBe("drawer");
    expect(terminalState.workspaceLayout).toBe("both");
    expect(terminalState.terminalIds).toEqual(["default"]);
  });

  it("keeps a valid active terminal after closing an active split terminal", () => {
    const store = useTerminalStateStore.getState();
    store.splitTerminal(THREAD_ID, "terminal-2");
    store.splitTerminal(THREAD_ID, "terminal-3");
    store.closeTerminal(THREAD_ID, "terminal-3");

    const terminalState = selectThreadTerminalState(
      useTerminalStateStore.getState().terminalStateByThreadId,
      THREAD_ID,
    );
    expect(terminalState.activeTerminalId).toBe("terminal-2");
    expect(terminalState.terminalIds).toEqual(["default", "terminal-2"]);
    expect(summarizeTerminalGroups(terminalState.terminalGroups)).toEqual([
      {
        id: "group-default",
        activeTerminalId: "terminal-2",
        terminalIds: ["default", "terminal-2"],
      },
    ]);
  });
});
