import { describe, expect, it } from "vitest";

import {
  antigravityCapabilityResultFromModelsCommand,
  isAntigravityAuthFailure,
  parseAntigravityModels,
} from "./antigravityCliProbe";

const MODELS_STDOUT = [
  "Gemini 3.5 Flash (Medium)",
  "Gemini 3.5 Flash (High)",
  "Gemini 3.1 Pro (Low)",
  "Claude Sonnet 4.6 (Thinking)",
  "",
].join("\n");

describe("parseAntigravityModels", () => {
  it("parses one display-name model per line", () => {
    expect(parseAntigravityModels(MODELS_STDOUT)).toEqual([
      { slug: "Gemini 3.5 Flash (Medium)", name: "Gemini 3.5 Flash (Medium)" },
      { slug: "Gemini 3.5 Flash (High)", name: "Gemini 3.5 Flash (High)" },
      { slug: "Gemini 3.1 Pro (Low)", name: "Gemini 3.1 Pro (Low)" },
      { slug: "Claude Sonnet 4.6 (Thinking)", name: "Claude Sonnet 4.6 (Thinking)" },
    ]);
  });

  it("skips duplicates, usage lines, and errors", () => {
    expect(
      parseAntigravityModels("Gemini 3.1 Pro (Low)\nGemini 3.1 Pro (Low)\nUsage of agy:\nError: x"),
    ).toEqual([{ slug: "Gemini 3.1 Pro (Low)", name: "Gemini 3.1 Pro (Low)" }]);
  });
});

describe("isAntigravityAuthFailure", () => {
  it("detects auth-related failures", () => {
    expect(isAntigravityAuthFailure("Error: not logged in")).toBe(true);
    expect(isAntigravityAuthFailure("please sign in to continue")).toBe(true);
    expect(isAntigravityAuthFailure("401 Unauthorized")).toBe(true);
  });

  it("ignores unrelated failures", () => {
    expect(isAntigravityAuthFailure("network timeout")).toBe(false);
  });
});

describe("antigravityCapabilityResultFromModelsCommand", () => {
  it("reports ready and authenticated with discovered models on success", () => {
    const result = antigravityCapabilityResultFromModelsCommand({
      stdout: MODELS_STDOUT,
      stderr: "",
      code: 0,
    });
    expect(result.status).toBe("ready");
    expect(result.auth.status).toBe("authenticated");
    expect(result.models).toHaveLength(4);
    expect(result.message).toContain("`agy`");
  });

  it("reports ready with a fallback message when no models are listed", () => {
    const result = antigravityCapabilityResultFromModelsCommand({
      stdout: "",
      stderr: "",
      code: 0,
    });
    expect(result.status).toBe("ready");
    expect(result.auth.status).toBe("authenticated");
    expect(result.models).toEqual([]);
  });

  it("reports unauthenticated on auth failures", () => {
    const result = antigravityCapabilityResultFromModelsCommand({
      stdout: "",
      stderr: "Error: you are not logged in",
      code: 1,
    });
    expect(result.status).toBe("error");
    expect(result.auth.status).toBe("unauthenticated");
    expect(result.message).toContain("sign in");
  });

  it("reports a warning on unrelated failures", () => {
    const result = antigravityCapabilityResultFromModelsCommand({
      stdout: "",
      stderr: "network unreachable",
      code: 1,
    });
    expect(result.status).toBe("warning");
    expect(result.auth.status).toBe("unknown");
    expect(result.message).toContain("network unreachable");
  });
});
