// FILE: terminalSessionsStore.ts
// Purpose: Persisted list of CMUX-style terminal sessions ({ cwd, agent }) plus the
//          active selection. Replaces the chat-thread list as the app's primary surface.
// Layer: UI state store
// Exports: useTerminalSessionsStore, type TerminalSession

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { AgentKey, AgentLaunchCommandSpec, CustomLauncherConfig } from "./agentLaunchCommands";

export interface TerminalSession {
  id: string;
  cwd: string;
  agent: AgentKey;
  label: string;
  launchCommands?: AgentLaunchCommandSpec[];
  createdAt: string;
  // Whether the agent command has already been typed into the PTY. Guards against
  // re-running the CLI when the session view re-mounts. ponytail: not reset on
  // server restart (the PTY is gone but we won't auto-relaunch); make a new session.
  launched: boolean;
}

// A user-saved custom launcher preset: a reusable, folder-independent multi-pane
// command setup that shows up alongside the built-in quick-launch agents.
export interface SavedCustomLauncher extends CustomLauncherConfig {
  id: string;
  name: string;
  createdAt: string;
}

interface TerminalSessionsStoreState {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  // Project cwds the user pinned to the top of the sidebar.
  pinnedProjects: string[];
  // When the launcher is shown, seeds its folder input (e.g. "+ new agent in this project").
  launcherCwd: string | null;
  // User-saved custom launcher presets, newest first.
  savedLaunchers: SavedCustomLauncher[];
  createSession: (input: {
    cwd: string;
    agent: AgentKey;
    label: string;
    launchCommands?: AgentLaunchCommandSpec[];
  }) => string;
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;
  openLauncher: (cwd?: string) => void;
  markLaunched: (id: string) => void;
  renameSession: (id: string, label: string) => void;
  togglePinnedProject: (cwd: string) => void;
  // Persist the given config as a named preset; returns its id. When `id` is
  // provided the matching preset is updated in place instead of added.
  saveCustomLauncher: (input: {
    id?: string;
    name: string;
    config: CustomLauncherConfig;
  }) => string;
  removeCustomLauncher: (id: string) => void;
}

const STORAGE_KEY = "ctcode:terminal-sessions:v1";

function newSessionId(): string {
  return crypto.randomUUID();
}

export const useTerminalSessionsStore = create<TerminalSessionsStoreState>()(
  persist(
    (set) => ({
      sessions: [],
      activeSessionId: null,
      pinnedProjects: [],
      launcherCwd: null,
      savedLaunchers: [],
      createSession: ({ cwd, agent, label, launchCommands }) => {
        const id = newSessionId();
        const session: TerminalSession = {
          id,
          cwd,
          agent,
          label,
          ...(launchCommands ? { launchCommands } : {}),
          createdAt: new Date().toISOString(),
          launched: false,
        };
        set((state) => ({
          sessions: [session, ...state.sessions],
          activeSessionId: id,
          launcherCwd: null,
        }));
        return id;
      },
      removeSession: (id) => {
        set((state) => {
          const sessions = state.sessions.filter((session) => session.id !== id);
          const activeSessionId =
            state.activeSessionId === id ? (sessions[0]?.id ?? null) : state.activeSessionId;
          return { sessions, activeSessionId };
        });
      },
      setActiveSession: (id) => set({ activeSessionId: id }),
      openLauncher: (cwd) => set({ activeSessionId: null, launcherCwd: cwd ?? null }),
      markLaunched: (id) => {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === id ? { ...session, launched: true } : session,
          ),
        }));
      },
      renameSession: (id, label) => {
        const trimmed = label.trim();
        if (!trimmed) return;
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === id ? { ...session, label: trimmed } : session,
          ),
        }));
      },
      togglePinnedProject: (cwd) => {
        set((state) => ({
          pinnedProjects: state.pinnedProjects.includes(cwd)
            ? state.pinnedProjects.filter((p) => p !== cwd)
            : [...state.pinnedProjects, cwd],
        }));
      },
      saveCustomLauncher: ({ id, name, config }) => {
        const trimmedName = name.trim();
        const normalizedConfig: CustomLauncherConfig = {
          command: config.command.trim(),
          paneCount: Math.max(1, Math.min(config.paneCount, 4)),
          customizePanes: config.customizePanes,
          paneCommands: config.paneCommands.map((command) => command.trim()),
        };
        const resolvedId = id ?? newSessionId();
        set((state) => {
          const existingIndex = state.savedLaunchers.findIndex(
            (launcher) => launcher.id === resolvedId,
          );
          if (existingIndex >= 0) {
            const existing = state.savedLaunchers[existingIndex]!;
            const updated: SavedCustomLauncher = {
              ...existing,
              ...normalizedConfig,
              name: trimmedName || existing.name,
            };
            const savedLaunchers = [...state.savedLaunchers];
            savedLaunchers[existingIndex] = updated;
            return { savedLaunchers };
          }
          const launcher: SavedCustomLauncher = {
            id: resolvedId,
            name: trimmedName || normalizedConfig.command || "Custom launcher",
            createdAt: new Date().toISOString(),
            ...normalizedConfig,
          };
          return { savedLaunchers: [launcher, ...state.savedLaunchers] };
        });
        return resolvedId;
      },
      removeCustomLauncher: (id) => {
        set((state) => ({
          savedLaunchers: state.savedLaunchers.filter((launcher) => launcher.id !== id),
        }));
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
        pinnedProjects: state.pinnedProjects,
        savedLaunchers: state.savedLaunchers,
      }),
    },
  ),
);
