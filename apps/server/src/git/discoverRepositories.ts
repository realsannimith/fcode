/**
 * discoverRepositories - Detect git repositories under a project workspace root.
 *
 * A project's `workspaceRoot` is normally a single git repository. Some users
 * instead open a *container* folder (e.g. `pk/`) that is not itself a repo but
 * holds several independent repos side by side (`pk/frontend`, `pk/backend`),
 * each with its own `.git`. This module surfaces those nested repos so the app
 * can show them and drive multi-repo actions (e.g. commit-all).
 *
 * Detection is intentionally shallow and bounded for predictable performance:
 * we never descend into a directory that is itself a repo, we skip heavy build
 * / dependency directories, and we cap both depth and the number of results.
 *
 * @module discoverRepositories
 */
import { type Dirent, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";

import { isGitRepository } from "./isRepo.ts";

export interface DiscoveredRepository {
  /** Absolute path to the repository root. */
  readonly path: string;
  /** Directory name of the repository (e.g. `frontend`). */
  readonly name: string;
  /** Path relative to the scanned workspace root; empty string when it *is* the root. */
  readonly relativePath: string;
}

export interface DiscoverRepositoriesResult {
  /** Whether the scanned root path is itself a git repository. */
  readonly rootIsRepo: boolean;
  /** Repositories discovered at or beneath the root, in stable path order. */
  readonly repositories: ReadonlyArray<DiscoveredRepository>;
}

export interface DiscoverRepositoriesOptions {
  /** How many directory levels below the root to scan for nested repos. */
  readonly maxDepth?: number | undefined;
}

const DEFAULT_MAX_DEPTH = 2;
const MAX_DEPTH_LIMIT = 4;
const MAX_REPOSITORIES = 100;

// Directories that never contain a project-level repo worth surfacing and are
// expensive to walk. Skipping them keeps the scan cheap on large workspaces.
const IGNORED_DIRECTORY_NAMES = new Set<string>([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "coverage",
  "target",
  "vendor",
  "venv",
  ".venv",
  "__pycache__",
  ".idea",
  ".vscode",
  ".gradle",
  "Pods",
]);

function clampDepth(maxDepth: number | undefined): number {
  if (maxDepth === undefined || Number.isNaN(maxDepth)) return DEFAULT_MAX_DEPTH;
  return Math.min(MAX_DEPTH_LIMIT, Math.max(1, Math.floor(maxDepth)));
}

/**
 * Discover git repositories at or beneath `rootCwd`.
 *
 * Behavior is deliberately split by whether the root is itself a repo:
 * - Root **is** a repo → return just the root. This exactly preserves the
 *   existing single-repo experience and avoids surfacing incidental nested
 *   repos (submodules, vendored checkouts, worktrees).
 * - Root is **not** a repo → scan children up to `maxDepth` and return every
 *   nested repo found. A directory that is a repo is recorded and not descended
 *   into, so only the outermost repo on each branch is reported.
 */
export function discoverRepositories(
  rootCwd: string,
  options: DiscoverRepositoriesOptions = {},
): DiscoverRepositoriesResult {
  const rootIsRepo = isGitRepository(rootCwd);
  if (rootIsRepo) {
    return {
      rootIsRepo: true,
      repositories: [{ path: rootCwd, name: basename(rootCwd) || rootCwd, relativePath: "" }],
    };
  }

  const maxDepth = clampDepth(options.maxDepth);
  const repositories: DiscoveredRepository[] = [];

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    if (repositories.length >= MAX_REPOSITORIES) return;

    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // Unreadable directory (permissions, races) — skip it rather than fail.
      return;
    }

    // Sort for deterministic output regardless of filesystem ordering.
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith(".") && !IGNORED_DIRECTORY_NAMES.has(name))
      .toSorted();

    for (const name of directories) {
      if (repositories.length >= MAX_REPOSITORIES) return;
      const childPath = join(dir, name);
      if (isGitRepository(childPath)) {
        repositories.push({
          path: childPath,
          name,
          relativePath: relative(rootCwd, childPath),
        });
        continue; // Do not descend into a repo.
      }
      walk(childPath, depth + 1);
    }
  };

  walk(rootCwd, 1);

  return { rootIsRepo: false, repositories };
}
