// FILE: browserUseHttpRoute.test.ts
// Purpose: Guards the HTTP bridge's op-to-session dispatch used by the fcode-browser skill CLI.
// Layer: Server test
// Depends on: Vitest and a recording fake BrowserUseSession

import { describe, expect, it } from "vitest";

import { executeBrowserUseOp } from "./browserUseHttpRoute.ts";
import type { BrowserUseSession } from "./browserUseSession.ts";

interface RecordedCall {
  method: string;
  args: unknown[];
}

function makeFakeSession(): { session: BrowserUseSession; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const record =
    (method: string, result: unknown = {}) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return Promise.resolve(result);
    };
  const session = {
    listTabs: record("listTabs", []),
    newTab: record("newTab", { id: 2 }),
    selectTab: record("selectTab"),
    navigate: record("navigate", {
      url: "https://example.com",
      title: "t",
      readyState: "complete",
    }),
    goHistory: record("goHistory", { url: "u", title: "t", readyState: "complete" }),
    getPageState: record("getPageState", { header: "h", content: "c", footer: "f" }),
    clickElementByIndex: record("clickElementByIndex", "Clicked"),
    inputTextByIndex: record("inputTextByIndex", "Typed"),
    selectOptionByIndex: record("selectOptionByIndex", "Selected"),
    click: record("click"),
    typeText: record("typeText"),
    pressKey: record("pressKey"),
    scroll: record("scroll"),
    readPage: record("readPage", { text: "" }),
    readConsole: record("readConsole", []),
    evaluate: record("evaluate", "42"),
    screenshot: record("screenshot", { base64Png: "cGln", width: 1, height: 1 }),
  } as unknown as BrowserUseSession;
  return { session, calls };
}

describe("executeBrowserUseOp", () => {
  it("maps snake_case ops and args onto session methods", async () => {
    const { session, calls } = makeFakeSession();

    await executeBrowserUseOp(session, "navigate", { url: "https://example.com" });
    await executeBrowserUseOp(session, "click_element", { index: 4 });
    await executeBrowserUseOp(session, "input_text", { index: 2, text: "hello" });
    await executeBrowserUseOp(session, "select_option", { index: 1, option_text: "Blue" });
    await executeBrowserUseOp(session, "press", { key: "Enter", modifiers: ["shift"] });
    await executeBrowserUseOp(session, "scroll", { delta_y: 300 });

    expect(calls).toEqual([
      { method: "navigate", args: ["https://example.com"] },
      { method: "clickElementByIndex", args: [4] },
      { method: "inputTextByIndex", args: [2, "hello"] },
      { method: "selectOptionByIndex", args: [1, "Blue"] },
      { method: "pressKey", args: ["Enter", ["shift"]] },
      { method: "scroll", args: [{ deltaY: 300 }] },
    ]);
  });

  it("wraps action results so the CLI always has a message to print", async () => {
    const { session } = makeFakeSession();

    await expect(executeBrowserUseOp(session, "click_element", { index: 4 })).resolves.toEqual({
      message: "Clicked",
    });
    await expect(executeBrowserUseOp(session, "eval", { expression: "1 + 41" })).resolves.toEqual({
      result: "42",
    });
  });

  it("rejects missing required arguments and unknown ops", async () => {
    const { session, calls } = makeFakeSession();

    await expect(executeBrowserUseOp(session, "navigate", {})).rejects.toThrow(
      "Missing required string argument: url",
    );
    await expect(executeBrowserUseOp(session, "click_element", {})).rejects.toThrow(
      "Missing required numeric argument: index",
    );
    await expect(executeBrowserUseOp(session, "explode", {})).rejects.toThrow(
      "Unknown browser-use op: explode",
    );
    expect(calls).toEqual([]);
  });
});
