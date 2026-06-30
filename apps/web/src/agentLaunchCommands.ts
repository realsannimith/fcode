// FILE: agentLaunchCommands.ts
// Purpose: Single source of truth mapping a launchable agent to the CLI command
//          typed into a fresh terminal. Powers the CMUX-style agent launcher.
// Layer: Web launcher model
// Exports: AgentKey, AGENT_LAUNCH_OPTIONS, agentLaunchLabel, agentLaunchCommand

import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from "@t3tools/contracts";

// "shell" is a plain login shell (no command written); every other key is a
// ProviderKind whose interactive CLI binary we drop the user into.
export type AgentKey = ProviderKind | "shell" | "custom";

export interface AgentLaunchCommandSpec {
  id: string;
  label: string;
  command: string | null;
}

// The interactive entry point per provider. Note these are the bare TUI binaries
// (codex/opencode/kilo's *server* commands differ — those are for the old app-server
// backend, not an interactive terminal).
const PROVIDER_CLI_COMMAND: Record<ProviderKind, string> = {
  codex: "codex",
  claudeAgent: "claude",
  cursor: "cursor-agent",
  gemini: "gemini",
  grok: "grok",
  kilo: "kilo",
  opencode: "opencode",
  pi: "pi",
};

// Display order for the launcher grid; shell last as the escape hatch.
const PROVIDER_ORDER: ProviderKind[] = [
  "codex",
  "claudeAgent",
  "cursor",
  "gemini",
  "grok",
  "kilo",
  "opencode",
  "pi",
];

export interface AgentLaunchOption {
  key: AgentKey;
  label: string;
  // null = open a bare shell, no command written.
  command: string | null;
}

export const AGENT_LAUNCH_OPTIONS: AgentLaunchOption[] = [
  ...PROVIDER_ORDER.map((kind) => ({
    key: kind,
    label: PROVIDER_DISPLAY_NAMES[kind],
    command: PROVIDER_CLI_COMMAND[kind],
  })),
  { key: "shell", label: "Shell", command: null },
];

export function agentLaunchLabel(key: AgentKey): string {
  if (key === "shell") return "Shell";
  if (key === "custom") return "Custom";
  return PROVIDER_DISPLAY_NAMES[key];
}

export function agentLaunchCommand(key: AgentKey): string | null {
  if (key === "shell" || key === "custom") return null;
  return PROVIDER_CLI_COMMAND[key];
}

export function createSingleAgentLaunchCommand(
  option: Pick<AgentLaunchOption, "label" | "command">,
): AgentLaunchCommandSpec {
  return {
    id: "default",
    label: option.label,
    command: option.command,
  };
}

// ── Custom launcher (multi-pane) ────────────────────────────────────────────
// Shared config + builder used by the launcher form and any saved presets, so the
// "type a command, fan it across N panes, optionally override each pane" logic lives
// in one place instead of being duplicated at each call site.

export const CUSTOM_LAUNCHER_PANE_LIMIT = 4;

export interface CustomLauncherConfig {
  /** Primary command applied to every pane that has no override. */
  command: string;
  /** Number of split panes to open (1..CUSTOM_LAUNCHER_PANE_LIMIT). */
  paneCount: number;
  /** When true, per-pane overrides in `paneCommands` take precedence. */
  customizePanes: boolean;
  /** Per-pane command overrides (index-aligned to panes). */
  paneCommands: readonly string[];
}

/** Stable PTY id per pane index; pane 0 reuses the session's "default" terminal. */
export function customLaunchTerminalId(index: number): string {
  return index === 0 ? "default" : `launch-${index + 1}`;
}

/**
 * Resolve a CustomLauncherConfig into the concrete per-pane launch commands,
 * dropping any pane whose effective command is empty. Pure + deterministic so it
 * can back both the live launcher preview and saved-preset launches.
 */
export function buildCustomLaunchCommands(config: CustomLauncherConfig): AgentLaunchCommandSpec[] {
  const mainCommand = config.command.trim();
  const paneCount = Math.max(0, Math.min(config.paneCount, CUSTOM_LAUNCHER_PANE_LIMIT));
  return Array.from({ length: paneCount }, (_, index): AgentLaunchCommandSpec => {
    const override = config.customizePanes ? (config.paneCommands[index]?.trim() ?? "") : "";
    return {
      id: customLaunchTerminalId(index),
      label: `Pane ${index + 1}`,
      command: override || mainCommand,
    };
  }).filter((entry) => (entry.command ?? "").length > 0);
}

/** Short human label for a custom launch (its command, or "Custom split (N)"). */
export function customLaunchLabel(commands: readonly AgentLaunchCommandSpec[]): string {
  if (commands.length === 1) {
    const command = commands[0]?.command?.trim();
    if (command) {
      return command.length > 42 ? `${command.slice(0, 39).trimEnd()}...` : command;
    }
  }
  return `Custom split (${commands.length})`;
}
