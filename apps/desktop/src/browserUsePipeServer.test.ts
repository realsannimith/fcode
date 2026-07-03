// FILE: browserUsePipeServer.test.ts
// Purpose: Guards the desktop browser-use native pipe path helpers.
// Layer: Desktop test
// Depends on: Vitest and browserUsePipeServer path resolution exports

import { basename, dirname } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DPCODE_BROWSER_USE_PIPE_ENV,
  resolveConfiguredBrowserUsePipePath,
  resolveDefaultBrowserUsePipePath,
  FCODE_BROWSER_USE_PIPE_ENV,
  T3CODE_BROWSER_USE_PIPE_ENV,
} from "./browserUsePipeServer";

describe("browser-use pipe path resolution", () => {
  it("creates the unix socket inside the fixed directory the Codex plugin scans", () => {
    const pipePath = resolveDefaultBrowserUsePipePath("darwin");

    // Must be the literal /tmp root (not os.tmpdir(), which is /var/folders/…
    // on macOS) — the Codex control-in-app-browser plugin readdir-scans exactly
    // this path to discover in-app browsers.
    expect(dirname(pipePath)).toBe("/tmp/codex-browser-use");
    expect(basename(pipePath)).toMatch(/^fcode-iab-\d+\.sock$/);
  });

  it("prefers an explicit FCode pipe path from the environment", () => {
    expect(
      resolveConfiguredBrowserUsePipePath(
        {
          [FCODE_BROWSER_USE_PIPE_ENV]: "/tmp/codex-browser-use/fcode.sock",
          [DPCODE_BROWSER_USE_PIPE_ENV]: "/tmp/codex-browser-use/custom.sock",
          [T3CODE_BROWSER_USE_PIPE_ENV]: "/tmp/codex-browser-use/legacy.sock",
        },
        "darwin",
      ),
    ).toBe("/tmp/codex-browser-use/fcode.sock");
  });

  it("falls back to legacy desktop pipe environment names", () => {
    expect(
      resolveConfiguredBrowserUsePipePath(
        {
          [DPCODE_BROWSER_USE_PIPE_ENV]: "/tmp/codex-browser-use/custom.sock",
          [T3CODE_BROWSER_USE_PIPE_ENV]: "/tmp/codex-browser-use/legacy.sock",
        },
        "darwin",
      ),
    ).toBe("/tmp/codex-browser-use/custom.sock");
  });
});
