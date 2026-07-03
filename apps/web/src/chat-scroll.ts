export const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 64;

interface ScrollPosition {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export function getScrollContainerDistanceFromBottom(position: ScrollPosition): number {
  const { scrollTop, clientHeight, scrollHeight } = position;
  if (![scrollTop, clientHeight, scrollHeight].every(Number.isFinite)) {
    return 0;
  }

  return Math.max(0, scrollHeight - clientHeight - scrollTop);
}

export function isScrollContainerNearBottom(
  position: ScrollPosition,
  thresholdPx = AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
): boolean {
  const threshold = Number.isFinite(thresholdPx)
    ? Math.max(0, thresholdPx)
    : AUTO_SCROLL_BOTTOM_THRESHOLD_PX;

  return getScrollContainerDistanceFromBottom(position) <= threshold;
}

interface PinnedTurnSpacerInput {
  /** Height of the scroll viewport (the scroll container's clientHeight). */
  viewportHeightPx: number;
  /**
   * Distance from the top of the pinned user message to the bottom of the turn's real content
   * (its reply/work rows), i.e. everything below the pin excluding the reserved bottom spacer.
   */
  pinnedTurnContentHeightPx: number;
  /** Lower bound so content still clears the composer / any docked overlay. */
  minBottomInsetPx: number;
}

/**
 * Bottom spacer height (px) that lets a just-sent user message scroll to the top of the viewport
 * with its reply streaming beneath it (the "pin to top on send" behavior).
 *
 * For the message to reach the very top, the region from its top to the end of the transcript must
 * be at least one viewport tall — otherwise the list simply cannot scroll that far. We reserve the
 * shortfall (`viewport - contentBelowPin`) as empty space below the content, never dropping below
 * the caller's minimum inset. As the reply grows the shortfall shrinks, so the reserved gap
 * collapses to the minimum inset exactly when the reply fills the viewport (no dangling blank
 * space under long replies).
 */
export function computePinnedTurnBottomSpacerPx(input: PinnedTurnSpacerInput): number {
  const viewport = Number.isFinite(input.viewportHeightPx)
    ? Math.max(0, input.viewportHeightPx)
    : 0;
  const contentBelowPin = Number.isFinite(input.pinnedTurnContentHeightPx)
    ? Math.max(0, input.pinnedTurnContentHeightPx)
    : 0;
  const minInset = Number.isFinite(input.minBottomInsetPx)
    ? Math.max(0, input.minBottomInsetPx)
    : 0;

  return Math.max(minInset, viewport - contentBelowPin);
}
