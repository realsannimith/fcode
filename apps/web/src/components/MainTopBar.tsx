// FILE: MainTopBar.tsx
// Purpose: Shared draggable titlebar for the main content surfaces (launcher + terminal).
//          Provides the frameless-window drag region, the sidebar toggle/nav controls
//          (shown when the sidebar is collapsed), and the macOS/Windows control gutters.
// Layer: Web shell chrome

import type { ReactNode } from "react";

import {
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "~/components/chat/chatHeaderControls";
import {
  CHAT_BACKGROUND_CLASS_NAME,
  CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME,
  CHAT_ROUTE_INSET_SHELL_CLASS_NAME,
} from "~/components/chat/composerPickerStyles";
import { SidebarHeaderNavigationControls } from "~/components/SidebarHeaderNavigationControls";
import { SidebarInset } from "~/components/ui/sidebar";
import {
  useDesktopTopBarTrafficLightGutterClassName,
  useDesktopTopBarWindowControlsGutterClassName,
} from "~/hooks/useDesktopTopBarGutter";
import { cn } from "~/lib/utils";

// The main content card: rounded seam against the sidebar + overflow-hidden so content
// (e.g. the terminal tab strip) is framed and clipped instead of bleeding past the edges.
// Mirrors how ChatView/WorkspaceView wrap their surfaces.
export function MainSurface({ children }: { children: ReactNode }) {
  return (
    <SidebarInset
      className={CHAT_ROUTE_INSET_SHELL_CLASS_NAME}
      surfaceClassName={CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME}
    >
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          CHAT_BACKGROUND_CLASS_NAME,
        )}
      >
        {children}
      </div>
    </SidebarInset>
  );
}

export function MainTopBar({ title, actions }: { title?: ReactNode; actions?: ReactNode }) {
  const trafficLightGutter = useDesktopTopBarTrafficLightGutterClassName();
  const windowControlsGutter = useDesktopTopBarWindowControlsGutterClassName();

  return (
    <header
      className={cn(
        CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
        CHAT_SURFACE_HEADER_PADDING_X_CLASS,
        "drag-region shrink-0",
        trafficLightGutter,
        windowControlsGutter,
      )}
    >
      <div className={cn("flex items-center gap-2 sm:gap-3", CHAT_SURFACE_HEADER_HEIGHT_CLASS)}>
        <SidebarHeaderNavigationControls />
        <div className="flex min-w-0 flex-1 items-center gap-2">{title}</div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-1.5 [-webkit-app-region:no-drag]">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}

export default MainTopBar;
