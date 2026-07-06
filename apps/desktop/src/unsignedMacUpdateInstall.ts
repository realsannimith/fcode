// FILE: unsignedMacUpdateInstall.ts
// Purpose: Direct macOS update install for unsigned/ad-hoc builds. Squirrel.Mac (the backend
//          behind autoUpdater.quitAndInstall) refuses apps without a valid Developer ID
//          signature, so unsigned builds could detect and download updates but never install
//          them. This module swaps the .app bundle directly instead: extract the (already
//          sha512-verified) update zip with ditto, strip quarantine, then hand replacement to
//          a detached shell script that waits for the app to quit, moves the new bundle into
//          place, and relaunches. Signed builds keep using Squirrel untouched.
// Layer: Desktop update runtime
// Exports: signature-state detection, install-script builder, and the direct installer.

import * as ChildProcess from "node:child_process";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

export interface MacCodesignProbe {
  readonly exitCode: number;
  readonly output: string;
}

/**
 * Squirrel.Mac only works when the running app carries a real identity signature (a team
 * identifier). Unsigned bundles ("not signed at all") and ad-hoc signatures (electron-builder's
 * default when no identity is configured; `Signature=adhoc`, `TeamIdentifier=not set`) both
 * fail Squirrel's validation, so those installs must go through the direct bundle swap.
 */
export function shouldUseDirectMacInstall(probe: MacCodesignProbe): boolean {
  if (probe.exitCode !== 0) return true;
  if (/code object is not signed at all/i.test(probe.output)) return true;
  if (/^Signature=adhoc$/m.test(probe.output)) return true;
  if (/^TeamIdentifier=not set$/m.test(probe.output)) return true;
  return false;
}

/** Runs `codesign -dv` against the app bundle; never throws (missing codesign → direct path). */
export function probeMacAppSignature(appBundlePath: string): MacCodesignProbe {
  try {
    const result = ChildProcess.spawnSync("codesign", ["-dv", "--verbose=4", appBundlePath], {
      encoding: "utf8",
      timeout: 10_000,
    });
    return {
      exitCode: result.status ?? 1,
      // codesign writes its details to stderr.
      output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    };
  } catch {
    return { exitCode: 1, output: "" };
  }
}

/** Resolves the running .app bundle root from the executable path, or null outside a bundle. */
export function resolveMacAppBundlePath(execPath: string): string | null {
  // .../FCode.app/Contents/MacOS/FCode → .../FCode.app
  const bundlePath = Path.resolve(execPath, "..", "..", "..");
  return bundlePath.endsWith(".app") ? bundlePath : null;
}

/** Picks the single top-level .app entry of the extracted update, or null when ambiguous. */
export function resolveSingleTopLevelAppBundle(entries: readonly string[]): string | null {
  const appBundles = entries.filter((entry) => entry.endsWith(".app"));
  return appBundles.length === 1 ? (appBundles[0] ?? null) : null;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Builds the detached installer script. It waits (bounded) for the app process to exit, moves
 * the old bundle aside, moves the new bundle into place, and relaunches. Any failure restores
 * the old bundle so the user is never left without an app. Deliberately plain bash with no
 * `set -e`: every step has an explicit fallback.
 */
export function buildDirectMacInstallScript(args: {
  readonly pid: number;
  readonly appBundlePath: string;
  readonly stagedAppPath: string;
  readonly backupPath: string;
}): string {
  const app = shellQuote(args.appBundlePath);
  const staged = shellQuote(args.stagedAppPath);
  const backup = shellQuote(args.backupPath);
  return [
    "#!/bin/bash",
    "# FCode direct update installer (unsigned build). Generated at install time.",
    `for _ in $(seq 1 300); do`,
    `  kill -0 ${args.pid} 2>/dev/null || break`,
    "  sleep 0.2",
    "done",
    `if kill -0 ${args.pid} 2>/dev/null; then`,
    "  # App never exited; abort without touching the live bundle.",
    "  exit 1",
    "fi",
    `if ! mv ${app} ${backup}; then`,
    "  exit 1",
    "fi",
    `if mv ${staged} ${app}; then`,
    `  rm -rf ${backup}`,
    "else",
    "  # Swap failed: restore the previous bundle.",
    `  mv ${backup} ${app}`,
    "fi",
    `open ${app}`,
    "",
  ].join("\n");
}

export interface DirectMacInstallInput {
  readonly zipPath: string;
  readonly appBundlePath: string;
  readonly pid: number;
}

/**
 * Prepares the direct install and spawns the detached swap script. On return the caller must
 * quit the app; the script performs the swap once the process exits. Throws with a
 * human-readable message when preparation fails (nothing has been touched at that point —
 * the running bundle is only moved by the script, after quit).
 */
export function prepareDirectMacInstall(input: DirectMacInstallInput): void {
  if (!FS.existsSync(input.zipPath)) {
    throw new Error(`Update archive is missing at ${input.zipPath}.`);
  }

  const stageDir = FS.mkdtempSync(Path.join(OS.tmpdir(), "fcode-direct-update-"));

  // ditto preserves the symlinked framework structure inside the bundle; plain unzip does not.
  const extraction = ChildProcess.spawnSync("ditto", ["-x", "-k", input.zipPath, stageDir], {
    encoding: "utf8",
    timeout: 5 * 60_000,
  });
  if (extraction.status !== 0) {
    throw new Error(
      `Could not extract the update archive (ditto exited ${extraction.status ?? "null"}): ${(extraction.stderr ?? "").trim()}`,
    );
  }

  const stagedAppName = resolveSingleTopLevelAppBundle(FS.readdirSync(stageDir));
  if (!stagedAppName) {
    throw new Error("Update archive did not contain exactly one .app bundle.");
  }
  const stagedAppPath = Path.join(stageDir, stagedAppName);

  // Downloaded payloads carry the quarantine attribute; without stripping it Gatekeeper
  // reports the swapped-in app as damaged. Best-effort: the attribute may be absent.
  ChildProcess.spawnSync("xattr", ["-dr", "com.apple.quarantine", stagedAppPath], {
    timeout: 60_000,
  });

  const script = buildDirectMacInstallScript({
    pid: input.pid,
    appBundlePath: input.appBundlePath,
    stagedAppPath,
    backupPath: Path.join(stageDir, "previous-bundle.app"),
  });
  const scriptPath = Path.join(stageDir, "install.sh");
  FS.writeFileSync(scriptPath, script, { mode: 0o700 });

  const child = ChildProcess.spawn("/bin/bash", [scriptPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
