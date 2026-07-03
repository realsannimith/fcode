import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "vitest";

import { discoverRepositories } from "./discoverRepositories.ts";

let root: string;

function makeRepo(...segments: string[]): string {
  const repoPath = join(root, ...segments);
  mkdirSync(join(repoPath, ".git"), { recursive: true });
  return repoPath;
}

function makeDir(...segments: string[]): string {
  const dirPath = join(root, ...segments);
  mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "discover-repos-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("discoverRepositories", () => {
  it("returns just the root when the root itself is a repo", () => {
    mkdirSync(join(root, ".git"), { recursive: true });
    makeRepo("frontend"); // nested repos must be ignored when root is a repo

    const result = discoverRepositories(root);

    assert.equal(result.rootIsRepo, true);
    assert.equal(result.repositories.length, 1);
    assert.equal(result.repositories[0]?.path, root);
    assert.equal(result.repositories[0]?.relativePath, "");
  });

  it("discovers sibling repos under a non-repo container folder", () => {
    const frontend = makeRepo("frontend");
    const backend = makeRepo("backend");

    const result = discoverRepositories(root);

    assert.equal(result.rootIsRepo, false);
    const paths = result.repositories.map((r) => r.path);
    assert.deepEqual(paths.toSorted(), [backend, frontend].toSorted());
    const byName = new Map(result.repositories.map((r) => [r.name, r]));
    assert.equal(byName.get("frontend")?.relativePath, "frontend");
    assert.equal(byName.get("backend")?.relativePath, "backend");
  });

  it("finds repos one level deeper (e.g. apps/web)", () => {
    const web = makeRepo("apps", "web");
    makeDir("apps", "empty");

    const result = discoverRepositories(root, { maxDepth: 2 });

    assert.equal(result.repositories.length, 1);
    assert.equal(result.repositories[0]?.path, web);
    assert.equal(result.repositories[0]?.relativePath, join("apps", "web"));
  });

  it("respects maxDepth and does not find repos that are too deep", () => {
    makeRepo("a", "b", "deep");

    const shallow = discoverRepositories(root, { maxDepth: 1 });
    assert.equal(shallow.repositories.length, 0);

    const deeper = discoverRepositories(root, { maxDepth: 3 });
    assert.equal(deeper.repositories.length, 1);
  });

  it("does not descend into a repo to find nested repos", () => {
    const outer = makeRepo("outer");
    makeRepo("outer", "inner"); // submodule-like nested repo

    const result = discoverRepositories(root, { maxDepth: 3 });

    assert.equal(result.repositories.length, 1);
    assert.equal(result.repositories[0]?.path, outer);
  });

  it("skips ignored directories like node_modules", () => {
    makeRepo("node_modules", "some-package");
    const real = makeRepo("service");

    const result = discoverRepositories(root, { maxDepth: 3 });

    assert.equal(result.repositories.length, 1);
    assert.equal(result.repositories[0]?.path, real);
  });

  it("returns no repositories for an empty non-repo folder", () => {
    const result = discoverRepositories(root);
    assert.equal(result.rootIsRepo, false);
    assert.equal(result.repositories.length, 0);
  });
});
