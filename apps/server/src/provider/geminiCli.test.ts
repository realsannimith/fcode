import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ANTIGRAVITY_CLI_BINARY,
  GEMINI_CLI_BINARY,
  geminiCliCandidates,
  geminiCliFlavorForBinaryPath,
  geminiCliNotInstalledMessage,
  resolveGeminiCli,
} from "./geminiCli";

describe("geminiCliFlavorForBinaryPath", () => {
  it("classifies the agy binary as the antigravity flavor", () => {
    expect(geminiCliFlavorForBinaryPath("agy")).toBe("antigravity");
    expect(geminiCliFlavorForBinaryPath("/Users/me/.local/bin/agy")).toBe("antigravity");
    expect(geminiCliFlavorForBinaryPath("AGY.EXE")).toBe("antigravity");
    expect(geminiCliFlavorForBinaryPath("/opt/antigravity-cli")).toBe("antigravity");
  });

  it("classifies everything else as the legacy ACP flavor", () => {
    expect(geminiCliFlavorForBinaryPath("gemini")).toBe("acp");
    expect(geminiCliFlavorForBinaryPath("/usr/local/bin/gemini")).toBe("acp");
    expect(geminiCliFlavorForBinaryPath("my-gemini-wrapper")).toBe("acp");
  });
});

describe("geminiCliCandidates", () => {
  it("probes gemini first and falls back to agy by default", () => {
    expect(geminiCliCandidates()).toEqual([GEMINI_CLI_BINARY, ANTIGRAVITY_CLI_BINARY]);
    expect(geminiCliCandidates("")).toEqual([GEMINI_CLI_BINARY, ANTIGRAVITY_CLI_BINARY]);
    expect(geminiCliCandidates("gemini")).toEqual([GEMINI_CLI_BINARY, ANTIGRAVITY_CLI_BINARY]);
  });

  it("short-circuits to a custom configured binary", () => {
    expect(geminiCliCandidates("/custom/path/agy")).toEqual(["/custom/path/agy"]);
    expect(geminiCliCandidates("agy")).toEqual(["agy"]);
  });
});

describe("resolveGeminiCli", () => {
  let binDir: string;

  beforeAll(() => {
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-cli-test-"));
  });

  afterAll(() => {
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  function installFakeBinary(name: string): string {
    const filePath = path.join(binDir, name);
    fs.writeFileSync(filePath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    return filePath;
  }

  it("returns undefined when no candidate exists on PATH", () => {
    expect(resolveGeminiCli(undefined, { PATH: binDir })).toBeUndefined();
  });

  it("falls back to agy when gemini is missing", () => {
    installFakeBinary(ANTIGRAVITY_CLI_BINARY);
    expect(resolveGeminiCli(undefined, { PATH: binDir })).toEqual({
      binaryPath: ANTIGRAVITY_CLI_BINARY,
      flavor: "antigravity",
    });
  });

  it("prefers gemini when both binaries exist", () => {
    installFakeBinary(ANTIGRAVITY_CLI_BINARY);
    installFakeBinary(GEMINI_CLI_BINARY);
    expect(resolveGeminiCli(undefined, { PATH: binDir })).toEqual({
      binaryPath: GEMINI_CLI_BINARY,
      flavor: "acp",
    });
  });

  it("resolves a custom absolute path with its flavor", () => {
    const agyPath = installFakeBinary(ANTIGRAVITY_CLI_BINARY);
    expect(resolveGeminiCli(agyPath, { PATH: "" })).toEqual({
      binaryPath: agyPath,
      flavor: "antigravity",
    });
  });
});

describe("geminiCliNotInstalledMessage", () => {
  it("mentions both CLIs for the default configuration", () => {
    expect(geminiCliNotInstalledMessage()).toContain("`gemini`");
    expect(geminiCliNotInstalledMessage()).toContain("`agy`");
  });

  it("mentions only the configured binary for custom paths", () => {
    expect(geminiCliNotInstalledMessage("/custom/agy")).toContain("`/custom/agy`");
  });
});
