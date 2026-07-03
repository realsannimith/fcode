// FILE: electron-builder-after-sign.cjs
// Purpose: Re-signs the packaged macOS app with a full deep ad-hoc signature when the build has
// no real Developer ID certificate configured.
// Layer: Build hook
// Depends on: electron-builder afterSign hook context and the local codesign toolchain.

const { existsSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

// electron-builder's own ad-hoc fallback (no CSC_* configured) can leave hardened-runtime
// entitlements applied without deep-sealing nested resources. macOS then reports "code has no
// resources but signature indicates they must be present", and Gatekeeper shows "app is
// damaged" instead of the normal, bypassable "unidentified developer" warning once the app
// crosses a quarantine boundary (download, AirDrop, etc.) on another Mac. A fresh deep ad-hoc
// signature — applied here, before electron-builder creates the dmg/zip targets — fixes that.
exports.default = async function afterSign(context) {
  if (process.env.T3CODE_DESKTOP_UNSIGNED_DEEP_RESIGN !== "true") {
    return;
  }

  const appOutDir = typeof context?.appOutDir === "string" ? context.appOutDir : "";
  if (!appOutDir) {
    return;
  }

  const productFilename = context?.packager?.appInfo?.productFilename;
  const preferredBundlePath =
    typeof productFilename === "string" ? join(appOutDir, `${productFilename}.app`) : null;
  const appBundlePath =
    preferredBundlePath && existsSync(preferredBundlePath)
      ? preferredBundlePath
      : readdirSync(appOutDir)
          .filter((entry) => entry.endsWith(".app"))
          .map((entry) => join(appOutDir, entry))[0];

  if (!appBundlePath || !existsSync(appBundlePath)) {
    throw new Error(`Could not find packaged macOS app bundle inside ${appOutDir}`);
  }

  const result = spawnSync("codesign", ["--force", "--deep", "--sign", "-", appBundlePath], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `Failed to re-sign ${appBundlePath} with a deep ad-hoc signature: ${result.stderr || result.stdout}`.trim(),
    );
  }
};
