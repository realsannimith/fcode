import { describe, expect, it } from "vitest";

import {
  AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
  computePinnedTurnBottomSpacerPx,
  getScrollContainerDistanceFromBottom,
  isScrollContainerNearBottom,
} from "./chat-scroll";

describe("getScrollContainerDistanceFromBottom", () => {
  it("returns the remaining distance when the viewport is above the bottom", () => {
    expect(
      getScrollContainerDistanceFromBottom({
        scrollTop: 520,
        clientHeight: 400,
        scrollHeight: 1_000,
      }),
    ).toBe(80);
  });

  it("clamps negative distances and non-finite values", () => {
    expect(
      getScrollContainerDistanceFromBottom({
        scrollTop: 620,
        clientHeight: 400,
        scrollHeight: 1_000,
      }),
    ).toBe(0);
    expect(
      getScrollContainerDistanceFromBottom({
        scrollTop: Number.NaN,
        clientHeight: 400,
        scrollHeight: 1_000,
      }),
    ).toBe(0);
  });
});

describe("isScrollContainerNearBottom", () => {
  it("returns true when already at bottom", () => {
    expect(
      isScrollContainerNearBottom({
        scrollTop: 600,
        clientHeight: 400,
        scrollHeight: 1_000,
      }),
    ).toBe(true);
  });

  it("returns true when within the auto-scroll threshold", () => {
    expect(
      isScrollContainerNearBottom({
        scrollTop: 540,
        clientHeight: 400,
        scrollHeight: 1_000,
      }),
    ).toBe(true);
  });

  it("returns false when the user is meaningfully above the bottom", () => {
    expect(
      isScrollContainerNearBottom({
        scrollTop: 520,
        clientHeight: 400,
        scrollHeight: 1_000,
      }),
    ).toBe(false);
  });

  it("clamps negative thresholds to zero", () => {
    expect(
      isScrollContainerNearBottom(
        {
          scrollTop: 539,
          clientHeight: 400,
          scrollHeight: 1_000,
        },
        -1,
      ),
    ).toBe(false);
  });

  it("falls back to the default threshold for non-finite values", () => {
    expect(
      isScrollContainerNearBottom(
        {
          scrollTop: 540,
          clientHeight: 400,
          scrollHeight: 1_000,
        },
        Number.NaN,
      ),
    ).toBe(true);
    expect(AUTO_SCROLL_BOTTOM_THRESHOLD_PX).toBe(64);
  });
});

describe("computePinnedTurnBottomSpacerPx", () => {
  it("reserves a full viewport minus content so a short reply still pins the message to the top", () => {
    // Reply barely started: 120px of content below the pin, 800px viewport.
    expect(
      computePinnedTurnBottomSpacerPx({
        viewportHeightPx: 800,
        pinnedTurnContentHeightPx: 120,
        minBottomInsetPx: 64,
      }),
    ).toBe(680);
  });

  it("keeps the region below the pin exactly one viewport tall while it is being reserved", () => {
    const viewportHeightPx = 800;
    const pinnedTurnContentHeightPx = 300;
    const spacer = computePinnedTurnBottomSpacerPx({
      viewportHeightPx,
      pinnedTurnContentHeightPx,
      minBottomInsetPx: 64,
    });
    expect(pinnedTurnContentHeightPx + spacer).toBe(viewportHeightPx);
  });

  it("collapses to the minimum inset once the reply fills the viewport", () => {
    expect(
      computePinnedTurnBottomSpacerPx({
        viewportHeightPx: 800,
        pinnedTurnContentHeightPx: 900,
        minBottomInsetPx: 64,
      }),
    ).toBe(64);
  });

  it("never drops below the minimum inset even when content exceeds the viewport", () => {
    expect(
      computePinnedTurnBottomSpacerPx({
        viewportHeightPx: 800,
        pinnedTurnContentHeightPx: 5_000,
        minBottomInsetPx: 40,
      }),
    ).toBe(40);
  });

  it("clamps non-finite and negative inputs", () => {
    expect(
      computePinnedTurnBottomSpacerPx({
        viewportHeightPx: Number.NaN,
        pinnedTurnContentHeightPx: -50,
        minBottomInsetPx: 64,
      }),
    ).toBe(64);
    expect(
      computePinnedTurnBottomSpacerPx({
        viewportHeightPx: 800,
        pinnedTurnContentHeightPx: Number.POSITIVE_INFINITY,
        minBottomInsetPx: 64,
      }),
    ).toBe(800);
  });
});
