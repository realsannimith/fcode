import { describe, expect, it } from "vitest";

import {
  buildAntigravityInteractiveTurnArgs,
  buildAntigravityTurnArgs,
  chunkAntigravityResponseDeltas,
  extractAntigravityAssistantTextFromScreen,
  normalizeAntigravityUsage,
  parseAntigravityPrintOutput,
  readAntigravityResumeCursor,
} from "./GeminiAntigravityRuntime";

const ENVELOPE = JSON.stringify({
  conversation_id: "e4ba9c4e-1137-4959-8faf-bdbb2444902b",
  status: "SUCCESS",
  response: "OK\n",
  duration_seconds: 1.97,
  num_turns: 1,
  usage: { input_tokens: 17_293, output_tokens: 42, thinking_tokens: 38, total_tokens: 17_335 },
});

describe("parseAntigravityPrintOutput", () => {
  it("parses the agy print JSON envelope", () => {
    const parsed = parseAntigravityPrintOutput(`${ENVELOPE}\n`);
    expect(parsed.conversationId).toBe("e4ba9c4e-1137-4959-8faf-bdbb2444902b");
    expect(parsed.status).toBe("SUCCESS");
    expect(parsed.response).toBe("OK\n");
    expect(parsed.usage?.usedTokens).toBe(17_335);
  });

  it("parses an envelope on the last stdout line after log noise", () => {
    const parsed = parseAntigravityPrintOutput(`warming up...\n${ENVELOPE}`);
    expect(parsed.status).toBe("SUCCESS");
    expect(parsed.response).toBe("OK\n");
  });

  it("falls back to plain text when stdout is not a JSON envelope", () => {
    const parsed = parseAntigravityPrintOutput("plain text answer");
    expect(parsed.response).toBe("plain text answer");
    expect(parsed.status).toBeUndefined();
    expect(parsed.conversationId).toBeUndefined();
  });
});

describe("normalizeAntigravityUsage", () => {
  it("maps the agy usage payload to a token usage snapshot", () => {
    expect(
      normalizeAntigravityUsage({
        input_tokens: 100,
        output_tokens: 40,
        thinking_tokens: 30,
        total_tokens: 140,
      }),
    ).toMatchObject({
      usedTokens: 140,
      totalProcessedTokens: 140,
      inputTokens: 100,
      outputTokens: 40,
      reasoningOutputTokens: 30,
      lastUsedTokens: 140,
    });
  });

  it("returns undefined for empty usage", () => {
    expect(normalizeAntigravityUsage(undefined)).toBeUndefined();
    expect(normalizeAntigravityUsage({ total_tokens: 0 })).toBeUndefined();
  });
});

describe("buildAntigravityTurnArgs", () => {
  it("builds first-turn args without a conversation id", () => {
    expect(buildAntigravityTurnArgs({ prompt: "hello", fullAccess: false })).toEqual([
      "--print",
      "hello",
      "--output-format",
      "json",
      "--print-timeout",
      "30m",
      "--new-project",
    ]);
  });

  it("threads workspace, conversation, model, and permission flags", () => {
    expect(
      buildAntigravityTurnArgs({
        prompt: "next",
        conversationId: "abc",
        workspaceDirs: ["/repo/project"],
        model: "Gemini 3.1 Pro (Low)",
        fullAccess: true,
      }),
    ).toEqual([
      "--print",
      "next",
      "--output-format",
      "json",
      "--print-timeout",
      "30m",
      "--add-dir",
      "/repo/project",
      "--conversation",
      "abc",
      "--model",
      "Gemini 3.1 Pro (Low)",
      "--dangerously-skip-permissions",
    ]);
  });
});

describe("buildAntigravityInteractiveTurnArgs", () => {
  it("builds PTY interactive args with workspace and new project", () => {
    expect(
      buildAntigravityInteractiveTurnArgs({
        prompt: "hello",
        workspaceDirs: ["/repo/project"],
        model: "Gemini 3.5 Flash (Medium)",
        fullAccess: true,
      }),
    ).toEqual([
      "--prompt-interactive",
      "hello",
      "--add-dir",
      "/repo/project",
      "--new-project",
      "--model",
      "Gemini 3.5 Flash (Medium)",
      "--dangerously-skip-permissions",
    ]);
  });
});

describe("extractAntigravityAssistantTextFromScreen", () => {
  it("filters Antigravity chrome and keeps assistant text", () => {
    const screen = [
      "Antigravity CLI 1.0.16",
      "────────────────────────────────────────",
      "> What is here?",
      "Generating...",
      "  This is the answer.",
      "  It has two lines.",
      "esc to cancel                  Gemini 3.5 Flash (Medium)",
    ].join("\n");

    expect(extractAntigravityAssistantTextFromScreen(screen, "What is here?")).toBe(
      "This is the answer.\nIt has two lines.",
    );
  });
});

describe("chunkAntigravityResponseDeltas", () => {
  it("splits longer responses into reconstructable deltas", () => {
    const response = "First sentence with enough text to split. Second sentence stays intact.";
    const chunks = chunkAntigravityResponseDeltas(response, 24);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(response);
  });

  it("prefers whitespace boundaries when possible", () => {
    expect(chunkAntigravityResponseDeltas("alpha beta gamma", 11)).toEqual([
      "alpha beta ",
      "gamma",
    ]);
  });
});

describe("readAntigravityResumeCursor", () => {
  it("reads antigravity resume cursors", () => {
    expect(
      readAntigravityResumeCursor({
        flavor: "antigravity",
        conversationId: "abc",
        turns: [{ id: "turn-1", items: [{ text: "hi" }] }],
      }),
    ).toEqual({
      flavor: "antigravity",
      conversationId: "abc",
      turns: [{ id: "turn-1", items: [{ text: "hi" }] }],
    });
  });

  it("ignores ACP resume cursors", () => {
    expect(readAntigravityResumeCursor({ sessionId: "acp-session" })).toBeUndefined();
    expect(readAntigravityResumeCursor(undefined)).toBeUndefined();
  });
});
