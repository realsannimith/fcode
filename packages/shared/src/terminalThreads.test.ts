// FILE: terminalThreads.test.ts
// Purpose: Verifies shared terminal identity helpers.
// Layer: Shared utility test

import { describe, expect, it } from "vitest";

import {
  deriveTerminalCodingAgentKind,
  parseTerminalSessionOsc,
  resolveTerminalVisualIdentity,
  terminalCliResumeArgs,
  T3CODE_TERMINAL_SESSION_OSC_PREFIX,
} from "./terminalThreads";

describe("deriveTerminalCodingAgentKind", () => {
  it.each([
    ["codex", "codex"],
    ["claude", "claude"],
    ["opencode", "opencode"],
    ["pi", "pi"],
    ["kiro-cli", "kiro"],
    ["/Users/test/.local/bin/kiro-cli-chat chat", "kiro"],
    ["kiro", "kiro"],
    ["agv", "agentenv"],
    ["agentenv", "agentenv"],
    ["aider", "aider"],
    ["amp", "amp"],
    ["gemini", "gemini"],
    ["copilot", "copilot"],
    ["goose", "goose"],
    ["cursor-agent", "cursor"],
    ["qwen", "qwen"],
    ["crush", "crush"],
    ["droid", "droid"],
    ["kilo", "kilo"],
    ["cline", "cline"],
  ] as const)("detects the %s executable", (command, expected) => {
    expect(deriveTerminalCodingAgentKind(command)).toBe(expected);
  });

  it.each([
    ["npx @google/gemini-cli", "gemini"],
    ["bunx opencode-ai", "opencode"],
    ["pnpm dlx @earendil-works/pi-coding-agent", "pi"],
    ["npm exec @ampcode/cli", "amp"],
    ["python -m aider", "aider"],
    ["node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js", "claude"],
    ["node /usr/local/lib/node_modules/@kilocode/cli/dist/index.js", "kilo"],
    ["/bin/sh /tmp/_managed-bin/codex --yolo", "codex"],
  ] as const)("detects wrapped process command %s", (command, expected) => {
    expect(deriveTerminalCodingAgentKind(command)).toBe(expected);
  });

  it("does not mistake prompt text or ordinary commands for an agent process", () => {
    expect(deriveTerminalCodingAgentKind('echo "run opencode next"')).toBeNull();
    expect(deriveTerminalCodingAgentKind("node build.js --message 'try claude'")).toBeNull();
    expect(deriveTerminalCodingAgentKind("git status")).toBeNull();
  });
});

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
