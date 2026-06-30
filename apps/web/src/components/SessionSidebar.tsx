// FILE: SessionSidebar.tsx
// Purpose: Project-grouped sidebar for the terminal-launcher app. Each project (folder)
//          is a collapsible item; its terminal sessions nest underneath. Mirrors the
//          original project-style sidebar chrome (traffic-light gutter header, footer).
// Layer: Web sidebar UI

import { ThreadId } from "@t3tools/contracts";
import type { TerminalVisualState } from "@t3tools/shared/terminalThreads";
import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { isElectron } from "~/env";
import { selectThreadTerminalState, useTerminalStateStore } from "~/terminalStateStore";
import {
  mergeTerminalVisualStates,
  resolveThreadTerminalVisualState,
} from "~/terminalVisualIdentity";
import TerminalActivityIndicator from "./terminal/TerminalActivityIndicator";
import { DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS } from "~/hooks/useDesktopTopBarGutter";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  GlobeIcon,
  NewThreadIcon,
  PencilIcon,
  PinFilledIcon,
  PinIcon,
  SettingsIcon,
  TerminalIcon,
  XIcon,
} from "~/lib/icons";
import { LocalServersMenu, MenuTrigger } from "./LocalServersMenu";
import { isMacPlatform } from "~/lib/utils";
import { type TerminalSession, useTerminalSessionsStore } from "~/terminalSessionsStore";
import { SidebarLeadingControls } from "./SidebarHeaderNavigationControls";
import { SidebarProviderUsageFooter } from "./SidebarProviderUsageFooter";
import { SettingsSidebarNav } from "./SettingsSidebarNav";
import { normalizeSettingsSection, TERMINAL_HIDDEN_SETTINGS_SECTIONS } from "../settingsNavigation";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";

