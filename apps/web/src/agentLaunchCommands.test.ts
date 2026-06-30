// FILE: agentLaunchCommands.test.ts
// Purpose: Verify the shared custom-launcher command builder fans a command across
//          panes, applies per-pane overrides, drops empty panes, and clamps counts.

import { describe, expect, it } from "vitest";

import {
  buildCustomLaunchCommands,
  customLaunchLabel,
  customLaunchTerminalId,
} from "./agentLaunchCommands";

describe("buildCustomLaunchCommands", () => {
  it("fans the main command across the requested pane count", () => {
    const commands = buildCustomLaunchCommands({
      command: "claude",
      paneCount: 3,
      customizePanes: false,
      paneCommands: [],
    });
    expect(commands).toHaveLength(3);
    expect(commands.map((entry) => entry.command)).toEqual(["claude", "claude", "claude"]);
    expect(commands.map((entry) => entry.id)).toEqual([
      customLaunchTerminalId(0),
      customLaunchTerminalId(1),
      customLaunchTerminalId(2),
    ]);
  });

  it("applies per-pane overrides only when customizePanes is enabled", () => {
    const overrides = ["codex", "", "gemini", "grok"];
    expect(
      buildCustomLaunchCommands({
        command: "claude",
        paneCount: 4,
        customizePanes: false,
        paneCommands: overrides,
      }).map((entry) => entry.command),
    ).toEqual(["claude", "claude", "claude", "claude"]);

    expect(
      buildCustomLaunchCommands({
        command: "claude",
        paneCount: 4,
        customizePanes: true,
        paneCommands: overrides,
      }).map((entry) => entry.command),
    ).toEqual(["codex", "claude", "gemini", "grok"]);
  });

  it("drops panes whose effective command is empty", () => {
    expect(
      buildCustomLaunchCommands({
        command: "",
        paneCount: 2,
        customizePanes: true,
        paneCommands: ["", "codex"],
      }).map((entry) => entry.command),
    ).toEqual(["codex"]);

    expect(
      buildCustomLaunchCommands({
        command: "",
        paneCount: 3,
        customizePanes: false,
        paneCommands: [],
      }),
    ).toEqual([]);
  });

  it("clamps the pane count to the 1..4 range", () => {
    expect(
      buildCustomLaunchCommands({
        command: "claude",
        paneCount: 9,
        customizePanes: false,
        paneCommands: [],
      }),
    ).toHaveLength(4);
  });
});

describe("customLaunchLabel", () => {
  it("uses the single command, truncating long ones", () => {
    expect(customLaunchLabel([{ id: "default", label: "Pane 1", command: "codex" }])).toBe("codex");
    const long = "x".repeat(60);
    expect(
      customLaunchLabel([{ id: "default", label: "Pane 1", command: long }]).endsWith("..."),
    ).toBe(true);
  });

  it("falls back to a split label for multiple panes", () => {
    expect(
      customLaunchLabel([
        { id: "default", label: "Pane 1", command: "codex" },
        { id: "launch-2", label: "Pane 2", command: "claude" },
      ]),
    ).toBe("Custom split (2)");
  });
});
