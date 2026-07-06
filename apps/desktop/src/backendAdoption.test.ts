import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  clearBackendAdoptionRecord,
  isProcessAlive,
  parseBackendAdoptionRecord,
  readBackendAdoptionRecord,
  resolveBackendAdoptionFilePath,
  writeBackendAdoptionRecord,
  type BackendAdoptionRecord,
} from "./backendAdoption";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = FS.mkdtempSync(Path.join(OS.tmpdir(), "fcode-adoption-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    FS.rmSync(dir, { recursive: true, force: true });
  }
});

const validRecord: BackendAdoptionRecord = {
  pid: 4242,
  port: 3773,
  token: "a".repeat(48),
  version: "0.0.6",
  startedAt: "2026-07-06T00:00:00.000Z",
};

describe("parseBackendAdoptionRecord", () => {
  it("accepts a well-formed record", () => {
    expect(parseBackendAdoptionRecord(JSON.stringify(validRecord))).toEqual(validRecord);
  });

  it.each([
    ["malformed json", "{"],
    ["null", "null"],
    ["pid zero", JSON.stringify({ ...validRecord, pid: 0 })],
    ["pid fractional", JSON.stringify({ ...validRecord, pid: 1.5 })],
    ["port out of range", JSON.stringify({ ...validRecord, port: 99_999 })],
    ["token too short", JSON.stringify({ ...validRecord, token: "short" })],
    ["missing version", JSON.stringify({ ...validRecord, version: "" })],
  ])("rejects %s", (_label, raw) => {
    expect(parseBackendAdoptionRecord(raw)).toBeNull();
  });
});

describe("record file IO", () => {
  it("round-trips through the userData file with owner-only permissions", () => {
    const userData = makeTempDir();
    writeBackendAdoptionRecord(userData, validRecord);

    expect(readBackendAdoptionRecord(userData)).toEqual(validRecord);
    if (process.platform !== "win32") {
      const mode = FS.statSync(resolveBackendAdoptionFilePath(userData)).mode & 0o777;
      expect(mode).toBe(0o600);
    }

    clearBackendAdoptionRecord(userData);
    expect(readBackendAdoptionRecord(userData)).toBeNull();
  });

  it("returns null when no record exists", () => {
    expect(readBackendAdoptionRecord(makeTempDir())).toBeNull();
  });
});

describe("isProcessAlive", () => {
  it("is true for the current process and false for an unlikely pid", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    // Upper end of typical pid ranges; if it happens to exist the assertion is skipped.
    const unlikelyPid = 999_999;
    try {
      process.kill(unlikelyPid, 0);
    } catch {
      expect(isProcessAlive(unlikelyPid)).toBe(false);
    }
  });
});
