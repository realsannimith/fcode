import type { GitRunStackedActionResult } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  describeStackedResult,
  summarizeRepoActionResults,
  type RepoActionResult,
} from "./MultiRepoGitSection.logic";

const success = (name: string, detail?: string): RepoActionResult =>
  detail ? { name, status: "success", detail } : { name, status: "success" };
const noop = (name: string): RepoActionResult => ({ name, status: "noop" });
const failed = (name: string): RepoActionResult => ({ name, status: "failed" });

function makeResult(overrides: {
  commit?: GitRunStackedActionResult["commit"]["status"];
  push?: GitRunStackedActionResult["push"]["status"];
}): GitRunStackedActionResult {
  return {
    action: "commit_push",
    branch: { status: "skipped_not_requested" },
    commit: { status: overrides.commit ?? "skipped_no_changes" },
    push: { status: overrides.push ?? "skipped_not_requested" },
    pr: { status: "skipped_not_requested" },
  };
}

describe("describeStackedResult", () => {
  it("marks a push that pushed as success", () => {
    expect(describeStackedResult("push", makeResult({ push: "pushed" }))).toEqual({
      status: "success",
      detail: "pushed",
    });
  });

  it("marks a push with nothing to send as noop", () => {
    expect(describeStackedResult("push", makeResult({ push: "skipped_up_to_date" }))).toEqual({
      status: "noop",
      detail: "nothing to push",
    });
  });

  it("marks a commit that created as success", () => {
    expect(describeStackedResult("commit", makeResult({ commit: "created" }))).toEqual({
      status: "success",
      detail: "committed",
    });
  });

  it("marks commit&push that did both as success with combined detail", () => {
    expect(
      describeStackedResult("commit_push", makeResult({ commit: "created", push: "pushed" })),
    ).toEqual({ status: "success", detail: "committed & pushed" });
  });

  it("marks a clean commit as noop", () => {
    expect(describeStackedResult("commit", makeResult({ commit: "skipped_no_changes" }))).toEqual({
      status: "noop",
      detail: "no changes",
    });
  });
});

describe("summarizeRepoActionResults", () => {
  it("reports success naming affected repos with detail", () => {
    const summary = summarizeRepoActionResults({
      actionLabel: "Commit all",
      results: [success("frontend", "committed"), success("backend", "committed")],
    });
    expect(summary.toastType).toBe("success");
    expect(summary.title).toBe("Commit all: 2 repositories");
    expect(summary.description).toBe("frontend (committed), backend (committed)");
  });

  it("uses singular wording for a single success", () => {
    const summary = summarizeRepoActionResults({
      actionLabel: "Push",
      results: [success("frontend", "pushed"), noop("backend")],
    });
    expect(summary.toastType).toBe("success");
    expect(summary.title).toBe("Push: 1 repository");
  });

  it("reports nothing to do when all are noop", () => {
    const summary = summarizeRepoActionResults({
      actionLabel: "Push all",
      results: [noop("frontend"), noop("backend")],
    });
    expect(summary.toastType).toBe("success");
    expect(summary.title).toBe("Nothing to do");
  });

  it("warns on partial failure", () => {
    const summary = summarizeRepoActionResults({
      actionLabel: "Commit all",
      results: [success("frontend", "committed"), failed("backend")],
    });
    expect(summary.toastType).toBe("warning");
    expect(summary.title).toBe("Commit all: 1 of 2 repositories");
    expect(summary.description).toBe("Failed: backend");
  });

  it("errors when every action fails", () => {
    const summary = summarizeRepoActionResults({
      actionLabel: "Push",
      results: [failed("frontend"), failed("backend")],
    });
    expect(summary.toastType).toBe("error");
    expect(summary.title).toBe("Push failed for 2 repositories");
    expect(summary.description).toBe("frontend, backend");
  });

  it("errors with singular wording for a single failure", () => {
    const summary = summarizeRepoActionResults({
      actionLabel: "Commit",
      results: [failed("frontend")],
    });
    expect(summary.toastType).toBe("error");
    expect(summary.title).toBe("Commit failed");
  });
});
