import { ThreadId, TurnId, type OrchestrationLatestTurn } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import {
  shouldCheckAfterTurn,
  useConflictResolutionStore,
  type StartConflictResolutionTrackingInput,
} from "./conflictResolutionStore";

const threadId = ThreadId.makeUnsafe("thread-1");
const handoffTurnId = TurnId.makeUnsafe("turn-handoff");
const agentTurnId = TurnId.makeUnsafe("turn-agent");

function makeTrackingInput(
  overrides: Partial<StartConflictResolutionTrackingInput> = {},
): StartConflictResolutionTrackingInput {
  return {
    threadId,
    cwd: "/repo",
    kind: "merge",
    label: "feature → main",
    sourceBranch: "feature",
    targetBranch: "main",
    prReference: null,
    handoffTurnId,
    initialFiles: ["a.ts", "b.ts"],
    ...overrides,
  };
}

function makeCompletedTurn(turnId: TurnId): OrchestrationLatestTurn {
  return {
    turnId,
    state: "completed",
    requestedAt: "2026-07-06T00:00:00.000Z",
    startedAt: "2026-07-06T00:00:01.000Z",
    completedAt: "2026-07-06T00:01:00.000Z",
    assistantMessageId: null,
  } as OrchestrationLatestTurn;
}

beforeEach(() => {
  useConflictResolutionStore.setState({ trackersByThreadId: {} });
});

describe("useConflictResolutionStore", () => {
  it("startTracking seeds a waiting tracker with the initial files", () => {
    useConflictResolutionStore.getState().startTracking(makeTrackingInput());
    const tracker = useConflictResolutionStore.getState().trackersByThreadId[threadId];
    expect(tracker?.status).toBe("waiting");
    expect(tracker?.remainingFiles).toEqual(["a.ts", "b.ts"]);
    expect(tracker?.lastCheckedTurnId).toBeNull();
  });

  it("applyCheckResult flips to resolved and clears remaining files when mergeable", () => {
    const store = useConflictResolutionStore.getState();
    store.startTracking(makeTrackingInput());
    store.applyCheckResult(threadId, { mergeable: true, conflictingFiles: [] });
    const tracker = useConflictResolutionStore.getState().trackersByThreadId[threadId];
    expect(tracker?.status).toBe("resolved");
    expect(tracker?.remainingFiles).toEqual([]);
  });

  it("applyCheckResult flips to unresolved with the remaining files when not mergeable", () => {
    const store = useConflictResolutionStore.getState();
    store.startTracking(makeTrackingInput());
    store.applyCheckResult(threadId, { mergeable: false, conflictingFiles: ["a.ts"] });
    const tracker = useConflictResolutionStore.getState().trackersByThreadId[threadId];
    expect(tracker?.status).toBe("unresolved");
    expect(tracker?.remainingFiles).toEqual(["a.ts"]);
  });

  it("markChecking records the checked turn id so a turn triggers exactly one check", () => {
    const store = useConflictResolutionStore.getState();
    store.startTracking(makeTrackingInput());
    store.markChecking(threadId, agentTurnId);
    const tracker = useConflictResolutionStore.getState().trackersByThreadId[threadId];
    expect(tracker?.status).toBe("checking");
    expect(tracker?.lastCheckedTurnId).toBe(agentTurnId);
  });

  it("dismiss removes the tracker", () => {
    const store = useConflictResolutionStore.getState();
    store.startTracking(makeTrackingInput());
    store.dismiss(threadId);
    expect(useConflictResolutionStore.getState().trackersByThreadId[threadId]).toBeUndefined();
  });
});

describe("shouldCheckAfterTurn", () => {
  function trackerWith(patch: Partial<StartConflictResolutionTrackingInput> = {}) {
    useConflictResolutionStore.getState().startTracking(makeTrackingInput(patch));
    return useConflictResolutionStore.getState().trackersByThreadId[threadId];
  }

  it("triggers for a newly completed turn after the handoff", () => {
    expect(shouldCheckAfterTurn(trackerWith(), makeCompletedTurn(agentTurnId))).toBe(true);
  });

  it("does not trigger for the turn that was already latest at handoff", () => {
    expect(shouldCheckAfterTurn(trackerWith(), makeCompletedTurn(handoffTurnId))).toBe(false);
  });

  it("does not trigger while the turn is still running", () => {
    const running = { ...makeCompletedTurn(agentTurnId), completedAt: null };
    expect(shouldCheckAfterTurn(trackerWith(), running)).toBe(false);
  });

  it("does not trigger twice for the same completed turn", () => {
    const tracker = trackerWith();
    useConflictResolutionStore.getState().markChecking(threadId, agentTurnId);
    const checked = useConflictResolutionStore.getState().trackersByThreadId[threadId];
    expect(shouldCheckAfterTurn(tracker, makeCompletedTurn(agentTurnId))).toBe(true);
    expect(shouldCheckAfterTurn(checked, makeCompletedTurn(agentTurnId))).toBe(false);
  });

  it("re-triggers on a later turn when the previous check left conflicts", () => {
    trackerWith();
    const store = useConflictResolutionStore.getState();
    store.markChecking(threadId, agentTurnId);
    store.applyCheckResult(threadId, { mergeable: false, conflictingFiles: ["a.ts"] });
    const unresolved = useConflictResolutionStore.getState().trackersByThreadId[threadId];
    const followUpTurnId = TurnId.makeUnsafe("turn-follow-up");
    expect(shouldCheckAfterTurn(unresolved, makeCompletedTurn(followUpTurnId))).toBe(true);
    expect(shouldCheckAfterTurn(unresolved, makeCompletedTurn(agentTurnId))).toBe(false);
  });

  it("does not trigger once resolved or without a tracker", () => {
    trackerWith();
    const store = useConflictResolutionStore.getState();
    store.markChecking(threadId, agentTurnId);
    store.applyCheckResult(threadId, { mergeable: true, conflictingFiles: [] });
    const resolved = useConflictResolutionStore.getState().trackersByThreadId[threadId];
    const followUpTurnId = TurnId.makeUnsafe("turn-follow-up");
    expect(shouldCheckAfterTurn(resolved, makeCompletedTurn(followUpTurnId))).toBe(false);
    expect(shouldCheckAfterTurn(undefined, makeCompletedTurn(followUpTurnId))).toBe(false);
  });
});
