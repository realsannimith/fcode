import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  backendEntryFromRuntimeDir,
  cleanupStaleBackendRuntimeCopies,
  ensureBackendRuntimeCopy,
  isBackendRuntimeCopyReady,
  resolveBackendRuntimeDir,
} from "./backendRuntimeCopy";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = FS.mkdtempSync(Path.join(OS.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    FS.rmSync(dir, { recursive: true, force: true });
  }
});

function makeFakeResources(withUnpacked: boolean): string {
  const resources = makeTempDir("fcode-resources-");
  FS.writeFileSync(Path.join(resources, "app.asar"), "fake-asar-bytes");
  if (withUnpacked) {
    const unpacked = Path.join(resources, "app.asar.unpacked", "node_modules", "node-pty");
    FS.mkdirSync(unpacked, { recursive: true });
    FS.writeFileSync(Path.join(unpacked, "spawn-helper"), "fake-helper");
  }
  return resources;
}

describe("resolveBackendRuntimeDir", () => {
  it("nests versions under backend-runtime and defuses path separators", () => {
    expect(resolveBackendRuntimeDir("/data", "0.0.6")).toBe("/data/backend-runtime/0.0.6");
    expect(resolveBackendRuntimeDir("/data", "../evil")).toBe("/data/backend-runtime/.._evil");
  });
});

describe("backendEntryFromRuntimeDir", () => {
  it("mirrors the in-bundle asar entry layout", () => {
    expect(backendEntryFromRuntimeDir("/data/backend-runtime/0.0.6")).toBe(
      "/data/backend-runtime/0.0.6/app.asar/apps/server/dist/index.mjs",
    );
  });
});

describe("ensureBackendRuntimeCopy", () => {
  it("copies app.asar and the unpacked dir, then marks the copy ready", async () => {
    const resources = makeFakeResources(true);
    const userData = makeTempDir("fcode-userdata-");

    const runtimeDir = await ensureBackendRuntimeCopy({
      resourcesPath: resources,
      userDataDir: userData,
      version: "0.0.6",
    });

    expect(runtimeDir).not.toBeNull();
    expect(isBackendRuntimeCopyReady(runtimeDir!)).toBe(true);
    expect(FS.readFileSync(Path.join(runtimeDir!, "app.asar"), "utf8")).toBe("fake-asar-bytes");
    expect(
      FS.existsSync(
        Path.join(runtimeDir!, "app.asar.unpacked", "node_modules", "node-pty", "spawn-helper"),
      ),
    ).toBe(true);
  });

  it("is idempotent once ready", async () => {
    const resources = makeFakeResources(false);
    const userData = makeTempDir("fcode-userdata-");
    const first = await ensureBackendRuntimeCopy({
      resourcesPath: resources,
      userDataDir: userData,
      version: "0.0.6",
    });
    const second = await ensureBackendRuntimeCopy({
      resourcesPath: resources,
      userDataDir: userData,
      version: "0.0.6",
    });
    expect(second).toBe(first);
  });

  it("rebuilds a partial copy that lacks the ready marker", async () => {
    const resources = makeFakeResources(false);
    const userData = makeTempDir("fcode-userdata-");
    const runtimeDir = resolveBackendRuntimeDir(userData, "0.0.6");
    FS.mkdirSync(runtimeDir, { recursive: true });
    FS.writeFileSync(Path.join(runtimeDir, "app.asar"), "stale-partial-copy");

    const result = await ensureBackendRuntimeCopy({
      resourcesPath: resources,
      userDataDir: userData,
      version: "0.0.6",
    });

    expect(result).toBe(runtimeDir);
    expect(FS.readFileSync(Path.join(runtimeDir, "app.asar"), "utf8")).toBe("fake-asar-bytes");
  });

  it("returns null when the source asar is missing", async () => {
    const resources = makeTempDir("fcode-resources-empty-");
    const userData = makeTempDir("fcode-userdata-");
    expect(
      await ensureBackendRuntimeCopy({
        resourcesPath: resources,
        userDataDir: userData,
        version: "0.0.6",
      }),
    ).toBeNull();
  });
});

describe("cleanupStaleBackendRuntimeCopies", () => {
  it("removes versions outside the keep list", async () => {
    const resources = makeFakeResources(false);
    const userData = makeTempDir("fcode-userdata-");
    for (const version of ["0.0.4", "0.0.5", "0.0.6"]) {
      await ensureBackendRuntimeCopy({ resourcesPath: resources, userDataDir: userData, version });
    }

    await cleanupStaleBackendRuntimeCopies(userData, ["0.0.5", "0.0.6"]);

    expect(FS.existsSync(resolveBackendRuntimeDir(userData, "0.0.4"))).toBe(false);
    expect(FS.existsSync(resolveBackendRuntimeDir(userData, "0.0.5"))).toBe(true);
    expect(FS.existsSync(resolveBackendRuntimeDir(userData, "0.0.6"))).toBe(true);
  });
});
