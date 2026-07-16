// FILE: AgentLaunchersSettingsSection.tsx
// Purpose: Settings → Behavior → Agent launchers. Edit the quick-launch commands surfaced in
//          the terminal header dropdown (e.g. `claude --dangerously-skip-permissions`,
//          `codex --yolo`). Backed by the local-only `agentLaunchers` app setting.
// Layer: Web settings presentation

import { useCallback, useEffect, useRef, useState } from "react";

import {
  agentLauncherIconKey,
  type AgentLauncher,
  cloneDefaultAgentLaunchers,
  MAX_AGENT_LAUNCHER_COMMAND_LENGTH,
  MAX_AGENT_LAUNCHER_LABEL_LENGTH,
  MAX_AGENT_LAUNCHERS,
  nextAgentLauncherId,
  normalizeAgentLaunchers,
} from "~/agentLaunchers";
import { useAppSettings } from "~/appSettings";
import TerminalIdentityIcon from "~/components/terminal/TerminalIdentityIcon";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { PlusIcon, XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import {
  SETTINGS_CARD_ROW_DIVIDER_CLASS_NAME,
  SETTINGS_INSET_LIST_CLASS_NAME,
} from "~/settingsPanelStyles";

import { SettingResetButton } from "./SettingControls";
import { SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";

function launchersEqual(left: readonly AgentLauncher[], right: readonly AgentLauncher[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function AgentLaunchersSettingsSection() {
  const { settings, defaults, updateSettings } = useAppSettings();
  const persisted = settings.agentLaunchers;

  // Local draft so an in-progress (half-filled) row stays visible while typing. Only the
  // normalized/valid subset is ever committed, so localStorage never sees an empty entry.
  const [rows, setRows] = useState<AgentLauncher[]>(() => persisted.map((entry) => ({ ...entry })));
  const lastCommittedRef = useRef<string>(JSON.stringify(persisted));

  // Re-seed the draft only when the persisted value changes for a reason other than our own
  // commit (e.g. Reset all settings, or an edit from another window).
  useEffect(() => {
    const incoming = JSON.stringify(persisted);
    if (incoming === lastCommittedRef.current) return;
    lastCommittedRef.current = incoming;
    setRows(persisted.map((entry) => ({ ...entry })));
  }, [persisted]);

  const commit = useCallback(
    (nextRows: AgentLauncher[]) => {
      const valid = normalizeAgentLaunchers(nextRows);
      lastCommittedRef.current = JSON.stringify(valid);
      updateSettings({ agentLaunchers: valid });
    },
    [updateSettings],
  );

  const patchRow = useCallback(
    (id: string, patch: Partial<Pick<AgentLauncher, "label" | "command">>) => {
      setRows((current) => {
        const next = current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
        commit(next);
        return next;
      });
    },
    [commit],
  );

  const removeRow = useCallback(
    (id: string) => {
      setRows((current) => {
        const next = current.filter((entry) => entry.id !== id);
        commit(next);
        return next;
      });
    },
    [commit],
  );

  const addRow = useCallback(() => {
    setRows((current) => {
      if (current.length >= MAX_AGENT_LAUNCHERS) return current;
      const id = nextAgentLauncherId(
        "launcher",
        current.map((entry) => entry.id),
      );
      // No commit: a blank row persists nothing until it has a label and command.
      return [...current, { id, label: "", command: "" }];
    });
  }, []);

  const resetToDefaults = useCallback(() => {
    const next = cloneDefaultAgentLaunchers();
    setRows(next);
    commit(next);
  }, [commit]);

  const isDefault = launchersEqual(persisted, defaults.agentLaunchers);
  const atLimit = rows.length >= MAX_AGENT_LAUNCHERS;

  return (
    <SettingsSection title="Agent launchers">
      <SettingsRow
        title="Terminal quick-launch commands"
        description="One-click buttons in the terminal header that run an AI CLI in an idle terminal or open a fresh tab when needed. Customize the command however you like — e.g. add --dangerously-skip-permissions or --yolo."
        resetAction={
          isDefault ? null : (
            <SettingResetButton label="agent launchers" onClick={resetToDefaults} />
          )
        }
      >
        <div className={cn("mt-4 pt-4", SETTINGS_CARD_ROW_DIVIDER_CLASS_NAME)}>
          {rows.length > 0 ? (
            <div className={SETTINGS_INSET_LIST_CLASS_NAME}>
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="group flex flex-col gap-2 border-t border-[color:var(--color-border)] px-3 py-2.5 first:border-t-0 sm:flex-row sm:items-center"
                >
                  <div className="flex items-center gap-2 sm:w-44 sm:shrink-0">
                    <TerminalIdentityIcon
                      className="size-4 shrink-0 text-muted-foreground"
                      iconKey={agentLauncherIconKey(row.command)}
                    />
                    <Input
                      size="sm"
                      variant="soft"
                      className="min-w-0 flex-1"
                      value={row.label}
                      maxLength={MAX_AGENT_LAUNCHER_LABEL_LENGTH}
                      placeholder="Label"
                      spellCheck={false}
                      aria-label="Launcher label"
                      onChange={(event) => patchRow(row.id, { label: event.target.value })}
                    />
                  </div>
                  <Input
                    size="sm"
                    variant="soft"
                    className="min-w-0 flex-1 font-mono text-xs"
                    value={row.command}
                    maxLength={MAX_AGENT_LAUNCHER_COMMAND_LENGTH}
                    placeholder="claude --dangerously-skip-permissions"
                    spellCheck={false}
                    aria-label="Launcher command"
                    onChange={(event) => patchRow(row.id, { command: event.target.value })}
                  />
                  <button
                    type="button"
                    className="shrink-0 self-end opacity-60 transition-opacity hover:opacity-100 group-hover:opacity-100 sm:self-center"
                    aria-label={`Remove ${row.label.trim() || "launcher"}`}
                    onClick={() => removeRow(row.id)}
                  >
                    <XIcon className="size-3.5 text-muted-foreground hover:text-foreground" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No launchers yet. Add one to show it in the terminal header dropdown.
            </p>
          )}

          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={addRow} disabled={atLimit}>
              <PlusIcon className="size-3.5" />
              Add launcher
            </Button>
            {atLimit ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Maximum of {MAX_AGENT_LAUNCHERS} launchers reached.
              </p>
            ) : null}
          </div>
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}

export default AgentLaunchersSettingsSection;
