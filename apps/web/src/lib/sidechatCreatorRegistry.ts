// FILE: sidechatCreatorRegistry.ts
// Purpose: Bridge the composer's side-chat creation logic to workspace add-chat controls.
// Layer: Chat capability registry
// Exports: register/get for a per-host-thread sidechat creator.
//
// The composer (inside ChatView) owns the full sidechat-creation flow, including the
// user's currently selected model. Workspace chrome outside that hook invokes the
// published creator instead of duplicating the orchestration command sequence.

import type { ThreadId } from "@t3tools/contracts";

export type SidechatCreator = (options?: {
  initialPrompt?: string;
  presentation?: "dock" | "tab";
}) => Promise<ThreadId | null>;

const creatorsByThreadId = new Map<ThreadId, SidechatCreator>();

export function registerSidechatCreator(threadId: ThreadId, creator: SidechatCreator): () => void {
  creatorsByThreadId.set(threadId, creator);
  return () => {
    if (creatorsByThreadId.get(threadId) === creator) {
      creatorsByThreadId.delete(threadId);
    }
  };
}

export function getSidechatCreator(threadId: ThreadId): SidechatCreator | undefined {
  return creatorsByThreadId.get(threadId);
}
