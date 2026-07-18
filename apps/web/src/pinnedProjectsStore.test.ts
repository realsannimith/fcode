// FILE: pinnedProjectsStore.test.ts
// Purpose: Verifies the capped pinned-project store mutates ids predictably.
// Layer: UI state store test

import { beforeEach, describe, expect, it } from "vitest";
import { ProjectId } from "@t3tools/contracts";
import { usePinnedProjectsStore } from "./pinnedProjectsStore";

describe("usePinnedProjectsStore", () => {
  beforeEach(() => {
    usePinnedProjectsStore.setState({ pinnedProjectIds: [] });
  });

  it("pins newest project ids first without capping the count", () => {
    expect(usePinnedProjectsStore.getState().pinProject("project-1" as ProjectId)).toBe(true);
    expect(usePinnedProjectsStore.getState().pinProject("project-2" as ProjectId)).toBe(true);
    expect(usePinnedProjectsStore.getState().pinProject("project-3" as ProjectId)).toBe(true);
    expect(usePinnedProjectsStore.getState().pinProject("project-4" as ProjectId)).toBe(true);

    expect(usePinnedProjectsStore.getState().pinnedProjectIds).toEqual([
      "project-4",
      "project-3",
      "project-2",
      "project-1",
    ]);
  });

  it("unpins and prunes project ids that are no longer present", () => {
    usePinnedProjectsStore.setState({
      pinnedProjectIds: [
        "project-3" as ProjectId,
        "project-2" as ProjectId,
        "project-1" as ProjectId,
      ],
    });

    usePinnedProjectsStore.getState().unpinProject("project-2" as ProjectId);
    expect(usePinnedProjectsStore.getState().pinnedProjectIds).toEqual(["project-3", "project-1"]);

    usePinnedProjectsStore.getState().prunePinnedProjects(["project-1" as ProjectId]);
    expect(usePinnedProjectsStore.getState().pinnedProjectIds).toEqual(["project-1"]);
  });

  it("persists drag ordering between pinned projects", () => {
    usePinnedProjectsStore.setState({
      pinnedProjectIds: [
        "project-3" as ProjectId,
        "project-2" as ProjectId,
        "project-1" as ProjectId,
      ],
    });

    usePinnedProjectsStore
      .getState()
      .reorderPinnedProject("project-1" as ProjectId, "project-3" as ProjectId);

    expect(usePinnedProjectsStore.getState().pinnedProjectIds).toEqual([
      "project-1",
      "project-3",
      "project-2",
    ]);
  });
});
