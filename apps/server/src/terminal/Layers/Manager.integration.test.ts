// FILE: Manager.integration.test.ts
// Purpose: Real-PTY proof that a terminal session survives an app restart end to end:
// scrollback is persisted and replayed, and a captured CLI conversation is auto-resumed
// into the fresh shell (CMUX-style resume binding), using the actual node-pty adapter.
// Layer: Terminal infrastructure integration test

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { TerminalEvent } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Encoding, Layer } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { PtyAdapter, type PtyAdapterShape } from "../Services/PTY";
import { TerminalManagerRuntime } from "./Manager";
import { makeNodePtyLayer } from "./NodePTY";

const THREAD_ID = "itest-resume-thread";
const SESSION_ID = "itest-session-1234";

function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("Timed out waiting for condition"));
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
  });
}

function loadRealPtyAdapter(): Promise<PtyAdapterShape> {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* PtyAdapter;
    }).pipe(Effect.provide(makeNodePtyLayer().pipe(Layer.provide(NodeServices.layer)))),
  );
}

function threadFileName(suffix: string): string {
  return `terminal_${Encoding.encodeBase64Url(THREAD_ID)}${suffix}`;
}

describe("TerminalManager real-PTY restart resume", () => {
  const tempDirs: string[] = [];

  function makeTempDir(label: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `t3code-terminal-itest-${label}-`));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "replays scrollback and auto-resumes the captured CLI session across a runtime restart",
    async () => {
      const logsDir = makeTempDir("logs");
      const workDir = makeTempDir("cwd");
      const homeDir = makeTempDir("home");
      const shimDir = makeTempDir("shim");

      // A stand-in `claude` binary so the injected resume command is observable in the
      // PTY output without ever launching a real agent CLI from the test.
      fs.writeFileSync(path.join(shimDir, "claude"), '#!/bin/sh\necho "SHIM_CLAUDE_INVOKED $*"\n', {
        mode: 0o755,
      });
      const testPath = `${shimDir}:/usr/bin:/bin`;
      // Managed wrapper preparation resolves `claude` from the server's own PATH at
      // construction time, so it must point at the shim while the runtimes are created.
      const runtimeEnv = { HOME: homeDir, PATH: testPath };
      const originalPath = process.env.PATH;
      process.env.PATH = testPath;

      const ptyAdapter = await loadRealPtyAdapter();
      const managerOptions = {
        logsDir,
        ptyAdapter,
        shellResolver: () => "/bin/bash",
      };
      const openInput = {
        threadId: THREAD_ID,
        cwd: workDir,
        cols: 100,
        rows: 24,
        env: runtimeEnv,
      };

      let firstRun: TerminalManagerRuntime | null = null;
      let secondRun: TerminalManagerRuntime | null = null;
      try {
        firstRun = new TerminalManagerRuntime(managerOptions);
        let firstTranscript = "";
        firstRun.on("event", (event: TerminalEvent) => {
          if (event.type === "output") {
            firstTranscript += event.data;
          }
        });

        await firstRun.open(openInput);
        await waitFor(() => firstTranscript.length > 0);

        await firstRun.write({
          threadId: THREAD_ID,
          data: "printf 'FCODE_%s\\n' MARKER_OUTPUT\r",
        });
        await waitFor(() => firstTranscript.includes("FCODE_MARKER_OUTPUT"));

        // Stand-in for a managed agent wrapper surfacing its live session id over the
        // PTY stream (a real wrapper emits the same OSC 633 sequence).
        await firstRun.write({
          threadId: THREAD_ID,
          data: `printf '\\033]633;T3CODE_AGENT_SESSION=claude:${SESSION_ID}\\007'\r`,
        });
        const metaPath = path.join(logsDir, threadFileName(".session.json"));
        await waitFor(() => fs.existsSync(metaPath));
        expect(JSON.parse(fs.readFileSync(metaPath, "utf8"))).toEqual({
          cliKind: "claude",
          sessionId: SESSION_ID,
        });

        // App quit: the PTY is killed and pending scrollback flushes to disk.
        await firstRun.dispose();
        firstRun = null;
        const historyPath = path.join(logsDir, threadFileName(".log"));
        expect(fs.readFileSync(historyPath, "utf8")).toContain("FCODE_MARKER_OUTPUT");

        // App relaunch: a fresh runtime over the same on-disk state.
        secondRun = new TerminalManagerRuntime(managerOptions);
        let secondTranscript = "";
        secondRun.on("event", (event: TerminalEvent) => {
          if (event.type === "output") {
            secondTranscript += event.data;
          }
        });

        const snapshot = await secondRun.open(openInput);
        expect(snapshot.history).toContain("FCODE_MARKER_OUTPUT");

        // Once the reopened shell prints its prompt, the manager types the resume
        // command, which resolves through the managed wrapper to the shim CLI.
        await waitFor(
          () => new RegExp(`SHIM_CLAUDE_INVOKED .*--resume ${SESSION_ID}`).test(secondTranscript),
          20_000,
        );
      } finally {
        if (originalPath === undefined) {
          delete process.env.PATH;
        } else {
          process.env.PATH = originalPath;
        }
        await firstRun?.dispose();
        await secondRun?.dispose();
      }
    },
    90_000,
  );
});
