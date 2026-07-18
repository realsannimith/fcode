// FILE: pinnedMessages.ts
// Purpose: Shared pure transforms for per-thread pinned-message lists and note limits.
// Layer: Shared runtime domain helper used by server projections and the web store.

import {
  PINNED_MESSAGE_LABEL_MAX_CHARS,
  THREAD_NOTES_MAX_CHARS,
  type MessageId,
  type PinnedMessage,
} from "@t3tools/contracts";

// Preserve no-op references while keeping mutation helpers typed as mutable-array outputs.
function keepExistingPins(pins: readonly PinnedMessage[]): PinnedMessage[] {
  return pins as PinnedMessage[];
}

export function isMessagePinned(
  pins: readonly PinnedMessage[] | null | undefined,
  messageId: MessageId,
): boolean {
  return pins?.some((pin) => pin.messageId === messageId) ?? false;
}

export function addPinnedMessage(
  pins: readonly PinnedMessage[] | null | undefined,
  pin: PinnedMessage,
): PinnedMessage[] {
  const existingPins = pins ?? [];
  return isMessagePinned(existingPins, pin.messageId)
    ? keepExistingPins(existingPins)
    : [...existingPins, pin];
}

export function removePinnedMessage(
  pins: readonly PinnedMessage[] | null | undefined,
  messageId: MessageId,
): PinnedMessage[] {
  const existingPins = pins ?? [];
  const nextPins = existingPins.filter((pin) => pin.messageId !== messageId);
  return nextPins.length === existingPins.length ? keepExistingPins(existingPins) : nextPins;
}

/** Move a pinned message to a new zero-based position without mutating the input list. */
export function reorderPinnedMessage(
  pins: readonly PinnedMessage[] | null | undefined,
  messageId: MessageId,
  targetIndex: number,
): PinnedMessage[] {
  const existingPins = pins ?? [];
  const sourceIndex = existingPins.findIndex((pin) => pin.messageId === messageId);
  if (sourceIndex < 0 || existingPins.length < 2) {
    return keepExistingPins(existingPins);
  }
  const boundedTargetIndex = Math.max(
    0,
    Math.min(Math.trunc(targetIndex), existingPins.length - 1),
  );
  if (sourceIndex === boundedTargetIndex) {
    return keepExistingPins(existingPins);
  }
  const nextPins = [...existingPins];
  const [movedPin] = nextPins.splice(sourceIndex, 1);
  if (!movedPin) {
    return keepExistingPins(existingPins);
  }
  nextPins.splice(boundedTargetIndex, 0, movedPin);
  return nextPins;
}

export function togglePinnedMessage(
  pins: readonly PinnedMessage[] | null | undefined,
  pin: PinnedMessage,
): PinnedMessage[] {
  return isMessagePinned(pins, pin.messageId)
    ? removePinnedMessage(pins, pin.messageId)
    : addPinnedMessage(pins, pin);
}

export function setPinnedMessageDone(
  pins: readonly PinnedMessage[] | null | undefined,
  messageId: MessageId,
  done: boolean,
): PinnedMessage[] {
  const existingPins = pins ?? [];
  let changed = false;
  const nextPins = existingPins.map((pin) => {
    if (pin.messageId !== messageId || pin.done === done) {
      return pin;
    }
    changed = true;
    return { ...pin, done };
  });
  return changed ? nextPins : keepExistingPins(existingPins);
}

export function togglePinnedMessageDone(
  pins: readonly PinnedMessage[] | null | undefined,
  messageId: MessageId,
): PinnedMessage[] {
  const existingPins = pins ?? [];
  let changed = false;
  const nextPins = existingPins.map((pin) => {
    if (pin.messageId !== messageId) {
      return pin;
    }
    changed = true;
    return { ...pin, done: !pin.done };
  });
  return changed ? nextPins : keepExistingPins(existingPins);
}

export function normalizePinLabel(label: string | null): string | null {
  const trimmed = label?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.length > PINNED_MESSAGE_LABEL_MAX_CHARS
    ? trimmed.slice(0, PINNED_MESSAGE_LABEL_MAX_CHARS)
    : trimmed;
}

export function setPinnedMessageLabel(
  pins: readonly PinnedMessage[] | null | undefined,
  messageId: MessageId,
  label: string | null,
): PinnedMessage[] {
  const normalized = normalizePinLabel(label);
  const existingPins = pins ?? [];
  let changed = false;
  const nextPins = existingPins.map((pin) => {
    if (pin.messageId !== messageId || (pin.label ?? null) === normalized) {
      return pin;
    }
    changed = true;
    return { ...pin, label: normalized };
  });
  return changed ? nextPins : keepExistingPins(existingPins);
}

export function clampThreadNotes(notes: string): string {
  return notes.length > THREAD_NOTES_MAX_CHARS ? notes.slice(0, THREAD_NOTES_MAX_CHARS) : notes;
}
