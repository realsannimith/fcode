import { describe, expect, it } from "vitest";

import { shouldCloseEnvironmentPanelOnEscape } from "./environmentPanelInteraction";

describe("shouldCloseEnvironmentPanelOnEscape", () => {
  it("closes an open panel for an unhandled Escape key", () => {
    expect(
      shouldCloseEnvironmentPanelOnEscape({
        defaultPrevented: false,
        key: "Escape",
        open: true,
      }),
    ).toBe(true);
  });

  it("preserves the panel for handled Escape keys and unrelated input", () => {
    expect(
      shouldCloseEnvironmentPanelOnEscape({
        defaultPrevented: true,
        key: "Escape",
        open: true,
      }),
    ).toBe(false);
    expect(
      shouldCloseEnvironmentPanelOnEscape({
        defaultPrevented: false,
        key: "Enter",
        open: true,
      }),
    ).toBe(false);
    expect(
      shouldCloseEnvironmentPanelOnEscape({
        defaultPrevented: false,
        key: "Escape",
        open: false,
      }),
    ).toBe(false);
  });
});
