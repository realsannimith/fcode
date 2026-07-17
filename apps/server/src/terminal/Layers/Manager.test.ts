import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_TERMINAL_ID,
  type TerminalEvent,
  type TerminalOpenInput,
  type TerminalRestartInput,
} from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  PtySpawnError,
  type PtyAdapterShape,
  type PtyExitEvent,
  type PtyProcess,
  type PtySpawnInput,
} from "../Services/PTY";
import {
  __terminalManagerShellTesting,
  TerminalManagerRuntime,
  type TerminalSubprocessActivity,
} from "./Manager";
import { Effect, Encoding } from "effect";

const require = createRequire(import.meta.url);
const { Terminal: HeadlessTerminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

/** Renders a serialized replay buffer the way a fresh client xterm would, for assertions. */
function renderHistoryLines(history: string, cols = 100, rows = 24): Promise<string[]> {
  return new Promise((resolve) => {
    const terminal = new HeadlessTerminal({ cols, rows, allowProposedApi: true });
    terminal.write(history, () => {
      const buffer = terminal.buffer.active;
      const lines: string[] = [];
      for (let index = 0; index < buffer.length; index += 1) {
        lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
      }
      terminal.dispose();
      resolve(lines);
    });
  });
}

class FakePtyProcess implements PtyProcess {
  readonly writes: string[] = [];
  readonly resizeCalls: Array<{ cols: number; rows: number }> = [];
  readonly killSignals: Array<string | undefined> = [];
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: PtyExitEvent) => void>();
  killed = false;
  paused = false;

  constructor(readonly pid: number) {}

  write(data: string): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resizeCalls.push({ cols, rows });
  }

  kill(signal?: string): void {
    this.killed = true;
    this.killSignals.push(signal);
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  onData(callback: (data: string) => void): () => void {
    this.dataListeners.add(callback);
    return () => {
      this.dataListeners.delete(callback);
    };
  }

  onExit(callback: (event: PtyExitEvent) => void): () => void {
    this.exitListeners.add(callback);
    return () => {
      this.exitListeners.delete(callback);
    };
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }

  emitExit(event: PtyExitEvent): void {
    for (const listener of this.exitListeners) {
      listener(event);
    }
  }
}

class FakePtyAdapter implements PtyAdapterShape {
  readonly spawnInputs: PtySpawnInput[] = [];
  readonly processes: FakePtyProcess[] = [];
  readonly spawnFailures: Error[] = [];
  private nextPid = 9000;

  constructor(private readonly mode: "sync" | "async" = "sync") {}

  spawn(input: PtySpawnInput): Effect.Effect<PtyProcess, PtySpawnError> {
    this.spawnInputs.push(input);
    const failure = this.spawnFailures.shift();
    if (failure) {
      return Effect.fail(
        new PtySpawnError({
          adapter: "fake",
          message: "Failed to spawn PTY process",
          cause: failure,
        }),
      );
    }
    const process = new FakePtyProcess(this.nextPid++);
    this.processes.push(process);
    if (this.mode === "async") {
      return Effect.tryPromise({
        try: async () => process,
        catch: (cause) =>
          new PtySpawnError({
            adapter: "fake",
            message: "Failed to spawn PTY process",
            cause,
          }),
      });
    }
    return Effect.succeed(process);
  }
}

function waitFor(predicate: () => boolean, timeoutMs = 800): Promise<void> {
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
      setTimeout(poll, 15);
    };
    poll();
  });
}

function openInput(overrides: Partial<TerminalOpenInput> = {}): TerminalOpenInput {
  return {
    threadId: "thread-1",
    cwd: process.cwd(),
    cols: 100,
    rows: 24,
    ...overrides,
  };
}

function restartInput(overrides: Partial<TerminalRestartInput> = {}): TerminalRestartInput {
  return {
    threadId: "thread-1",
    cwd: process.cwd(),
    cols: 100,
    rows: 24,
    ...overrides,
  };
}

function historyLogName(threadId: string): string {
  return `terminal_${Encoding.encodeBase64Url(threadId)}.log`;
}

function multiTerminalHistoryLogName(threadId: string, terminalId: string): string {
  const threadPart = `terminal_${Encoding.encodeBase64Url(threadId)}`;
  if (terminalId === DEFAULT_TERMINAL_ID) {
    return `${threadPart}.log`;
  }
  return `${threadPart}_${Encoding.encodeBase64Url(terminalId)}.log`;
}

function historyLogPath(logsDir: string, threadId = "thread-1"): string {
  return path.join(logsDir, historyLogName(threadId));
}

function multiTerminalHistoryLogPath(
  logsDir: string,
  threadId = "thread-1",
  terminalId = "default",
): string {
  return path.join(logsDir, multiTerminalHistoryLogName(threadId, terminalId));
}

