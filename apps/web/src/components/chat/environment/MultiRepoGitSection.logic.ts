// FILE: MultiRepoGitSection.logic.ts
// Purpose: Pure helpers for the multi-repo git section — classify a single
//          stacked-action result (commit / push / commit&push) into a per-repo
//          outcome, and summarize a batch of those outcomes into one toast.
//          Side-effect free so it can be unit tested in isolation.

import type { GitRunStackedActionResult, GitStackedAction } from "@t3tools/contracts";

export type RepoActionStatus = "success" | "noop" | "failed";

export interface RepoActionResult {
  readonly name: string;
  readonly status: RepoActionStatus;
  /** Short human detail, e.g. "committed", "pushed", "committed & pushed". */
  readonly detail?: string;
  readonly error?: string;
}

export interface RepoActionSummary {
  readonly toastType: "success" | "warning" | "error";
  readonly title: string;
  readonly description?: string;
}

/**
 * Map a successful stacked-action result to a per-repo outcome + short detail.
 * A "noop" means the action ran but there was nothing to do (clean tree / nothing
 * to push) — surfaced as neither success nor failure in the batch summary.
 */
export function describeStackedResult(
  action: GitStackedAction,
  result: GitRunStackedActionResult,
): { status: RepoActionStatus; detail: string } {
  if (action === "push") {
    return result.push.status === "pushed"
      ? { status: "success", detail: "pushed" }
      : { status: "noop", detail: "nothing to push" };
  }

  const committed = result.commit.status === "created";
  const pushed = result.push.status === "pushed";
  if (committed && pushed) return { status: "success", detail: "committed & pushed" };
  if (committed) return { status: "success", detail: "committed" };
  if (pushed) return { status: "success", detail: "pushed" };
  return { status: "noop", detail: "no changes" };
}

function pluralizeRepositories(count: number): string {
  return count === 1 ? "repository" : "repositories";
}

/**
 * Summarize a batch of per-repository action outcomes into a single toast.
 *
 * - Any failures → warning (if some succeeded) or error (if all failed).
 * - No successes and no failures → success "Nothing to do" (all up to date).
 * - Otherwise → success naming the affected repos and what happened to each.
 */
export function summarizeRepoActionResults(input: {
  actionLabel: string;
  results: readonly RepoActionResult[];
}): RepoActionSummary {
  const { actionLabel, results } = input;
  const failed = results.filter((r) => r.status === "failed");
  const succeeded = results.filter((r) => r.status === "success");
  const total = results.length;

  if (failed.length > 0) {
    const failedNames = failed.map((r) => r.name).join(", ");
    if (succeeded.length === 0) {
      return {
        toastType: "error",
        title:
          total === 1
            ? `${actionLabel} failed`
            : `${actionLabel} failed for ${failed.length} ${pluralizeRepositories(failed.length)}`,
        description: failedNames,
      };
    }
    return {
      toastType: "warning",
      title: `${actionLabel}: ${succeeded.length} of ${total} ${pluralizeRepositories(total)}`,
      description: `Failed: ${failedNames}`,
    };
  }

  if (succeeded.length === 0) {
    return {
      toastType: "success",
      title: "Nothing to do",
      description: "All repositories are already up to date.",
    };
  }

  return {
    toastType: "success",
    title: `${actionLabel}: ${succeeded.length} ${pluralizeRepositories(succeeded.length)}`,
    description: succeeded.map((r) => (r.detail ? `${r.name} (${r.detail})` : r.name)).join(", "),
  };
}
