import {
  DEFAULT_CHAT_FONT_SIZE_PX,
  MAX_CHAT_FONT_SIZE_PX,
  normalizeChatFontSizePx,
} from "../appSettings";

export interface AppTypographyScale {
  basePx: number;
  uiPx: number;
  uiLgPx: number;
  uiSmPx: number;
  uiXsPx: number;
  ui2XsPx: number;
  uiMetaPx: number;
  uiTimestampPx: number;
  chatPx: number;
  chatCodePx: number;
  chatMetaPx: number;
  chatTinyPx: number;
}

function clampTypographyPx(value: number, min: number, max = MAX_CHAT_FONT_SIZE_PX + 2): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function getAppTypographyScale(
  baseFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): AppTypographyScale {
  const basePx = normalizeChatFontSizePx(baseFontSizePx);
  // Chat surfaces (transcript + composer input + code) read a step larger than the
  // dense UI/sidebar text — matches the target, where the conversation body and its
  // input are clearly bigger than the navigation. UI sizes stay anchored to basePx,
  // so the sidebar density is unchanged. Chat meta/code scale off chatPx so the whole
  // chat column stays harmonious. To revert to chat==sidebar, set the factor to 1.
  const chatPx = clampTypographyPx(basePx * 1.15, basePx);

  return {
    basePx,
    uiPx: basePx,
    uiLgPx: clampTypographyPx(basePx * 1.08, basePx),
    uiSmPx: clampTypographyPx(basePx * 0.92, 10),
    uiXsPx: clampTypographyPx(basePx * 0.84, 10),
    ui2XsPx: clampTypographyPx(basePx * 0.76, 9),
    uiMetaPx: clampTypographyPx(basePx * 0.84, 10),
    uiTimestampPx: clampTypographyPx(basePx * 0.72, 8),
    chatPx,
    chatCodePx: clampTypographyPx(chatPx * 0.92, 10),
    chatMetaPx: clampTypographyPx(chatPx * 0.74, 8),
    chatTinyPx: clampTypographyPx(chatPx * 0.66, 8),
  };
}
