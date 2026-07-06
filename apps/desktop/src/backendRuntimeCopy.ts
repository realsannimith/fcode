// FILE: backendRuntimeCopy.ts
// Purpose: Runs the backend from a per-version copy of app.asar outside the app bundle
//          (userData/backend-runtime/<version>/). An in-place app update swaps the bundle
//          under a running backend; when the backend executes from inside that bundle its
//          lazy module loads suddenly resolve into the NEW version's files (asar offsets,
//          native binaries) — version-mixing crashes. Executing from a copy makes bundle
//          swaps invisible to the running backend, which is what lets sessions survive
//          updates (CMux-style: the UI restarts, the server keeps running).
// Layer: Desktop backend runtime
// Exports: path helpers, ensureBackendRuntimeCopy, cleanupStaleBackendRuntimeCopies

import * as FS from "node:fs";
import * as Path from "node:path";

const RUNTIME_COPY_ROOT_DIRNAME = "backend-runtime";
// Marker written after a complete copy so a crash mid-copy is never mistaken for a
// usable runtime. Its presence is the only "copy is valid" signal.
const RUNTIME_COPY_READY_MARKER = ".copy-complete";

export function resolveBackendRuntimeRoot(userDataDir: string): string {
  return Path.join(userDataDir, RUNTIME_COPY_ROOT_DIRNAME);
}

export function resolveBackendRuntimeDir(userDataDir: string, version: string): string {
  // Versions are semver-like ("0.0.6"); keep the path defensive against separators anyway.
  return Path.join(resolveBackendRuntimeRoot(userDataDir), version.replaceAll(/[\\/]/g, "_"));
}

/** Entry path of the backend inside a runtime copy (mirrors the in-bundle asar layout). */
export function backendEntryFromRuntimeDir(runtimeDir: string): string {
  return Path.join(runtimeDir, "app.asar", "apps", "server", "dist", "index.mjs");
}

export function isBackendRuntimeCopyReady(runtimeDir: string): boolean {
  return (
    FS.existsSync(Path.join(runtimeDir, RUNTIME_COPY_READY_MARKER)) &&
    FS.existsSync(Path.join(runtimeDir, "app.asar"))
  );
}

/**
 * Ensures userData/backend-runtime/<version>/ holds app.asar (+ app.asar.unpacked for
 * node-pty binaries). Returns the runtime dir, or null when the copy cannot be produced —
 * callers then fall back to running the backend from inside the bundle (previous behavior).
 */
export async function ensureBackendRuntimeCopy(args: {
  readonly resourcesPath: string;
  readonly userDataDir: string;
  readonly version: string;
}): Promise<string | null> {
  const runtimeDir = resolveBackendRuntimeDir(args.userDataDir, args.version);
  try {
    if (isBackendRuntimeCopyReady(runtimeDir)) {
      return runtimeDir;
    }

    const sourceAsar = Path.join(args.resourcesPath, "app.asar");
    if (!FS.existsSync(sourceAsar)) {
      return null;
    }

    // Rebuild from scratch: a partial dir without the marker is unusable.
    await FS.promises.rm(runtimeDir, { recursive: true, force: true });
    await FS.promises.mkdir(runtimeDir, { recursive: true });
    await FS.promises.copyFile(sourceAsar, Path.join(runtimeDir, "app.asar"));

    const sourceUnpacked = Path.join(args.resourcesPath, "app.asar.unpacked");
    if (FS.existsSync(sourceUnpacked)) {
      await FS.promises.cp(sourceUnpacked, Path.join(runtimeDir, "app.asar.unpacked"), {
        recursive: true,
      });
    }

    await FS.promises.writeFile(Path.join(runtimeDir, RUNTIME_COPY_READY_MARKER), "");
    return runtimeDir;
  } catch {
    // Best-effort: never block startup on the copy; the in-bundle fallback still works.
    await FS.promises.rm(runtimeDir, { recursive: true, force: true }).catch(() => {});
    return null;
  }
}

/** Removes runtime copies for versions not in keepVersions (best-effort). */
export async function cleanupStaleBackendRuntimeCopies(
  userDataDir: string,
  keepVersions: readonly string[],
): Promise<void> {
  const root = resolveBackendRuntimeRoot(userDataDir);
  const keep = new Set(
    keepVersions.map((version) => Path.basename(resolveBackendRuntimeDir(userDataDir, version))),
  );
  let entries: string[];
  try {
    entries = await FS.promises.readdir(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (keep.has(entry)) continue;
    await FS.promises.rm(Path.join(root, entry), { recursive: true, force: true }).catch(() => {});
  }
}
