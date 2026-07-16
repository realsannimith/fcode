// FILE: floatingSurfaceStyles.ts
// Purpose: Shared chrome for neutral floating UI surfaces such as menus, popovers, and toasts.
// Layer: UI styling helper

/** Compact panel radius used by menus and other dense floating surfaces. */
export const APP_POPUP_RADIUS_CLASS_NAME = "rounded-[0.65rem]";

/** Translucent shell shared by neutral floating surfaces. */
export const APP_TRANSLUCENT_POPUP_SURFACE_BASE_CLASS_NAME =
  "relative overflow-hidden border border-border bg-popover/70 text-popover-foreground before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150";

/** Default shell used by quick-action menus, popovers, and expanded notifications. */
export const APP_TRANSLUCENT_POPUP_SURFACE_CLASS_NAME = `${APP_TRANSLUCENT_POPUP_SURFACE_BASE_CLASS_NAME} ${APP_POPUP_RADIUS_CLASS_NAME} shadow-xl`;

/** Tighter shell used by plain tooltips and sidebar hover cards. */
export const APP_TOOLTIP_SURFACE_CLASS_NAME = `${APP_TRANSLUCENT_POPUP_SURFACE_BASE_CLASS_NAME} rounded-lg shadow-xl`;
