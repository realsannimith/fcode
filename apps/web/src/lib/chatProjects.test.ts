// FILE: chatProjects.test.ts
// Purpose: Verifies home chat-container project recognition across new and legacy roots.

import { describe, expect, it } from "vitest";

import { isHomeChatContainerProject } from "./chatProjects";

describe("isHomeChatContainerProject", () => {
  it("matches the managed Documents/FCode general-chat root used by older drafts", () => {
    expect(
      isHomeChatContainerProject(
        {
          cwd: "/Users/tester/Documents/FCode",
          kind: "chat",
          name: "Home",
          remoteName: "Home",
        },
        {
          homeDir: "/Users/tester",
          chatWorkspaceRoot: "/Users/tester/Documents/FCode",
        },
      ),
    ).toBe(true);
  });

  it("matches Codex-style date/slug chat workspaces under Documents/FCode", () => {
    expect(
      isHomeChatContainerProject(
        {
          cwd: "/Users/tester/Documents/FCode/2026-06-11/yes-it-takes-all-the-skills",
          kind: "chat",
          name: "Yes it takes",
          remoteName: "Yes it takes",
        },
        {
          homeDir: "/Users/tester",
          chatWorkspaceRoot: "/Users/tester/Documents/FCode",
        },
      ),
    ).toBe(true);
  });

  it("keeps recognizing the legacy home-directory chat container during migration", () => {
    expect(
      isHomeChatContainerProject(
        {
          cwd: "/Users/tester",
          kind: "chat",
          name: "Home",
          remoteName: "Home",
        },
        {
          homeDir: "/Users/tester",
          chatWorkspaceRoot: "/Users/tester/Documents/FCode",
        },
      ),
    ).toBe(true);
  });

  it("does not classify ordinary projects under Documents/FCode as home chat containers", () => {
    expect(
      isHomeChatContainerProject(
        {
          cwd: "/Users/tester/Documents/FCode",
          kind: "project",
          name: "FCode",
          remoteName: "FCode",
        },
        {
          homeDir: "/Users/tester",
          chatWorkspaceRoot: "/Users/tester/Documents/FCode",
        },
      ),
    ).toBe(false);
  });

  it("does not classify ordinary projects under date/slug chat folders", () => {
    expect(
      isHomeChatContainerProject(
        {
          cwd: "/Users/tester/Documents/FCode/2026-06-11/yes-it-takes-all-the-skills",
          kind: "project",
          name: "yes-it-takes-all-the-skills",
          remoteName: "yes-it-takes-all-the-skills",
        },
        {
          homeDir: "/Users/tester",
          chatWorkspaceRoot: "/Users/tester/Documents/FCode",
        },
      ),
    ).toBe(false);
  });
});
