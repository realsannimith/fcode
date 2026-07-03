import { describe, expect, it } from "vitest";
import { DEFAULT_CHAT_FONT_SIZE_PX } from "../appSettings";
import { getAppTypographyScale } from "./appTypography";

describe("getAppTypographyScale", () => {
  it("renders chat surfaces a step larger than the dense sidebar/UI text", () => {
    const scale = getAppTypographyScale(DEFAULT_CHAT_FONT_SIZE_PX);
    // Sidebar/UI stays anchored to the base font size...
    expect(scale.uiPx).toBe(DEFAULT_CHAT_FONT_SIZE_PX);
    // ...while the chat body + composer input read clearly larger (target match).
    expect(scale.chatPx).toBeGreaterThan(scale.uiPx);
    // Chat code tracks the chat body, not the smaller UI size.
    expect(scale.chatCodePx).toBeGreaterThanOrEqual(scale.uiPx);
  });
});
