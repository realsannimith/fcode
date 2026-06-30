// FILE: terminalSessionsStore.test.ts
// Purpose: Verify saved custom launcher presets are added, updated in place, and
//          removed, and that the persisted config is normalized (trimmed/clamped).

import { beforeEach, describe, expect, it, vi } from "vitest";

type StoreModule = typeof import("./terminalSessionsStore");

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

let store: StoreModule["useTerminalSessionsStore"];

beforeEach(async () => {
  // zustand `persist` writes to localStorage on every mutation; Node has no usable
  // implementation, so provide an in-memory one and load the store fresh each test.
  vi.stubGlobal("localStorage", createMemoryStorage());
  vi.resetModules();
  ({ useTerminalSessionsStore: store } = await import("./terminalSessionsStore"));
});

describe("terminalSessionsStore saved launchers", () => {
  it("saves a new preset with a normalized config", () => {
    const id = store.getState().saveCustomLauncher({
      name: "  Triple Claude  ",
      config: {
        command: "  claude  ",
        paneCount: 9,
        customizePanes: true,
        paneCommands: [" codex ", "", "gemini"],
      },
    });

    const launchers = store.getState().savedLaunchers;
    expect(launchers).toHaveLength(1);
    const launcher = launchers[0]!;
    expect(launcher.id).toBe(id);
    expect(launcher.name).toBe("Triple Claude");
    expect(launcher.command).toBe("claude");
    expect(launcher.paneCount).toBe(4); // clamped from 9
    expect(launcher.customizePanes).toBe(true);
    expect(launcher.paneCommands).toEqual(["codex", "", "gemini"]);
    expect(typeof launcher.createdAt).toBe("string");
  });

  it("falls back to the command when no name is given", () => {
    store.getState().saveCustomLauncher({
      name: "   ",
      config: { command: "codex", paneCount: 1, customizePanes: false, paneCommands: [] },
    });
    expect(store.getState().savedLaunchers[0]!.name).toBe("codex");
  });

  it("updates an existing preset in place by id without reordering", () => {
    const first = store.getState().saveCustomLauncher({
      name: "First",
      config: { command: "codex", paneCount: 1, customizePanes: false, paneCommands: [] },
    });
    store.getState().saveCustomLauncher({
      name: "Second",
      config: { command: "claude", paneCount: 2, customizePanes: false, paneCommands: [] },
    });

    store.getState().saveCustomLauncher({
      id: first,
      name: "First Updated",
      config: { command: "gemini", paneCount: 3, customizePanes: false, paneCommands: [] },
    });

    const launchers = store.getState().savedLaunchers;
    expect(launchers).toHaveLength(2);
    const updated = launchers.find((entry) => entry.id === first)!;
    expect(updated.name).toBe("First Updated");
    expect(updated.command).toBe("gemini");
    expect(updated.paneCount).toBe(3);
    // Updating in place keeps the original (newest-first) ordering.
    expect(launchers[1]!.id).toBe(first);
  });

  it("removes a saved preset by id", () => {
    const id = store.getState().saveCustomLauncher({
      name: "Temp",
      config: { command: "codex", paneCount: 1, customizePanes: false, paneCommands: [] },
    });
    expect(store.getState().savedLaunchers).toHaveLength(1);

    store.getState().removeCustomLauncher(id);
    expect(store.getState().savedLaunchers).toHaveLength(0);
  });
});
