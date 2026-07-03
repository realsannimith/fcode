import { describe, expect, it } from "vitest";

import {
  WORKTREE_BRANCH_PREFIX,
  buildFCodeBranchName,
  buildTemporaryWorktreeBranchName,
  isTemporaryWorktreeBranch,
  resolveUniqueFCodeBranchName,
  resolveThreadBranchRegressionGuard,
} from "./git";

describe("isTemporaryWorktreeBranch", () => {
  it("matches generated temporary worktree branches", () => {
    expect(isTemporaryWorktreeBranch(buildTemporaryWorktreeBranchName())).toBe(true);
  });

  it("matches generated temporary worktree branches", () => {
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/deadbeef`)).toBe(true);
    expect(isTemporaryWorktreeBranch(` ${WORKTREE_BRANCH_PREFIX}/DEADBEEF `)).toBe(true);
  });

  it("keeps recognizing legacy temporary worktree branches", () => {
    expect(isTemporaryWorktreeBranch("dpcode/deadbeef")).toBe(true);
    expect(isTemporaryWorktreeBranch("t3code/deadbeef")).toBe(true);
  });

  it("rejects semantic branch names", () => {
    expect(isTemporaryWorktreeBranch(`${WORKTREE_BRANCH_PREFIX}/feature/demo`)).toBe(false);
    expect(isTemporaryWorktreeBranch("feature/demo")).toBe(false);
  });
});

describe("resolveThreadBranchRegressionGuard", () => {
  it("keeps a semantic branch when the next branch is only a temporary worktree placeholder", () => {
    expect(
      resolveThreadBranchRegressionGuard({
        currentBranch: "feature/semantic-branch",
        nextBranch: `${WORKTREE_BRANCH_PREFIX}/deadbeef`,
      }),
    ).toBe("feature/semantic-branch");
  });

  it("accepts real branch changes", () => {
    expect(
      resolveThreadBranchRegressionGuard({
        currentBranch: "feature/old",
        nextBranch: "feature/new",
      }),
    ).toBe("feature/new");
  });

  it("allows clearing the branch", () => {
    expect(
      resolveThreadBranchRegressionGuard({
        currentBranch: "feature/old",
        nextBranch: null,
      }),
    ).toBeNull();
  });
});

describe("buildFCodeBranchName", () => {
  it("uses fcode as the branch namespace", () => {
    expect(buildFCodeBranchName("fix toast copy")).toBe("fcode/fix-toast-copy");
  });

  it("keeps non-FCode namespaces inside the FCode branch", () => {
    expect(buildFCodeBranchName("feature/refine-toolbar-actions")).toBe(
      "fcode/feature/refine-toolbar-actions",
    );
  });

  it("normalizes legacy prefixes before rebuilding the branch", () => {
    expect(buildFCodeBranchName("t3code/refine toolbar actions")).toBe(
      "fcode/refine-toolbar-actions",
    );
    expect(buildFCodeBranchName("dpcode/refine toolbar actions")).toBe(
      "fcode/refine-toolbar-actions",
    );
  });

  it("falls back to fcode/update when no preferred name is provided", () => {
    expect(buildFCodeBranchName()).toBe("fcode/update");
  });
});

describe("resolveUniqueFCodeBranchName", () => {
  it("increments suffix when the FCode branch already exists", () => {
    expect(
      resolveUniqueFCodeBranchName(
        ["main", "fcode/fix-toast-copy", "fcode/fix-toast-copy-2"],
        "fix toast copy",
      ),
    ).toBe("fcode/fix-toast-copy-3");
  });
});
