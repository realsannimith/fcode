import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { createTerminalModeReplayTracker } from "./terminalModeReplay";

const require = createRequire(import.meta.url);
const { Terminal: HeadlessTerminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");

const ESC = String.fromCharCode(27);

async function withTracker<T>(
  test: (tracker: ReturnType<typeof createTerminalModeReplayTracker>) => T | Promise<T>,
  scrollback = 5_000,
): Promise<T> {
  const tracker = createTerminalModeReplayTracker(120, 32, scrollback);
  try {
    return await test(tracker);
  } finally {
    tracker.dispose();
  }
}

/** Renders a serialized replay buffer the way a fresh client xterm would, for assertions. */
function renderLines(history: string, cols: number, rows: number): Promise<string[]> {
  return new Promise((resolve) => {
    const terminal = new HeadlessTerminal({ cols, rows, allowProposedApi: true });
    terminal.write(history, () => {
      const buffer = terminal.buffer.active;
      const lines: string[] = [];
      for (let index = 0; index < buffer.length; index += 1) {
        lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
      }
      terminal.dispose();
      resolve(lines);
    });
  });
}

describe("createTerminalModeReplayTracker", () => {
  it("returns no preamble for default terminal modes", async () => {
    await withTracker((tracker) => {
      expect(tracker.buildPreamble()).toBe("");
    });
  });

  it("tracks kitty keyboard mode independently of scrollback size", async () => {
    await withTracker((tracker) => {
      tracker.feed(`${ESC}[>7u`);

      const filler = "x".repeat(2048);
      for (let index = 0; index < 100; index += 1) {
        tracker.feed(filler);
      }

      expect(tracker.buildPreamble()).toBe(`${ESC}[=7;1u`);
    });
  });

  it("drops kitty keyboard mode after explicit pop or zero-set", async () => {
    await withTracker((tracker) => {
      tracker.feed(`${ESC}[>7u`);
      expect(tracker.buildPreamble()).toBe(`${ESC}[=7;1u`);

      tracker.feed(`${ESC}[<u`);
      expect(tracker.buildPreamble()).toBe("");

      tracker.feed(`${ESC}[>7u`);
      tracker.feed(`${ESC}[=0;1u`);
      expect(tracker.buildPreamble()).toBe("");
    });
  });

  it("tracks bracketed paste, focus reporting, and cursor visibility", async () => {
    await withTracker((tracker) => {
      tracker.feed(`${ESC}[?2004h${ESC}[?1004h${ESC}[?1002h${ESC}[?25l`);

      const preamble = tracker.buildPreamble();
      expect(preamble).toContain(`${ESC}[?2004h`);
      expect(preamble).toContain(`${ESC}[?1004h`);
      expect(preamble).toContain(`${ESC}[?25l`);

      tracker.feed(`${ESC}[?2004l`);
      expect(tracker.buildPreamble()).not.toContain("?2004");
    });
  });

  it("does not replay mouse tracking modes on renderer reattach", async () => {
    await withTracker((tracker) => {
      tracker.feed(`${ESC}[?9h${ESC}[?1000h${ESC}[?1002h${ESC}[?1003h`);

      const preamble = tracker.buildPreamble();
      expect(preamble).not.toContain("?9h");
      expect(preamble).not.toContain("?1000h");
      expect(preamble).not.toContain("?1002h");
      expect(preamble).not.toContain("?1003h");
    });
  });

  it("preserves mode state across resizes and split escape feeds", async () => {
    await withTracker((tracker) => {
      tracker.feed(`${ESC}[`);
      tracker.feed(">7");
      tracker.feed("u");
      tracker.resize(80, 24);
      tracker.resize(80, 24);
      tracker.resize(160, 48);

      expect(tracker.buildPreamble()).toBe(`${ESC}[=7;1u`);
    });
  });

  it("serializes a carriage-return redraw without a dangling tail from the old text", async () => {
    await withTracker(async (tracker) => {
      // The idiom readline/TUI redraws use: return to column 0, print shorter
      // replacement text, erase whatever of the old line is left. A real terminal
      // (unlike a hand-rolled sanitizer that drops the erase) leaves no leftovers.
      tracker.feed("Welcome! I'm efficient for everyday work.\r");
      tracker.feed(`clear${ESC}[K\n`);
      const lines = await renderLines(tracker.serialize(), 120, 32);
      expect(lines[0]).toBe("clear");
    });
  });

  it("clear wipes the serialized buffer while leaving mode tracking intact", async () => {
    await withTracker(async (tracker) => {
      tracker.feed(`${ESC}[>7u`);
      tracker.feed("some prior output\r\n");

      tracker.clear();
      // Assert mode tracking before touching anything async: the tracker is torn
      // down as soon as this callback's synchronous portion returns/suspends.
      expect(tracker.buildPreamble()).toBe(`${ESC}[=7;1u`);

      const lines = await renderLines(tracker.serialize(), 120, 32);
      expect(lines.every((line) => line.length === 0)).toBe(true);
    });
  });

  it("caps retained scrollback to the configured row count", async () => {
    const tracker = createTerminalModeReplayTracker(100, 1, 3);
    try {
      tracker.feed("line1\r\nline2\r\nline3\r\nline4\r\n");
      const lines = await renderLines(tracker.serialize(), 100, 1);
      expect(lines.filter((line) => line.length > 0)).toEqual(["line2", "line3", "line4"]);
    } finally {
      tracker.dispose();
    }
  });
});
