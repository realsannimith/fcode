// FILE: browserUseSkill.test.ts
// Purpose: Guards the materialized fcode-browser skill artifacts (layout, config, CLI syntax).
// Layer: Server test
// Depends on: Vitest, a temp FCode base dir, and node --check for CLI validation

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as OS from "node:os";
import * as nodePath from "node:path";
import { promisify } from "node:util";

import { FCODE_BROWSER_USE_PIPE_ENV } from "@t3tools/shared/browserUsePipe";
import { describe, expect, it } from "vitest";

import { materializeBrowserUseSkill } from "./browserUseSkill.ts";

const execFileAsync = promisify(execFile);

async function makeTempBaseDir(): Promise<string> {
  return fs.mkdtemp(nodePath.join(OS.tmpdir(), "fcode-skill-test-"));
}

describe("materializeBrowserUseSkill", () => {
  it("returns null and writes nothing without a browser pipe configured", async () => {
    const baseDir = await makeTempBaseDir();

    const skillDir = await materializeBrowserUseSkill({
      fcodeBaseDir: baseDir,
      serverPort: 3773,
      authToken: "secret",
      env: {},
    });

    expect(skillDir).toBeNull();
    await expect(fs.readdir(baseDir)).resolves.toEqual([]);
  });

  it("writes SKILL.md, a syntactically valid CLI, and the runtime config", async () => {
    const baseDir = await makeTempBaseDir();

    const skillDir = await materializeBrowserUseSkill({
      fcodeBaseDir: baseDir,
      serverPort: 4001,
      authToken: "token-123",
      env: { [FCODE_BROWSER_USE_PIPE_ENV]: "/tmp/fcode-test-pipe.sock" },
    });

    expect(skillDir).toBe(nodePath.join(baseDir, "skills", "fcode-browser"));

    const skillMarkdown = await fs.readFile(nodePath.join(skillDir!, "SKILL.md"), "utf8");
    expect(skillMarkdown).toContain("name: fcode-browser");
    expect(skillMarkdown).toContain(nodePath.join(skillDir!, "browser.mjs"));
    expect(skillMarkdown).toContain("page-state");

    const runtime = JSON.parse(await fs.readFile(nodePath.join(skillDir!, "runtime.json"), "utf8"));
    expect(runtime).toEqual({
      serverUrl: "http://127.0.0.1:4001",
      token: "token-123",
      routePath: "/api/browser-use",
    });

    // The CLI is generated from a template string; a stray escape would break
    // every provider at once, so validate real parseability with node.
    await expect(
      execFileAsync(process.execPath, ["--check", nodePath.join(skillDir!, "browser.mjs")]),
    ).resolves.toBeDefined();
  });
});
