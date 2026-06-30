import { describe, expect, it } from "vitest";

import {
  WORKTREE_BRANCH_PREFIX,
  buildCTCodeBranchName,
  buildTemporaryWorktreeBranchName,
  isTemporaryWorktreeBranch,
  resolveUniqueCTCodeBranchName,
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

describe("buildCTCodeBranchName", () => {
  it("uses ctcode as the branch namespace", () => {
    expect(buildCTCodeBranchName("fix toast copy")).toBe("ctcode/fix-toast-copy");
  });

  it("keeps non-CTCode namespaces inside the CTCode branch", () => {
    expect(buildCTCodeBranchName("feature/refine-toolbar-actions")).toBe(
      "ctcode/feature/refine-toolbar-actions",
    );
  });

  it("normalizes legacy prefixes before rebuilding the branch", () => {
    expect(buildCTCodeBranchName("t3code/refine toolbar actions")).toBe(
      "ctcode/refine-toolbar-actions",
    );
    expect(buildCTCodeBranchName("dpcode/refine toolbar actions")).toBe(
      "ctcode/refine-toolbar-actions",
    );
  });

  it("falls back to ctcode/update when no preferred name is provided", () => {
    expect(buildCTCodeBranchName()).toBe("ctcode/update");
  });
});

describe("resolveUniqueCTCodeBranchName", () => {
  it("increments suffix when the CTCode branch already exists", () => {
    expect(
      resolveUniqueCTCodeBranchName(
        ["main", "ctcode/fix-toast-copy", "ctcode/fix-toast-copy-2"],
        "fix toast copy",
      ),
    ).toBe("ctcode/fix-toast-copy-3");
  });
});