describe("TerminalManager", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefers PowerShell for new Windows terminals before cmd.exe fallbacks", () => {
    const candidates = __terminalManagerShellTesting.resolveShellCandidates(
      () => __terminalManagerShellTesting.windowsDefaultTerminalShell,
      {
        envComSpec: "C:\\Windows\\System32\\cmd.exe",
        platform: "win32",
      },
    );

    expect(candidates.map((candidate) => candidate.shell)).toEqual([
      "powershell.exe",
      "C:\\Windows\\System32\\cmd.exe",
      "cmd.exe",
    ]);
  });

  it("keeps explicit Windows shell requests ahead of PowerShell defaults", () => {
    const candidates = __terminalManagerShellTesting.resolveShellCandidates(() => "pwsh.exe", {
      envComSpec: "C:\\Windows\\System32\\cmd.exe",
      platform: "win32",
    });

    expect(candidates.map((candidate) => candidate.shell)).toEqual([
      "pwsh.exe",
      "C:\\Windows\\System32\\cmd.exe",
      "powershell.exe",
      "cmd.exe",
    ]);
  });

  it("expires a silent managed-agent running state from its hook timestamp", () => {
    const now = 100_000;
    const staleMs = __terminalManagerShellTesting.managedAgentRunningStaleMs;
    type StaleSessionInput = Parameters<
      typeof __terminalManagerShellTesting.managedAgentRunningIsStale
    >[0];

    expect(
      __terminalManagerShellTesting.managedAgentRunningIsStale(
        {
          managedAgentStateUpdatedAt: now - staleMs - 1,
          lastOutputAt: null,
        } as StaleSessionInput,
        now,
      ),
    ).toBe(true);
    expect(
      __terminalManagerShellTesting.managedAgentRunningIsStale(
        {
          managedAgentStateUpdatedAt: now - staleMs + 1,
          lastOutputAt: null,
        } as StaleSessionInput,
        now,
      ),
    ).toBe(false);
  });

  function makeManager(
    historyLineLimit = 5,
    options: {
      shellResolver?: () => string;
      subprocessChecker?: (terminalPid: number) => Promise<boolean | TerminalSubprocessActivity>;
      subprocessPollIntervalMs?: number;
      processKillGraceMs?: number;
      maxRetainedInactiveSessions?: number;
      ptyAdapter?: FakePtyAdapter;
    } = {},
  ) {
    const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-terminal-"));
    tempDirs.push(logsDir);
    const ptyAdapter = options.ptyAdapter ?? new FakePtyAdapter();
    const manager = new TerminalManagerRuntime({
      logsDir,
      ptyAdapter,
      historyLineLimit,
      shellResolver: options.shellResolver ?? (() => "/bin/bash"),
      ...(options.subprocessChecker ? { subprocessChecker: options.subprocessChecker } : {}),
      ...(options.subprocessPollIntervalMs
        ? { subprocessPollIntervalMs: options.subprocessPollIntervalMs }
        : {}),
      ...(options.processKillGraceMs ? { processKillGraceMs: options.processKillGraceMs } : {}),
      ...(options.maxRetainedInactiveSessions
        ? { maxRetainedInactiveSessions: options.maxRetainedInactiveSessions }
        : {}),
    });
    return { logsDir, ptyAdapter, manager };
  }

  it("spawns lazily and reuses running terminal per thread", async () => {
    const { manager, ptyAdapter } = makeManager();
    const [first, second] = await Promise.all([
      manager.open(openInput()),
      manager.open(openInput()),
    ]);
    const third = await manager.open(openInput());

    expect(first.threadId).toBe("thread-1");
    expect(first.terminalId).toBe("default");
    expect(second.threadId).toBe("thread-1");
    expect(third.threadId).toBe("thread-1");
    expect(ptyAdapter.spawnInputs).toHaveLength(1);

    await manager.dispose();
  });

  it("captures a CLI session id and auto-resumes it after a restart", async () => {
    const sessionUuid = "019f1b99-d291-7280-9d1f-1369deafd846";
    const sessionOsc = `\u001b]633;T3CODE_AGENT_SESSION=codex:${sessionUuid}\u0007`;

    const { manager, ptyAdapter, logsDir } = makeManager();
    const metaPath = historyLogPath(logsDir).replace(/\.log$/, ".session.json");

    await manager.open(openInput({ cwd: logsDir }));
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;
    // A managed agent wrapper surfaces its session id over the PTY output stream (ESC ] ... BEL).
    process.emitData(sessionOsc);
    await waitFor(() => fs.existsSync(metaPath));
    expect(JSON.parse(fs.readFileSync(metaPath, "utf8"))).toEqual({
      cliKind: "codex",
      sessionId: sessionUuid,
    });
    await manager.dispose();

    // Simulate an app restart: fresh runtime + PTY, same on-disk logs.
    const ptyAdapter2 = new FakePtyAdapter();
    const manager2 = new TerminalManagerRuntime({
      logsDir,
      ptyAdapter: ptyAdapter2,
      historyLineLimit: 5,
      shellResolver: () => "/bin/bash",
    });
    await manager2.open(openInput({ cwd: logsDir }));
    const resumedProcess = ptyAdapter2.processes[0];
    expect(resumedProcess).toBeDefined();
    if (!resumedProcess) return;
    // The reopened shell prints its prompt; that is when the resume command is injected.
    resumedProcess.emitData("$ ");
    await waitFor(() =>
      resumedProcess.writes.some((write) => write.includes(`codex resume ${sessionUuid}`)),
    );
    await manager2.dispose();
  });

  it("supports asynchronous PTY spawn effects", async () => {
    const { manager, ptyAdapter } = makeManager(5, { ptyAdapter: new FakePtyAdapter("async") });

    const snapshot = await manager.open(openInput());

    expect(snapshot.status).toBe("running");
    expect(ptyAdapter.spawnInputs).toHaveLength(1);
    expect(ptyAdapter.processes).toHaveLength(1);

    await manager.dispose();
  });

  it("forwards write and resize to active pty process", async () => {
    const { manager, ptyAdapter } = makeManager();
    await manager.open(openInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;

    await manager.write({ threadId: "thread-1", data: "ls\n" });
    await manager.resize({ threadId: "thread-1", cols: 120, rows: 30 });

    expect(process.writes).toEqual(["ls\n"]);
    expect(process.resizeCalls).toEqual([{ cols: 120, rows: 30 }]);

    await manager.dispose();
  });

  it("resizes running terminal on open when a different size is requested", async () => {
    const { manager, ptyAdapter } = makeManager();
    await manager.open(openInput({ cols: 100, rows: 24 }));
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;

    await manager.open(openInput({ cols: 140, rows: 40 }));

    expect(process.resizeCalls).toEqual([{ cols: 140, rows: 40 }]);

    await manager.dispose();
  });

  it("keeps a running terminal alive when open reattaches with different cwd or env", async () => {
    const { manager, ptyAdapter, logsDir } = makeManager();
    await manager.open(openInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;

    const snapshot = await manager.open(
      openInput({ cwd: logsDir, env: { FCODE_TERMINAL_TEST: "changed" } }),
    );

    expect(snapshot.cwd).toBe(globalThis.process.cwd());
    expect(snapshot.status).toBe("running");
    expect(process.killSignals).toEqual([]);
    expect(ptyAdapter.spawnInputs).toHaveLength(1);

    await manager.write({ threadId: "thread-1", data: "echo alive\n" });
    expect(process.writes).toContain("echo alive\n");

    await manager.dispose();
  });

  it("preserves existing terminal size on open when size is omitted", async () => {
    const { manager, ptyAdapter } = makeManager();
    await manager.open(openInput({ cols: 100, rows: 24 }));
    const ptyProcess = ptyAdapter.processes[0];
    expect(ptyProcess).toBeDefined();
    if (!ptyProcess) return;

    await manager.open({
      threadId: "thread-1",
      cwd: globalThis.process.cwd(),
    });

    expect(ptyProcess.resizeCalls).toEqual([]);

    ptyProcess.emitExit({ exitCode: 0, signal: 0 });
    await manager.open({
      threadId: "thread-1",
      cwd: globalThis.process.cwd(),
    });

    const resumedSpawn = ptyAdapter.spawnInputs[1];
    expect(resumedSpawn).toBeDefined();
    if (!resumedSpawn) return;
    expect(resumedSpawn.cols).toBe(100);
    expect(resumedSpawn.rows).toBe(24);

    await manager.dispose();
  });

  it("uses default dimensions when opening a new terminal without size hints", async () => {
    const { manager, ptyAdapter } = makeManager();
    await manager.open({
      threadId: "thread-1",
      cwd: process.cwd(),
    });

    const spawned = ptyAdapter.spawnInputs[0];
    expect(spawned).toBeDefined();
    if (!spawned) return;
    expect(spawned.cols).toBe(120);
    expect(spawned.rows).toBe(30);

    await manager.dispose();
  });

  it("supports multiple terminals per thread with isolated sessions", async () => {
    const { manager, ptyAdapter } = makeManager();
    await manager.open(openInput({ terminalId: "default" }));
    await manager.open(openInput({ terminalId: "term-2" }));

    const first = ptyAdapter.processes[0];
    const second = ptyAdapter.processes[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) return;

    await manager.write({ threadId: "thread-1", terminalId: "default", data: "pwd\n" });
    await manager.write({ threadId: "thread-1", terminalId: "term-2", data: "ls\n" });

    expect(first.writes).toEqual(["pwd\n"]);
    expect(second.writes).toEqual(["ls\n"]);
    expect(ptyAdapter.spawnInputs).toHaveLength(2);

    await manager.dispose();
  });

  it("clears transcript and emits cleared event", async () => {
    const { manager, ptyAdapter, logsDir } = makeManager();
    const events: TerminalEvent[] = [];
    manager.on("event", (event) => {
      events.push(event);
    });
    await manager.open(openInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;

    process.emitData("hello\r\n");
    await waitFor(() => fs.existsSync(historyLogPath(logsDir)));
    await manager.clear({ threadId: "thread-1" });
    // clear() is fully awaited above, so the write has already landed; no polling needed.
    // The persisted buffer isn't necessarily the literal empty string (a cleared terminal
    // may retain a cursor-position sequence with no visible text), so check what actually
    // renders rather than the raw bytes.
    const clearedLines = await renderHistoryLines(fs.readFileSync(historyLogPath(logsDir), "utf8"));
    expect(clearedLines.every((line) => line.length === 0)).toBe(true);

    expect(events.some((event) => event.type === "cleared")).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "cleared" &&
          event.threadId === "thread-1" &&
          event.terminalId === "default",
      ),
    ).toBe(true);

    await manager.dispose();
  });

  it("keeps pty reads paused until renderer output ACKs drain", async () => {
    const { manager, ptyAdapter } = makeManager();
    const events: TerminalEvent[] = [];
    manager.on("event", (event) => {
      events.push(event);
    });
    await manager.open(openInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;

    await manager.ackOutput({ threadId: "thread-1", terminalId: "default", bytes: 1 });
    const output = "x".repeat(120_000);
    process.emitData(output);

    await waitFor(() => process.paused);
    expect(
      events.some((event) => event.type === "output" && event.byteLength === output.length),
    ).toBe(true);

    await manager.ackOutput({ threadId: "thread-1", terminalId: "default", bytes: 116_000 });

    expect(process.paused).toBe(false);
    await manager.dispose();
  });

  it("drains output into history without emitting output events when streamOutput is false", async () => {
    const { manager, ptyAdapter, logsDir } = makeManager();
    const events: TerminalEvent[] = [];
    manager.on("event", (event) => {
      events.push(event);
    });
    await manager.open(openInput({ streamOutput: false }));
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;

    process.emitData("dev server listening\n");
    // History is still drained and persisted even though nothing is broadcast.
    await waitFor(() => fs.existsSync(historyLogPath(logsDir)));
    await waitFor(() =>
      fs.readFileSync(historyLogPath(logsDir), "utf8").includes("dev server listening"),
    );

    // No live output event ever reaches the WebSocket fanout for a headless session.
    expect(events.some((event) => event.type === "output")).toBe(false);

    // Re-opening with streamOutput:true flips the session back to live mode (e.g. a
    // log viewer attaching later); omitting the flag would preserve headless mode.
    await manager.open(openInput({ streamOutput: true }));
    process.emitData("after attach\n");
    await waitFor(() => events.some((event) => event.type === "output"));

    await manager.dispose();
  });

  it("resumes ack-paused reads when a renderer reattaches", async () => {
    const { manager, ptyAdapter } = makeManager();
    await manager.open(openInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;

    // Renderer proves ACK support, then a burst pauses reads without draining.
    await manager.ackOutput({ threadId: "thread-1", terminalId: "default", bytes: 1 });
    process.emitData("x".repeat(120_000));
    await waitFor(() => process.paused);

    // Renderer disconnects while paused and reattaches (open on a running session).
    // Without resetting the previous client's ACK accounting the PTY would stay
    // paused forever, since the fresh renderer never ACKs output it never received.
    await manager.open(openInput());

    expect(process.paused).toBe(false);
    await manager.dispose();
  });

  it("includes live terminal mode replay preamble in reattach snapshots", async () => {
    const { manager, ptyAdapter } = makeManager();
    await manager.open(openInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;

    process.emitData("\u001b[?2004h\u001b[?1002h\u001b[>7u");
    const snapshot = await manager.open(openInput());

    expect(snapshot.replayPreamble).toContain("\u001b[?2004h");
    expect(snapshot.replayPreamble).toContain("\u001b[=7;1u");
    expect(snapshot.replayPreamble ?? "").not.toContain("?1002h");

    process.emitData("\u001b[?2004l\u001b[=0;1u");
    const resetSnapshot = await manager.open(openInput());

    expect(resetSnapshot.replayPreamble ?? "").not.toContain("?2004");
    expect(resetSnapshot.replayPreamble ?? "").not.toContain("=7;1u");

    await manager.dispose();
  });

  it("restarts terminal with empty transcript and respawns pty", async () => {
    const { manager, ptyAdapter, logsDir } = makeManager();
    await manager.open(openInput());
    const firstProcess = ptyAdapter.processes[0];
    expect(firstProcess).toBeDefined();
    if (!firstProcess) return;
    firstProcess.emitData("before restart\n");
    await waitFor(() => fs.existsSync(historyLogPath(logsDir)));

    const snapshot = await manager.restart(restartInput());
    expect(snapshot.history).toBe("");
    expect(snapshot.status).toBe("running");
    expect(ptyAdapter.spawnInputs).toHaveLength(2);
    await waitFor(() => fs.readFileSync(historyLogPath(logsDir), "utf8") === "");

    await manager.dispose();
  });

  it("emits exited event and reopens with clean transcript after exit", async () => {
    const { manager, ptyAdapter, logsDir } = makeManager();
    const events: TerminalEvent[] = [];
    manager.on("event", (event) => {
      events.push(event);
    });
    await manager.open(openInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;
    process.emitData("old data\n");
    await waitFor(() => fs.existsSync(historyLogPath(logsDir)));
    process.emitExit({ exitCode: 0, signal: 0 });

    await waitFor(() => events.some((event) => event.type === "exited"));
    const reopened = await manager.open(openInput());

    expect(reopened.history).toBe("");
    expect(ptyAdapter.spawnInputs).toHaveLength(2);
    expect(fs.readFileSync(historyLogPath(logsDir), "utf8")).toBe("");

    await manager.dispose();
  });

  it("ignores trailing writes after terminal exit", async () => {
    const { manager, ptyAdapter } = makeManager();
    await manager.open(openInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;

    process.emitExit({ exitCode: 0, signal: 0 });

    await expect(manager.write({ threadId: "thread-1", data: "\r" })).resolves.toBeUndefined();
    expect(process.writes).toEqual([]);

    await manager.dispose();
  });

  it("emits subprocess activity events when child-process state changes", async () => {
    let hasRunningSubprocess = false;
    const { manager } = makeManager(5, {
      subprocessChecker: async () => hasRunningSubprocess,
      subprocessPollIntervalMs: 20,
    });
    const events: TerminalEvent[] = [];
    manager.on("event", (event) => {
      events.push(event);
    });

    await manager.open(openInput());
    await waitFor(() => events.some((event) => event.type === "started"));
    expect(events.some((event) => event.type === "activity")).toBe(false);

    hasRunningSubprocess = true;
    await waitFor(
      () =>
        events.some((event) => event.type === "activity" && event.hasRunningSubprocess === true),
      1_200,
    );

    hasRunningSubprocess = false;
    await waitFor(
      () =>
        events.some((event) => event.type === "activity" && event.hasRunningSubprocess === false),
      1_200,
    );

    await manager.dispose();
  });

  it("infers live turns for recognized coding-agent CLIs without managed hooks", async () => {
    let subprocessActivity: TerminalSubprocessActivity = {
      cliKind: null,
      hasNonProviderSubprocess: false,
      hasProviderDescendant: false,
      hasRunningSubprocess: false,
    };
    const { manager } = makeManager(5, {
      subprocessChecker: async () => subprocessActivity,
      subprocessPollIntervalMs: 20,
    });
    const events: TerminalEvent[] = [];
    manager.on("event", (event) => {
      events.push(event);
    });

    await manager.open(openInput());
    await manager.write({ threadId: "thread-1", data: "opencode\r" });
    subprocessActivity = {
      cliKind: null,
      hasNonProviderSubprocess: false,
      hasProviderDescendant: true,
      hasRunningSubprocess: true,
    };

    await waitFor(
      () =>
        events.some(
          (event) =>
            event.type === "activity" &&
            event.cliKind === null &&
            event.agentState === "running",
        ),
      1_200,
    );

    subprocessActivity = {
      cliKind: null,
      hasNonProviderSubprocess: false,
      hasProviderDescendant: false,
      hasRunningSubprocess: false,
    };
    await waitFor(
      () =>
        events.some(
          (event) =>
            event.type === "activity" &&
            event.agentState === null &&
            event.hasRunningSubprocess === false,
        ),
      1_200,
    );

    await manager.dispose();
  });

  it("does not brand generic terminals from provider descendants", async () => {
    const { manager } = makeManager(5, {
      subprocessChecker: async () => ({
        cliKind: "codex",
        hasNonProviderSubprocess: true,
        hasProviderDescendant: true,
        hasRunningSubprocess: true,
      }),
      subprocessPollIntervalMs: 20,
    });
    const events: TerminalEvent[] = [];
    manager.on("event", (event) => {
      events.push(event);
    });

    await manager.open(openInput());
    await waitFor(
      () =>
        events.some(
          (event) =>
            event.type === "activity" &&
            event.hasRunningSubprocess === true &&
            event.cliKind === null,
        ),
      1_200,
    );

    expect(events.some((event) => event.type === "activity" && event.cliKind === "codex")).toBe(
      false,
    );
    await manager.dispose();
  });

  it("does not brand generic terminals from provider-looking output", async () => {
    const { manager, ptyAdapter } = makeManager();
    const events: TerminalEvent[] = [];
    manager.on("event", (event) => {
      events.push(event);
    });

    await manager.open(openInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;

    process.emitData("Claude Code v1.2.3 is available in this dev-server log\n");
    await waitFor(() => events.some((event) => event.type === "output"));

    expect(events.some((event) => event.type === "activity" && event.cliKind === "claude")).toBe(
      false,
    );
    await manager.dispose();
  });

  it("clears provider identity when a generic command is submitted", async () => {
    const { manager } = makeManager();
    const events: TerminalEvent[] = [];
    manager.on("event", (event) => {
      events.push(event);
    });

    await manager.open(openInput());
    await manager.write({ threadId: "thread-1", data: "codex\r" });
    expect(events.some((event) => event.type === "activity" && event.cliKind === "codex")).toBe(
      true,
    );

    await manager.write({ threadId: "thread-1", data: "bun run dev\r" });
    expect(events.at(-1)).toMatchObject({
      type: "activity",
      cliKind: null,
    });
    await manager.dispose();
  });

  it("clears unmanaged provider identity as soon as an observed provider process disappears", async () => {
    let subprocessActivity: TerminalSubprocessActivity = {
      cliKind: null,
      hasNonProviderSubprocess: false,
      hasProviderDescendant: false,
      hasRunningSubprocess: false,
    };
    let providerDescendantPolls = 0;
    const { manager } = makeManager(5, {
      subprocessChecker: async () => {
        if (subprocessActivity.hasProviderDescendant) {
          providerDescendantPolls += 1;
        }
        return subprocessActivity;
      },
      subprocessPollIntervalMs: 20,
    });
    const events: TerminalEvent[] = [];
    manager.on("event", (event) => {
      events.push(event);
    });

    await manager.open(openInput());
    await manager.write({ threadId: "thread-1", data: "codex\r" });
    expect(events.some((event) => event.type === "activity" && event.cliKind === "codex")).toBe(
      true,
    );

    subprocessActivity = {
      cliKind: "codex",
      hasNonProviderSubprocess: false,
      hasProviderDescendant: true,
      hasRunningSubprocess: true,
    };
    await waitFor(() => providerDescendantPolls > 0, 1_200);

    subprocessActivity = {
      cliKind: null,
      hasNonProviderSubprocess: false,
      hasProviderDescendant: false,
      hasRunningSubprocess: false,
    };
    await waitFor(
      () =>
        events.some(
          (event) =>
            event.type === "activity" &&
            event.cliKind === null &&
            event.hasRunningSubprocess === false,
        ),
      1_200,
    );

    await manager.dispose();
  });

  it("caps persisted history to configured scrollback", async () => {
    const { manager, ptyAdapter } = makeManager(0);
    await manager.open(openInput({ rows: 5 }));
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;

    process.emitData("line1\r\nline2\r\nline3\r\nline4\r\nline5\r\nline6\r\nline7\r\nline8\r\n");
    await manager.close({ threadId: "thread-1" });

    const reopened = await manager.open(openInput({ rows: 5 }));
    const lines = await renderHistoryLines(reopened.history, 100, 5);
    expect(lines.filter((line) => line.length > 0)).toEqual(["line5", "line6", "line7", "line8"]);

    await manager.dispose();
  });

  it("replays styled output without leaking terminal query/reply noise", async () => {
    const { manager, ptyAdapter } = makeManager();
    await manager.open(openInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;

    process.emitData("prompt ");
    process.emitData(`${ESC}[32mok${ESC}[0m `);
    process.emitData(`${ESC}]11;rgb:ffff/ffff/ffff${BEL}`);
    process.emitData(`${ESC}[1;1R`);
    process.emitData("done\r\n");

    await manager.close({ threadId: "thread-1" });

    const reopened = await manager.open(openInput());
    const lines = await renderHistoryLines(reopened.history);
    expect(lines[0]).toBe("prompt ok done");

    await manager.dispose();
  });

  it("clears the screen instead of preserving text the program erased", async () => {
    const { manager, ptyAdapter } = makeManager();
    await manager.open(openInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;

    process.emitData("before clear\r\n");
    process.emitData(`${ESC}[H${ESC}[2J`);
    process.emitData(`prompt ${ESC}[36mdone${ESC}[0m\r\n`);

    await manager.close({ threadId: "thread-1" });

    const reopened = await manager.open(openInput());
    const lines = await renderHistoryLines(reopened.history);
    // "before clear" was genuinely erased by the program; a faithful replay must not
    // resurrect it (the old hand-sanitized format used to, by dropping the erase).
    expect(lines[0]).toBe("prompt done");

    await manager.dispose();
  });

  it("erases content after cursor save/restore instead of preserving it", async () => {
    const { manager, ptyAdapter } = makeManager();
    await manager.open(openInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;

    process.emitData("instant prompt\r\n");
    process.emitData(`${ESC}7warning output\r\n${ESC}8${ESC}[J`);
    process.emitData(`final prompt ${ESC}[35m❯${ESC}[0m `);

    await manager.close({ threadId: "thread-1" });

    const reopened = await manager.open(openInput());
    const lines = await renderHistoryLines(reopened.history);
    expect(lines[0]).toBe("instant prompt");
    expect(lines[1]).toBe("final prompt ❯ ");

    await manager.dispose();
  });

  it("erases the line instead of preserving text a cursor-move-and-clear wiped", async () => {
    const { manager, ptyAdapter } = makeManager();
    await manager.open(openInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;

    process.emitData("first prompt\r");
    process.emitData(`${ESC}[A${ESC}[H${ESC}[2K`);
    process.emitData(`${ESC}[0m${ESC}[38;5;175m❯${ESC}[0m `);

    await manager.close({ threadId: "thread-1" });

    const reopened = await manager.open(openInput());
    const lines = await renderHistoryLines(reopened.history);
    // The program erased the whole line before drawing the styled prompt; the old
    // sanitizer preserved "first prompt" anyway because it dropped the erase.
    expect(lines[0]).toBe("❯ ");

    await manager.dispose();
  });

  it("parses ESC sequences with intermediate bytes without leaking a stray final byte", async () => {
    const { manager, ptyAdapter } = makeManager();
    await manager.open(openInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;

    process.emitData("before ");
    process.emitData(`${ESC}(B`);
    process.emitData("after\n");

    await manager.close({ threadId: "thread-1" });

    const reopened = await manager.open(openInput());
    const lines = await renderHistoryLines(reopened.history);
    expect(lines[0]).toBe("before after");

    await manager.dispose();
  });

  it("parses chunk-split ESC sequences with intermediate bytes without leaking a stray final byte", async () => {
    const { manager, ptyAdapter } = makeManager();
    await manager.open(openInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;

    process.emitData("before ");
    process.emitData(`${ESC}(`);
    process.emitData("Bafter\n");

    await manager.close({ threadId: "thread-1" });

    const reopened = await manager.open(openInput());
    const lines = await renderHistoryLines(reopened.history);
    expect(lines[0]).toBe("before after");

    await manager.dispose();
  });

  it("deletes history file when close(deleteHistory=true)", async () => {
    const { manager, ptyAdapter, logsDir } = makeManager();
    await manager.open(openInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;
    process.emitData("bye\n");
    await waitFor(() => fs.existsSync(historyLogPath(logsDir)));

    await manager.close({ threadId: "thread-1", deleteHistory: true });
    expect(fs.existsSync(historyLogPath(logsDir))).toBe(false);

    await manager.dispose();
  });

  it("closes all terminals for a thread when close omits terminalId", async () => {
    const { manager, ptyAdapter, logsDir } = makeManager();
    await manager.open(openInput({ terminalId: "default" }));
    await manager.open(openInput({ terminalId: "sidecar" }));
    const defaultProcess = ptyAdapter.processes[0];
    const sidecarProcess = ptyAdapter.processes[1];
    expect(defaultProcess).toBeDefined();
    expect(sidecarProcess).toBeDefined();
    if (!defaultProcess || !sidecarProcess) return;

    defaultProcess.emitData("default\n");
    sidecarProcess.emitData("sidecar\n");
    await waitFor(() => fs.existsSync(multiTerminalHistoryLogPath(logsDir, "thread-1", "default")));
    await waitFor(() => fs.existsSync(multiTerminalHistoryLogPath(logsDir, "thread-1", "sidecar")));

    await manager.close({ threadId: "thread-1", deleteHistory: true });

    expect(defaultProcess.killed).toBe(true);
    expect(sidecarProcess.killed).toBe(true);
    expect(fs.existsSync(multiTerminalHistoryLogPath(logsDir, "thread-1", "default"))).toBe(false);
    expect(fs.existsSync(multiTerminalHistoryLogPath(logsDir, "thread-1", "sidecar"))).toBe(false);

    await manager.dispose();
  });

  it("escalates terminal shutdown to SIGKILL when process does not exit in time", async () => {
    const { manager, ptyAdapter } = makeManager(5, { processKillGraceMs: 10 });
    await manager.open(openInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;

    await manager.close({ threadId: "thread-1" });
    await waitFor(() => process.killSignals.includes("SIGKILL"));

    expect(process.killSignals[0]).toBe("SIGTERM");
    expect(process.killSignals).toContain("SIGKILL");

    await manager.dispose();
  });

  it("cancels SIGKILL escalation when the process exits after SIGTERM", async () => {
    const { manager, ptyAdapter } = makeManager(5, { processKillGraceMs: 30 });
    await manager.open(openInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;

    await manager.close({ threadId: "thread-1" });
    process.emitExit({ exitCode: 0, signal: 15 });
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(process.killSignals[0]).toBe("SIGTERM");
    expect(process.killSignals).not.toContain("SIGKILL");

    await manager.dispose();
  });

  it("evicts oldest inactive terminal sessions when retention limit is exceeded", async () => {
    const { manager, ptyAdapter } = makeManager(5, { maxRetainedInactiveSessions: 1 });

    await manager.open(openInput({ threadId: "thread-1" }));
    await manager.open(openInput({ threadId: "thread-2" }));

    const first = ptyAdapter.processes[0];
    const second = ptyAdapter.processes[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) return;

    first.emitExit({ exitCode: 0, signal: 0 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    second.emitExit({ exitCode: 0, signal: 0 });

    await waitFor(() => {
      const sessions = (manager as unknown as { sessions: Map<string, unknown> }).sessions;
      return sessions.size === 1;
    });

    const sessions = (manager as unknown as { sessions: Map<string, unknown> }).sessions;
    const keys = [...sessions.keys()];
    expect(keys).toEqual(["thread-2\u0000default"]);

    await manager.dispose();
  });

  it("migrates legacy transcript filenames to terminal-scoped history path on open", async () => {
    const { manager, logsDir } = makeManager();
    const legacyPath = path.join(logsDir, "thread-1.log");
    const nextPath = historyLogPath(logsDir);
    fs.writeFileSync(legacyPath, "legacy-line\r\n", "utf8");

    const snapshot = await manager.open(openInput());

    const lines = await renderHistoryLines(snapshot.history);
    expect(lines[0]).toBe("legacy-line");
    expect(fs.existsSync(nextPath)).toBe(true);
    expect(fs.readFileSync(nextPath, "utf8")).toBe("legacy-line\r\n");
    expect(fs.existsSync(legacyPath)).toBe(false);

    await manager.dispose();
  });

  it("retries with fallback shells when preferred shell spawn fails", async () => {
    const { manager, ptyAdapter } = makeManager(5, {
      shellResolver: () => "/definitely/missing-shell -l",
    });
    ptyAdapter.spawnFailures.push(new Error("posix_spawnp failed."));

    const snapshot = await manager.open(openInput());

    expect(snapshot.status).toBe("running");
    expect(ptyAdapter.spawnInputs.length).toBeGreaterThanOrEqual(2);
    expect(ptyAdapter.spawnInputs[0]?.shell).toBe("/definitely/missing-shell");

    if (process.platform === "win32") {
      expect(
        ptyAdapter.spawnInputs.some(
          (input) => input.shell === "cmd.exe" || input.shell === "powershell.exe",
        ),
      ).toBe(true);
    } else {
      expect(
        ptyAdapter.spawnInputs.some((input) =>
          ["/bin/zsh", "/bin/bash", "/bin/sh", "zsh", "bash", "sh"].includes(input.shell),
        ),
      ).toBe(true);
    }

    await manager.dispose();
  });

  it("emits nested PTY spawn failure details", async () => {
    const { manager, ptyAdapter } = makeManager();
    const events: TerminalEvent[] = [];
    manager.on("event", (event) => {
      events.push(event);
    });
    ptyAdapter.spawnFailures.push(new Error("native binding missing"));

    const snapshot = await manager.open(openInput());

    expect(snapshot.status).toBe("error");
    expect(
      events.some(
        (event) =>
          event.type === "error" &&
          event.message === "Failed to spawn PTY process: native binding missing",
      ),
    ).toBe(true);

    await manager.dispose();
  });

  it("filters app runtime env variables from terminal sessions", async () => {
    const originalValues = new Map<string, string | undefined>();
    const setEnv = (key: string, value: string | undefined) => {
      if (!originalValues.has(key)) {
        originalValues.set(key, process.env[key]);
      }
      if (value === undefined) {
        delete process.env[key];
        return;
      }
      process.env[key] = value;
    };
    const restoreEnv = () => {
      for (const [key, value] of originalValues) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    };

    setEnv("PORT", "5173");
    setEnv("T3CODE_PORT", "3773");
    setEnv("VITE_DEV_SERVER_URL", "http://localhost:5173");
    setEnv("TEST_TERMINAL_KEEP", "keep-me");

    try {
      const { manager, ptyAdapter } = makeManager();
      await manager.open(openInput());
      const spawnInput = ptyAdapter.spawnInputs[0];
      expect(spawnInput).toBeDefined();
      if (!spawnInput) return;

      expect(spawnInput.env.PORT).toBeUndefined();
      expect(spawnInput.env.T3CODE_PORT).toBeUndefined();
      expect(spawnInput.env.VITE_DEV_SERVER_URL).toBeUndefined();
      expect(spawnInput.env.TEST_TERMINAL_KEEP).toBe("keep-me");

      await manager.dispose();
    } finally {
      restoreEnv();
    }
  });

  it("pins TERM to the embedded renderer and drops host-terminal identity env", async () => {
    const originalValues = new Map<string, string | undefined>();
    const setEnv = (key: string, value: string) => {
      if (!originalValues.has(key)) {
        originalValues.set(key, process.env[key]);
      }
      process.env[key] = value;
    };
    const restoreEnv = () => {
      for (const [key, value] of originalValues) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    };

    setEnv("TERM", "xterm-ghostty");
    setEnv("TERM_PROGRAM", "ghostty");
    setEnv("TERMINFO", "/Applications/Ghostty.app/Contents/Resources/terminfo");
    setEnv("GHOSTTY_RESOURCES_DIR", "/Applications/Ghostty.app/Contents/Resources");
    setEnv("NO_COLOR", "1");
    setEnv("FORCE_COLOR", "0");
    setEnv("CLICOLOR", "0");
    setEnv("CLICOLOR_FORCE", "0");

    try {
      const { manager, ptyAdapter } = makeManager();
      await manager.open(openInput());
      const spawnInput = ptyAdapter.spawnInputs[0];
      expect(spawnInput).toBeDefined();
      if (!spawnInput) return;

      expect(spawnInput.env.TERM).toBe(
        process.platform === "win32" ? "xterm-color" : "xterm-256color",
      );
      expect(spawnInput.env.TERM_PROGRAM).toBeUndefined();
      expect(spawnInput.env.TERMINFO).toBeUndefined();
      expect(spawnInput.env.GHOSTTY_RESOURCES_DIR).toBeUndefined();
      expect(spawnInput.env.NO_COLOR).toBeUndefined();
      expect(spawnInput.env.FORCE_COLOR).toBeUndefined();
      expect(spawnInput.env.CLICOLOR).toBeUndefined();
      expect(spawnInput.env.CLICOLOR_FORCE).toBeUndefined();
      expect(spawnInput.env.COLORTERM).toBe("truecolor");

      await manager.dispose();
    } finally {
      restoreEnv();
    }
  });

  it("injects runtime env overrides into spawned terminals", async () => {
    const { manager, ptyAdapter } = makeManager();
    await manager.open(
      openInput({
        env: {
          T3CODE_PROJECT_ROOT: "/repo",
          T3CODE_WORKTREE_PATH: "/repo/worktree-a",
          CUSTOM_FLAG: "1",
        },
      }),
    );
    const spawnInput = ptyAdapter.spawnInputs[0];
    expect(spawnInput).toBeDefined();
    if (!spawnInput) return;

    expect(spawnInput.env.T3CODE_PROJECT_ROOT).toBe("/repo");
    expect(spawnInput.env.T3CODE_WORKTREE_PATH).toBe("/repo/worktree-a");
    expect(spawnInput.env.CUSTOM_FLAG).toBe("1");

    await manager.dispose();
  });

  it("starts zsh as a login shell with prompt spacer disabled", async () => {
    if (process.platform === "win32") return;
    const { manager, ptyAdapter } = makeManager(5, {
      shellResolver: () => "/bin/zsh",
    });
    await manager.open(openInput());
    const spawnInput = ptyAdapter.spawnInputs[0];
    expect(spawnInput).toBeDefined();
    if (!spawnInput) return;

    expect(spawnInput.shell).toBe("/bin/zsh");
    expect(spawnInput.args).toEqual(["-l", "-o", "nopromptsp"]);

    await manager.dispose();
  });
});
