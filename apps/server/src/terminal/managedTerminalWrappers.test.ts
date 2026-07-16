import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { prepareManagedTerminalAgentWrappers } from "./managedTerminalWrappers";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("prepareManagedTerminalAgentWrappers", () => {
  it("keeps the native Codex login and config in the managed hook overlay", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "fcode-terminal-wrappers-"));
    temporaryDirectories.push(rootDir);
    const sourceHomeDir = path.join(rootDir, "source-codex-home");
    const executableDir = path.join(rootDir, "bin");
    const wrapperDir = path.join(rootDir, "wrappers");
    fs.mkdirSync(sourceHomeDir, { recursive: true });
    fs.mkdirSync(executableDir, { recursive: true });
    fs.writeFileSync(path.join(sourceHomeDir, "auth.json"), "{}\n", { mode: 0o600 });
    fs.writeFileSync(path.join(sourceHomeDir, "config.toml"), 'model = "gpt-test"\n');
    fs.writeFileSync(path.join(sourceHomeDir, "hooks.json"), '{"user":true}\n');
    fs.writeFileSync(path.join(executableDir, "codex"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    const prepared = prepareManagedTerminalAgentWrappers({
      baseEnv: {
        CODEX_HOME: sourceHomeDir,
        HOME: rootDir,
        PATH: executableDir,
      },
      targetDir: wrapperDir,
      zshDir: path.join(rootDir, "zsh"),
    });

    expect(prepared.codexHomeDir).toBe(path.join(wrapperDir, "codex-home"));
    expect(fs.realpathSync(path.join(wrapperDir, "codex-home", "auth.json"))).toBe(
      fs.realpathSync(path.join(sourceHomeDir, "auth.json")),
    );
    expect(fs.realpathSync(path.join(wrapperDir, "codex-home", "config.toml"))).toBe(
      fs.realpathSync(path.join(sourceHomeDir, "config.toml")),
    );
    expect(fs.lstatSync(path.join(wrapperDir, "codex-home", "hooks.json")).isSymbolicLink()).toBe(
      false,
    );
    expect(fs.readFileSync(path.join(wrapperDir, "codex-home", "hooks.json"), "utf8")).not.toBe(
      '{"user":true}\n',
    );
    expect(fs.readFileSync(path.join(wrapperDir, "codex"), "utf8")).toContain(
      "--dangerously-bypass-hook-trust",
    );
  });
});
