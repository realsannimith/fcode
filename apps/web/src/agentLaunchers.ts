// FILE: agentLaunchers.ts
// Purpose: User-customizable quick-launch commands for AI coding CLIs (Claude, Codex, …)
//          typed into a managed terminal on a single click. Shared data model + helpers.
// Layer: Web terminal orchestration helper
// Exports: AgentLauncher type, defaults, limits, and id/icon/normalization helpers.

import {
  deriveTerminalCommandIdentity,
  type TerminalIconKey,
} from "@t3tools/shared/terminalThreads";

export interface AgentLauncher {
  // Stable per-entry id used for React keys and menu identity. Derived from the label.
  id: string;
  // Human-facing menu label (e.g. "Claude (skip permissions)").
  label: string;
  // Raw shell command written into the PTY (e.g. "claude --dangerously-skip-permissions").
  command: string;
}

export const MAX_AGENT_LAUNCHERS = 24;
export const MAX_AGENT_LAUNCHER_LABEL_LENGTH = 60;
export const MAX_AGENT_LAUNCHER_COMMAND_LENGTH = 512;
export const MAX_AGENT_LAUNCHER_ID_LENGTH = 64;

// Seeded so the feature works out of the box; every entry is fully editable/removable in
// Settings → Behavior → Agent launchers. The example flags are exactly what users asked for.
export const DEFAULT_AGENT_LAUNCHERS: readonly AgentLauncher[] = [
  { id: "claude", label: "Claude", command: "claude" },
  {
    id: "claude-skip-permissions",
    label: "Claude (skip permissions)",
    command: "claude --dangerously-skip-permissions",
  },
  { id: "codex", label: "Codex", command: "codex" },
  { id: "codex-yolo", label: "Codex (YOLO)", command: "codex --yolo" },
];

// Icon shown next to a launcher, derived from the command so a custom `claude`/`codex`
// wrapper still gets the right glyph. Falls back to a generic terminal icon.
export function agentLauncherIconKey(command: string): TerminalIconKey {
  return deriveTerminalCommandIdentity(command)?.iconKey ?? "terminal";
}

function slugifyAgentLauncherLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_AGENT_LAUNCHER_ID_LENGTH);
  return slug.length > 0 ? slug : "launcher";
}

// Collision-free id derived from the label so menu keys stay unique across entries.
export function nextAgentLauncherId(label: string, existingIds: readonly string[]): string {
  const base = slugifyAgentLauncherLabel(label);
  const taken = new Set(existingIds);
  if (!taken.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${existingIds.length + 1}`;
}

// Drop blank entries, de-dupe ids, and cap the list so a corrupt or oversized persisted
// value can never render an unbounded menu. Intentionally does NOT trim label/command so a
// value can be edited mid-keystroke without losing spaces (the schema trims on next load).
// Idempotent: re-running on already-normalized input returns an equivalent list.
export function normalizeAgentLaunchers(launchers: readonly AgentLauncher[]): AgentLauncher[] {
  const normalized: AgentLauncher[] = [];
  const seenIds = new Set<string>();
  for (const launcher of launchers) {
    if (normalized.length >= MAX_AGENT_LAUNCHERS) break;
    const label = launcher.label.slice(0, MAX_AGENT_LAUNCHER_LABEL_LENGTH);
    const command = launcher.command.slice(0, MAX_AGENT_LAUNCHER_COMMAND_LENGTH);
    if (label.trim().length === 0 || command.trim().length === 0) continue;
    let id = launcher.id.trim().slice(0, MAX_AGENT_LAUNCHER_ID_LENGTH);
    if (id.length === 0 || seenIds.has(id)) {
      id = nextAgentLauncherId(label, [...seenIds]);
    }
    seenIds.add(id);
    normalized.push({ id, label, command });
  }
  return normalized;
}

export function cloneDefaultAgentLaunchers(): AgentLauncher[] {
  return DEFAULT_AGENT_LAUNCHERS.map((launcher) => ({
    id: launcher.id,
    label: launcher.label,
    command: launcher.command,
  }));
}