function folderName(cwd: string): string {
  const parts = cwd.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

// Group sessions by folder, preserving first-seen order (most recent session first).
function groupByProject(sessions: TerminalSession[]): [string, TerminalSession[]][] {
  const groups = new Map<string, TerminalSession[]>();
  for (const session of sessions) {
    const existing = groups.get(session.cwd);
    if (existing) existing.push(session);
    else groups.set(session.cwd, [session]);
  }
  return [...groups.entries()];
}

export function SessionSidebar() {
  const navigate = useNavigate();
  const isOnSettings = useLocation({ select: (loc) => loc.pathname === "/settings" });
  const settingsSectionSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const activeSettingsSection = normalizeSettingsSection(settingsSectionSearch.section);
  const sessions = useTerminalSessionsStore((state) => state.sessions);
  const activeSessionId = useTerminalSessionsStore((state) => state.activeSessionId);
  const setActiveSession = useTerminalSessionsStore((state) => state.setActiveSession);
  const removeSession = useTerminalSessionsStore((state) => state.removeSession);
  const openLauncher = useTerminalSessionsStore((state) => state.openLauncher);
  const renameSession = useTerminalSessionsStore((state) => state.renameSession);
  const pinnedProjects = useTerminalSessionsStore((state) => state.pinnedProjects);
  const togglePinnedProject = useTerminalSessionsStore((state) => state.togglePinnedProject);
  // Inline rename: id of the session being edited and its working draft.
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const commitRename = () => {
    if (editing) renameSession(editing.id, editing.draft);
    setEditing(null);
  };

  const projects = useMemo(() => {
    const pinned = new Set(pinnedProjects);
    // Stable partition: pinned projects float to the top, original order preserved within each group.
    return groupByProject(sessions).sort(
      ([a], [b]) => Number(pinned.has(b)) - Number(pinned.has(a)),
    );
  }, [sessions, pinnedProjects]);

  // Live agent-activity per session. Each session keys its terminal state by its own id
  // (TerminalSessionView uses `ThreadId.makeUnsafe(session.id)`), and the root WS handler
  // keeps these updated for every session — even ones that aren't currently focused — so a
  // running/needs-attention agent surfaces on its sidebar item without opening it.
  const terminalStateByThreadId = useTerminalStateStore((state) => state.terminalStateByThreadId);
  const sessionVisualStateById = useMemo(() => {
    const map = new Map<string, TerminalVisualState>();
    for (const session of sessions) {
      const threadState = selectThreadTerminalState(
        terminalStateByThreadId,
        ThreadId.makeUnsafe(session.id),
      );
      map.set(
        session.id,
        resolveThreadTerminalVisualState({
          runningTerminalIds: threadState.runningTerminalIds,
          terminalAttentionStatesById: threadState.terminalAttentionStatesById ?? {},
        }),
      );
    }
    return map;
  }, [sessions, terminalStateByThreadId]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapsed = (cwd: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      return next;
    });

  const isMac = typeof navigator !== "undefined" ? isMacPlatform(navigator.platform) : false;

  return (
    <>
      {isElectron ? (
        // Frameless titlebar: drag region + leading inset so content clears the
        // native macOS traffic lights (matches the original sidebar header).
        <SidebarHeader
          className={cn(
            "drag-region h-[46px] flex-row items-center gap-2 px-4 py-0 font-system-ui",
            isMac && DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS,
          )}
        >
          <SidebarLeadingControls className="hidden md:flex" />
        </SidebarHeader>
      ) : (
        <SidebarHeader className="px-3 py-2.5 font-system-ui">
          <SidebarLeadingControls />
        </SidebarHeader>
      )}

      <SidebarContent className="gap-0 font-system-ui">
        {isOnSettings ? (
          <SidebarGroup className="p-0">
            <SettingsSidebarNav
              activeSection={activeSettingsSection}
              hiddenSections={TERMINAL_HIDDEN_SETTINGS_SECTIONS}
              onBack={() => void navigate({ to: "/" })}
              onSelectSection={(section, options) => {
                void navigate({
                  to: "/settings",
                  search: (previous) => ({
                    ...previous,
                    section: section === "general" ? undefined : section,
                    target: options?.target,
                  }),
                });
              }}
            />
          </SidebarGroup>
        ) : (
          <>
            <SidebarGroup className="px-2 pt-2 pb-1">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton onClick={() => openLauncher()}>
                    <NewThreadIcon />
                    <span>New project</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>

            <SidebarGroup className="px-2 py-1">
              <SidebarGroupLabel>Projects</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {projects.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-muted-foreground">No projects yet.</p>
                  ) : (
                    projects.map(([cwd, items]) => {
                      const isCollapsed = collapsed.has(cwd);
                      const isPinned = pinnedProjects.includes(cwd);
                      // When the project is collapsed, surface its busiest child session's
                      // state on the header so running agents are noticeable without expanding.
                      const groupState = mergeTerminalVisualStates(
                        items.map((session) => sessionVisualStateById.get(session.id) ?? "idle"),
                      );
                      return (
                        <SidebarMenuItem key={cwd}>
                          <SidebarMenuButton onClick={() => toggleCollapsed(cwd)}>
                            {isCollapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
                            <FolderIcon />
                            <span className="truncate" title={cwd}>
                              {folderName(cwd)}
                            </span>
                            {isCollapsed && groupState !== "idle" ? (
                              <TerminalActivityIndicator state={groupState} className="ml-auto" />
                            ) : null}
                          </SidebarMenuButton>
                          <SidebarMenuAction
                            showOnHover={!isPinned}
                            className="right-7"
                            aria-label={isPinned ? "Unpin project" : "Pin project"}
                            onClick={() => togglePinnedProject(cwd)}
                          >
                            {isPinned ? <PinFilledIcon /> : <PinIcon />}
                          </SidebarMenuAction>
                          <SidebarMenuAction
                            showOnHover
                            aria-label="New session in this project"
                            onClick={() => openLauncher(cwd)}
                          >
                            <NewThreadIcon />
                          </SidebarMenuAction>
                          {isCollapsed ? null : (
                            <SidebarMenuSub>
                              {items.map((session) => {
                                const isEditing = editing?.id === session.id;
                                const visualState =
                                  sessionVisualStateById.get(session.id) ?? "idle";
                                return (
                                  <SidebarMenuSubItem key={session.id} className="relative">
                                    <SidebarMenuSubButton
                                      isActive={session.id === activeSessionId}
                                      onClick={() => setActiveSession(session.id)}
                                      className={cn("cursor-pointer", isEditing ? "pr-2" : "pr-12")}
                                    >
                                      <TerminalIcon />
                                      {isEditing ? (
                                        <input
                                          autoFocus
                                          value={editing.draft}
                                          onClick={(e) => e.stopPropagation()}
                                          onChange={(e) =>
                                            setEditing({ id: session.id, draft: e.target.value })
                                          }
                                          onBlur={commitRename}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter") commitRename();
                                            else if (e.key === "Escape") setEditing(null);
                                          }}
                                          className="w-full min-w-0 bg-transparent outline-none"
                                        />
                                      ) : (
                                        <span className="truncate">{session.label}</span>
                                      )}
                                    </SidebarMenuSubButton>
                                    {isEditing ? null : (
                                      <>
                                        {visualState !== "idle" ? (
                                          <TerminalActivityIndicator
                                            state={visualState}
                                            className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 transition-opacity group-hover/menu-sub-item:opacity-0"
                                          />
                                        ) : null}
                                        <button
                                          type="button"
                                          aria-label="Rename session"
                                          onClick={() =>
                                            setEditing({ id: session.id, draft: session.label })
                                          }
                                          className="absolute top-1/2 right-7 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-sidebar-accent hover:text-foreground group-hover/menu-sub-item:opacity-100 [&>svg]:size-3.5"
                                        >
                                          <PencilIcon />
                                        </button>
                                        <button
                                          type="button"
                                          aria-label="Remove session"
                                          onClick={() => removeSession(session.id)}
                                          className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-sidebar-accent hover:text-foreground group-hover/menu-sub-item:opacity-100 [&>svg]:size-3.5"
                                        >
                                          <XIcon />
                                        </button>
                                      </>
                                    )}
                                  </SidebarMenuSubItem>
                                );
                              })}
                            </SidebarMenuSub>
                          )}
                        </SidebarMenuItem>
                      );
                    })
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="font-system-ui">
        {isOnSettings ? null : <SidebarProviderUsageFooter />}
        <SidebarMenu>
          <SidebarMenuItem>
            <LocalServersMenu
              align="end"
              side="right"
              renderTrigger={({ serverCount }) => (
                <MenuTrigger render={<SidebarMenuButton aria-label="Local servers" />}>
                  <GlobeIcon />
                  <span>Local servers</span>
                  {serverCount > 0 ? (
                    <span className="ml-auto inline-flex min-w-4 items-center justify-center rounded-full bg-success/15 px-1 text-[10px] font-medium tabular-nums text-success">
                      {serverCount}
                    </span>
                  ) : null}
                </MenuTrigger>
              )}
            />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={isOnSettings}
              onClick={() => void navigate({ to: "/settings" })}
            >
              <SettingsIcon />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}

export default SessionSidebar;
