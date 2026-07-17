// FILE: threadWorkspaceTabs.test.ts
// Purpose: Guards grouping and ordering for multi-chat thread workspace tabs.

import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { resolveThreadWorkspaceChatTabs } from "./threadWorkspaceTabs";

const ROOT = ThreadId.makeUnsafe("thread-root");
const CHAT_TWO = ThreadId.makeUnsafe("thread-chat-two");
const CHAT_THREE = ThreadId.makeUnsafe("thread-chat-three");

describe("resolveThreadWorkspaceChatTabs", () => {
  const summaries = [
    {
      id: CHAT_THREE,
      title: "Third idea",
      createdAt: "2026-07-17T03:00:00.000Z",
      sidechatSourceThreadId: ROOT,
      hasLiveTailWork: true,
    },
    {
      id: ROOT,
      title: "Main task",
      createdAt: "2026-07-17T01:00:00.000Z",
      sidechatSourceThreadId: null,
      hasLiveTailWork: false,
    },
    {
      id: CHAT_TWO,
      title: "Second idea",
      createdAt: "2026-07-17T02:00:00.000Z",
      sidechatSourceThreadId: ROOT,
      hasLiveTailWork: false,
    },
  ];

  it("keeps the host first and numbers its child chats by creation order", () => {
    const result = resolveThreadWorkspaceChatTabs({
      activeThreadId: ROOT,
      summaries,
    });

    expect(result.hostThreadId).toBe(ROOT);
    expect(result.tabs.map((tab) => [tab.id, tab.label])).toEqual([
      [ROOT, "Chat"],
      [CHAT_TWO, "Chat 2"],
      [CHAT_THREE, "Chat 3"],
    ]);
    expect(result.tabs.map((tab) => tab.canClose)).toEqual([true, true, true]);
    expect(result.tabs[2]?.isWorking).toBe(true);
  });

  it("keeps the same group while a child chat is active", () => {
    const result = resolveThreadWorkspaceChatTabs({
      activeThreadId: CHAT_TWO,
      activeSidechatSourceThreadId: ROOT,
      summaries,
    });

    expect(result.hostThreadId).toBe(ROOT);
    expect(result.tabs.map((tab) => tab.id)).toEqual([ROOT, CHAT_TWO, CHAT_THREE]);
  });

  it("hides archived child chats unless that chat is currently active", () => {
    const archivedSummaries = summaries.map((summary) =>
      summary.id === CHAT_TWO ? { ...summary, archivedAt: "2026-07-17T04:00:00.000Z" } : summary,
    );

    expect(
      resolveThreadWorkspaceChatTabs({
        activeThreadId: ROOT,
        summaries: archivedSummaries,
      }).tabs.map((tab) => tab.id),
    ).toEqual([ROOT, CHAT_THREE]);
    expect(
      resolveThreadWorkspaceChatTabs({
        activeThreadId: CHAT_TWO,
        activeSidechatSourceThreadId: ROOT,
        summaries: archivedSummaries,
      }).tabs.map((tab) => tab.id),
    ).toEqual([ROOT, CHAT_TWO, CHAT_THREE]);
  });
});
