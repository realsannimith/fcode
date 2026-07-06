import { describe, expect, it } from "vitest";

import {
  buildDirectMacInstallScript,
  resolveMacAppBundlePath,
  resolveSingleTopLevelAppBundle,
  shouldUseDirectMacInstall,
} from "./unsignedMacUpdateInstall";

describe("shouldUseDirectMacInstall", () => {
  it("uses the direct path when the bundle is not signed at all", () => {
    expect(
      shouldUseDirectMacInstall({
        exitCode: 1,
        output: "FCode.app: code object is not signed at all",
      }),
    ).toBe(true);
  });

  it("uses the direct path for ad-hoc signatures (electron-builder default without identity)", () => {
    expect(
      shouldUseDirectMacInstall({
        exitCode: 0,
        output: [
          "Executable=/Applications/FCode.app/Contents/MacOS/FCode",
          "Identifier=com.t3tools.fcode",
          "Signature=adhoc",
          "TeamIdentifier=not set",
        ].join("\n"),
      }),
    ).toBe(true);
  });

  it("keeps Squirrel for a real Developer ID signature", () => {
    expect(
      shouldUseDirectMacInstall({
        exitCode: 0,
        output: [
          "Executable=/Applications/FCode.app/Contents/MacOS/FCode",
          "Identifier=com.t3tools.fcode",
          "Authority=Developer ID Application: Example Corp (ABCDE12345)",
          "TeamIdentifier=ABCDE12345",
        ].join("\n"),
      }),
    ).toBe(false);
  });

  it("uses the direct path when codesign itself fails", () => {
    expect(shouldUseDirectMacInstall({ exitCode: 1, output: "" })).toBe(true);
  });
});

describe("resolveMacAppBundlePath", () => {
  it("resolves the bundle root from the executable path", () => {
    expect(resolveMacAppBundlePath("/Applications/FCode.app/Contents/MacOS/FCode")).toBe(
      "/Applications/FCode.app",
    );
  });

  it("returns null outside an .app bundle", () => {
    expect(resolveMacAppBundlePath("/usr/local/bin/fcode")).toBeNull();
  });
});

describe("resolveSingleTopLevelAppBundle", () => {
  it("picks the single .app entry", () => {
    expect(resolveSingleTopLevelAppBundle(["FCode.app", "__MACOSX"])).toBe("FCode.app");
  });

  it("returns null when no or multiple .app entries exist", () => {
    expect(resolveSingleTopLevelAppBundle(["readme.txt"])).toBeNull();
    expect(resolveSingleTopLevelAppBundle(["A.app", "B.app"])).toBeNull();
  });
});

describe("buildDirectMacInstallScript", () => {
  const script = buildDirectMacInstallScript({
    pid: 4242,
    appBundlePath: "/Applications/FCode.app",
    stagedAppPath: "/tmp/fcode-direct-update-x/FCode.app",
    backupPath: "/tmp/fcode-direct-update-x/previous-bundle.app",
  });

  it("waits for the app process to exit before touching the bundle", () => {
    expect(script).toContain("kill -0 4242");
    // Bounded wait: aborts rather than swapping under a live app.
    expect(script).toContain("exit 1");
  });

  it("swaps the bundle and restores the backup when the swap fails", () => {
    expect(script).toContain("mv '/tmp/fcode-direct-update-x/FCode.app' '/Applications/FCode.app'");
    expect(script).toContain(
      "mv '/tmp/fcode-direct-update-x/previous-bundle.app' '/Applications/FCode.app'",
    );
    expect(script).toContain("open '/Applications/FCode.app'");
  });

  it("quotes paths containing spaces and single quotes", () => {
    const trickyScript = buildDirectMacInstallScript({
      pid: 1,
      appBundlePath: "/Applications/My App's Folder/FCode.app",
      stagedAppPath: "/tmp/stage/FCode.app",
      backupPath: "/tmp/stage/previous-bundle.app",
    });
    expect(trickyScript).toContain(`'/Applications/My App'\\''s Folder/FCode.app'`);
  });
});
