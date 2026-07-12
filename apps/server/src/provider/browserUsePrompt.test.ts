// FILE: browserUsePrompt.test.ts
// Purpose: Verifies cross-provider prompt injection for the FCode browser skill.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FCODE_BROWSER_USE_PIPE_ENV } from "@t3tools/shared/browserUsePipe";
import { describe, expect, it } from "vitest";

import { materializeBrowserUseSkill } from "../browserUse/browserUseSkill.ts";
import { buildProviderBrowserAndSkillPrompt } from "./browserUsePrompt.ts";

describe("buildProviderBrowserAndSkillPrompt", () => {
  it("does not inject the browser skill when no desktop browser pipe is available", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "fcode-browser-prompt-no-pipe-"));
    try {
      await materializeBrowserUseSkill({
        fcodeBaseDir: baseDir,
        serverPort: 1234,
        authToken: "token",
        env: { [FCODE_BROWSER_USE_PIPE_ENV]: "/tmp/fcode-browser-test.sock" },
      });

      const prompt = await buildProviderBrowserAndSkillPrompt({
        provider: "gemini",
        fcodeBaseDir: baseDir,
        skills: undefined,
        maxChars: 24_000,
        env: {},
      });

      expect(prompt).toBe("");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("injects the browser skill for providers without Claude MCP browser tools", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "fcode-browser-prompt-"));
    try {
      await materializeBrowserUseSkill({
        fcodeBaseDir: baseDir,
        serverPort: 1234,
        authToken: "token",
        env: { [FCODE_BROWSER_USE_PIPE_ENV]: "/tmp/fcode-browser-test.sock" },
      });

      const prompt = await buildProviderBrowserAndSkillPrompt({
        provider: "cursor",
        fcodeBaseDir: baseDir,
        skills: undefined,
        maxChars: 24_000,
        env: { [FCODE_BROWSER_USE_PIPE_ENV]: "/tmp/fcode-browser-test.sock" },
      });

      expect(prompt).toContain("FCode has a built-in in-app browser panel");
      expect(prompt).toContain('name="fcode-browser"');
      expect(prompt).toContain("browser.mjs");
      expect(prompt).toContain("navigate <url>");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("injects only the routing nudge for providers with native fcode skill discovery", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "fcode-browser-prompt-codex-"));
    try {
      await materializeBrowserUseSkill({
        fcodeBaseDir: baseDir,
        serverPort: 1234,
        authToken: "token",
        env: { [FCODE_BROWSER_USE_PIPE_ENV]: "/tmp/fcode-browser-test.sock" },
      });

      const prompt = await buildProviderBrowserAndSkillPrompt({
        provider: "codex",
        fcodeBaseDir: baseDir,
        skills: undefined,
        maxChars: 24_000,
        env: { [FCODE_BROWSER_USE_PIPE_ENV]: "/tmp/fcode-browser-test.sock" },
      });

      expect(prompt).toContain("FCode has a built-in in-app browser panel");
      expect(prompt).not.toContain('name="fcode-browser"');
      expect(prompt).not.toContain("browser.mjs");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
