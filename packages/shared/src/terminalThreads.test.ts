// FILE: terminalThreads.test.ts
// Purpose: Verifies shared terminal identity helpers.
// Layer: Shared utility test

import { describe, expect, it } from "vitest";

import {
  parseTerminalSessionOsc,
  resolveTerminalVisualIdentity,
  terminalCliResumeArgs,
  T3CODE_TERMINAL_SESSION_OSC_PREFIX,
} from "./terminalThreads";

describe("parseTerminalSessionOsc", () => {
  it("parses a codex session id from the OSC payload", () => {
    const uuid = "019f1b99-d291-7280-9d1f-1369deafd846";
    expect(parseTerminalSessionOsc(`${T3CODE_TERMINAL_SESSION_OSC_PREFIX}codex:${uuid}`)).toEqual({
      cliKind: "codex",
      sessionId: uuid,
    });
  });

  it("parses a claude session id", () => {
    expect(parseTerminalSessionOsc(`${T3CODE_TERMINAL_SESSION_OSC_PREFIX}claude:abc_123`)).toEqual({
      cliKind: "claude",
      sessionId: "abc_123",
    });
  });

  it("rejects unknown cli kinds, missing ids, and shell-unsafe ids", () => {
    expect(parseTerminalSessionOsc(`${T3CODE_TERMINAL_SESSION_OSC_PREFIX}gemini:abc`)).toBeNull();
    expect(parseTerminalSessionOsc(`${T3CODE_TERMINAL_SESSION_OSC_PREFIX}codex:`)).toBeNull();
    expect(
      parseTerminalSessionOsc(`${T3CODE_TERMINAL_SESSION_OSC_PREFIX}codex:a b; rm -rf`),
    ).toBeNull();
    expect(parseTerminalSessionOsc("0;some window title")).toBeNull();
  });
});

describe("terminalCliResumeArgs", () => {
  it("builds the exact resume invocation per CLI", () => {
    expect(terminalCliResumeArgs({ cliKind: "codex", sessionId: "id1" })).toEqual([
      "resume",
      "id1",
    ]);
    expect(terminalCliResumeArgs({ cliKind: "claude", sessionId: "id2" })).toEqual([
      "--resume",
      "id2",
    ]);
  });
});

describe("resolveTerminalVisualIdentity", () => {
  it("treats explicit null cliKind as a generic terminal even when the title looks provider-like", () => {
    expect(
      resolveTerminalVisualIdentity({
        cliKind: null,
        fallbackTitle: "Terminal 1",
        title: "Codex 1",
      }),
    ).toMatchObject({
      cliKind: null,
      iconKey: "terminal",
      title: "Codex 1",
    });
  });

  it("still infers provider identity from title when cliKind is omitted", () => {
    expect(
      resolveTerminalVisualIdentity({
        fallbackTitle: "Terminal 1",
        title: "Claude Code",
      }),
    ).toMatchObject({
      cliKind: "claude",
      iconKey: "claude",
      title: "Claude Code",
    });
  });
});
