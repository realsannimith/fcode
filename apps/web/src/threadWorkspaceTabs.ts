// FILE: threadWorkspaceTabs.ts
// Purpose: Resolve the stable top-row chat tabs owned by a main thread and its side chats.
// Layer: Pure web UI logic

import type { ThreadId } from "@t3tools/contracts";

export interface ThreadWorkspaceTabSummary {
  id: ThreadId;
  title: string;
  createdAt: string;
  archivedAt?: string | null;
  sidechatSourceThreadId?: ThreadId | null;
  hasLiveTailWork: boolean;
}

export interface ThreadWorkspaceChatTab {
  id: ThreadId;
  label: string;
  title: string;
  isWorking: boolean;
}

export function resolveThreadWorkspaceChatTabs(input: {
  activeThreadId: ThreadId;
  activeSidechatSourceThreadId?: ThreadId | null;
  summaries: readonly ThreadWorkspaceTabSummary[];
}): { hostThreadId: ThreadId; tabs: ThreadWorkspaceChatTab[] } {
  const hostThreadId = input.activeSidechatSourceThreadId ?? input.activeThreadId;
  const summariesById = new Map(input.summaries.map((summary) => [summary.id, summary]));
  const hostSummary = summariesById.get(hostThreadId);
  const childSummaries = input.summaries
    .filter(
      (summary) =>
        summary.sidechatSourceThreadId === hostThreadId &&
        (summary.archivedAt == null || summary.id === input.activeThreadId),
    )
    .toSorted((left, right) => {
      const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
      return createdAtOrder !== 0 ? createdAtOrder : left.id.localeCompare(right.id);
    });
  const orderedSummaries = [
    ...(hostSummary ? [hostSummary] : []),
    ...childSummaries.filter((summary) => summary.id !== hostThreadId),
  ];

  if (!orderedSummaries.some((summary) => summary.id === input.activeThreadId)) {
    const activeSummary = summariesById.get(input.activeThreadId);
    if (activeSummary) {
      orderedSummaries.push(activeSummary);
    }
  }

  return {
    hostThreadId,
    tabs: orderedSummaries.map((summary, index) => ({
      id: summary.id,
      label: index === 0 ? "Chat" : `Chat ${index + 1}`,
      title: summary.title,
      isWorking: summary.hasLiveTailWork,
      canClose: true,
    })),
  };
}
