import { describe, expect, it } from "vitest";

import { RIGHT_DOCK_PANE_KINDS } from "~/rightDockStore.logic";
import { RIGHT_DOCK_ADD_MENU_KINDS, getRightDockPaneMeta } from "./rightDockPaneMeta";

describe("RIGHT_DOCK_ADD_MENU_KINDS", () => {
  it("does not offer the context-only pull request pane", () => {
    // Pull request panes are opened from the Pull Requests view or the
    // environment panel, never from the add menu.
    expect(RIGHT_DOCK_ADD_MENU_KINDS).not.toContain("pullRequest");
  });

  it("keeps the canonical kind order minus context-only panes", () => {
    expect([...RIGHT_DOCK_ADD_MENU_KINDS]).toEqual(
      RIGHT_DOCK_PANE_KINDS.filter((kind) => kind !== "pullRequest"),
    );
  });

  it("labels the pull request pane", () => {
    expect(getRightDockPaneMeta("pullRequest").label).toBe("Pull request");
  });
});
