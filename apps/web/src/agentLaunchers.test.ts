import { describe, expect, it } from "vitest";

import {
  agentLauncherIconKey,
  cloneDefaultAgentLaunchers,
  DEFAULT_AGENT_LAUNCHERS,
  MAX_AGENT_LAUNCHERS,
  nextAgentLauncherId,
  normalizeAgentLaunchers,
  resolveAgentLauncherTerminalTarget,
} from "./agentLaunchers";

describe("normalizeAgentLaunchers", () => {
  it("drops entries with a blank label or command", () => {
    const result = normalizeAgentLaunchers([
      { id: "keep", label: "Claude", command: "claude" },
      { id: "blank-command", label: "Codex", command: "   " },
      { id: "blank-label", label: "  ", command: "codex" },
    ]);
    expect(result).toEqual([{ id: "keep", label: "Claude", command: "claude" }]);
  });

  it("regenerates duplicate or empty ids without collisions", () => {
    const result = normalizeAgentLaunchers([
      { id: "claude", label: "Claude", command: "claude" },
      { id: "claude", label: "Claude", command: "claude --dangerously-skip-permissions" },
      { id: "", label: "Codex", command: "codex" },
    ]);
    const ids = result.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("claude");
  });

  it("caps the list length", () => {
    const many = Array.from({ length: MAX_AGENT_LAUNCHERS + 5 }, (_, index) => ({
      id: `id-${index}`,
      label: `Launcher ${index}`,
      command: `run-${index}`,
    }));
    expect(normalizeAgentLaunchers(many)).toHaveLength(MAX_AGENT_LAUNCHERS);
  });

  it("preserves interior/trailing spaces (does not trim command text)", () => {
    const result = normalizeAgentLaunchers([{ id: "x", label: "X", command: "claude --model " }]);
    expect(result[0]?.command).toBe("claude --model ");
  });

  it("is idempotent on already-normalized input", () => {
    const once = normalizeAgentLaunchers(cloneDefaultAgentLaunchers());
    const twice = normalizeAgentLaunchers(once);
    expect(twice).toEqual(once);
  });
});

describe("nextAgentLauncherId", () => {
  it("slugifies the label", () => {
    expect(nextAgentLauncherId("Claude (skip permissions)", [])).toBe("claude-skip-permissions");
  });

  it("suffixes to avoid collisions", () => {
    expect(nextAgentLauncherId("Claude", ["claude"])).toBe("claude-2");
    expect(nextAgentLauncherId("Claude", ["claude", "claude-2"])).toBe("claude-3");
  });

  it("falls back to a stable base for symbol-only labels", () => {
    expect(nextAgentLauncherId("!!!", [])).toBe("launcher");
  });
});

describe("agentLauncherIconKey", () => {
  it("maps known CLIs to their glyphs and everything else to the terminal icon", () => {
    expect(agentLauncherIconKey("claude --dangerously-skip-permissions")).toBe("claude");
    expect(agentLauncherIconKey("codex --yolo")).toBe("openai");
    expect(agentLauncherIconKey("bun run dev")).toBe("terminal");
  });
});

describe("resolveAgentLauncherTerminalTarget", () => {
  it("reuses an untouched terminal for the first launcher", () => {
    expect(
      resolveAgentLauncherTerminalTarget({
        baseTerminalId: "terminal-1",
        createTerminalId: () => "terminal-2",
        hasRunningTerminal: false,
        hasLaunchedAgent: false,
      }),
    ).toEqual({ shouldCreateNewTerminal: false, terminalId: "terminal-1" });
  });

  it("creates a new terminal when an existing launch is active or has history", () => {
    expect(
      resolveAgentLauncherTerminalTarget({
        baseTerminalId: "terminal-1",
        createTerminalId: () => "terminal-2",
        hasRunningTerminal: true,
        hasLaunchedAgent: false,
      }),
    ).toEqual({ shouldCreateNewTerminal: true, terminalId: "terminal-2" });
    expect(
      resolveAgentLauncherTerminalTarget({
        baseTerminalId: "terminal-1",
        createTerminalId: () => "terminal-3",
        hasRunningTerminal: false,
        hasLaunchedAgent: true,
      }),
    ).toEqual({ shouldCreateNewTerminal: true, terminalId: "terminal-3" });
  });
});

describe("DEFAULT_AGENT_LAUNCHERS", () => {
  it("includes the requested skip-permission / yolo presets", () => {
    const commands = DEFAULT_AGENT_LAUNCHERS.map((entry) => entry.command);
    expect(commands).toContain("claude --dangerously-skip-permissions");
    expect(commands).toContain("codex --yolo");
  });
});
