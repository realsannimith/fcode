// FILE: AgentLauncher.tsx
// Purpose: CMUX-style home screen — pick a working folder, then launch a CLI agent in a
//          fresh terminal. Replaces the chat empty state as the default surface.
// Layer: Web launcher UI
//
// Styling note: this surface intentionally reuses the app's settings/sidebar design
// recipe — outline-only cards (`SETTINGS_CARD_CLASS_NAME`), lowercase muted section
// labels (`SETTINGS_SECTION_LABEL_CLASS_NAME`), `--color-*` tokens, app UI typography,
// and `secondary`-toned segmented controls — so it matches the rest of CTCode rather
// than the generic shadcn card/primary look it shipped with.

import { useEffect, useMemo, useState } from "react";

import {
  AGENT_LAUNCH_OPTIONS,
  buildCustomLaunchCommands,
  createSingleAgentLaunchCommand,
  customLaunchLabel,
  CUSTOM_LAUNCHER_PANE_LIMIT,
  type CustomLauncherConfig,
  type AgentLaunchOption,
} from "~/agentLaunchCommands";
import { CentralIcon } from "~/lib/central-icons";
import { PencilIcon, StarIcon, XIcon } from "~/lib/icons";
import { readNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import { useTerminalSessionsStore, type SavedCustomLauncher } from "~/terminalSessionsStore";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";
import { SETTINGS_CARD_CLASS_NAME, SETTINGS_SECTION_LABEL_CLASS_NAME } from "~/settingsPanelStyles";
import { MainSurface, MainTopBar } from "./MainTopBar";
import { cn } from "~/lib/utils";

function folderName(cwd: string): string {
  const parts = cwd.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

const CUSTOM_PANE_COUNTS = [1, 2, 3, 4] as const;

// Shared field-label tone for inputs inside the custom-launcher card.
const FIELD_LABEL_CLASS_NAME =
  "text-[length:var(--app-font-size-ui-sm,11px)] font-medium text-muted-foreground";

export function AgentLauncher() {
  const projects = useStore((state) => state.projects);
  const sessions = useTerminalSessionsStore((state) => state.sessions);
  const createSession = useTerminalSessionsStore((state) => state.createSession);
  const launcherCwd = useTerminalSessionsStore((state) => state.launcherCwd);
  const savedLaunchers = useTerminalSessionsStore((state) => state.savedLaunchers);
  const saveCustomLauncher = useTerminalSessionsStore((state) => state.saveCustomLauncher);
  const removeCustomLauncher = useTerminalSessionsStore((state) => state.removeCustomLauncher);

  const [cwd, setCwd] = useState(launcherCwd ?? "");
  const [customCommand, setCustomCommand] = useState("");
  const [customPaneCount, setCustomPaneCount] = useState<(typeof CUSTOM_PANE_COUNTS)[number]>(4);
  const [customizePanes, setCustomizePanes] = useState(false);
  const [customPaneCommands, setCustomPaneCommands] = useState(() =>
    Array.from({ length: CUSTOM_LAUNCHER_PANE_LIMIT }, () => ""),
  );
  // Name for saving the current custom config as a reusable preset.
  const [presetName, setPresetName] = useState("");
  // When set, Save updates the existing preset in place instead of adding a new one.
  const [editingLauncherId, setEditingLauncherId] = useState<string | null>(null);
  // Seed the folder when the launcher is opened for a specific project (sidebar "+").
  useEffect(() => {
    if (launcherCwd) setCwd(launcherCwd);
  }, [launcherCwd]);

  // Quick-pick folders: previously-launched session folders first, then known projects.
  const recentFolders = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const folder of [...sessions.map((s) => s.cwd), ...projects.map((p) => p.cwd)]) {
      const trimmed = folder.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
    return out.slice(0, 8);
  }, [projects, sessions]);

  // When the launcher was opened from a project's "+", pin the working folder to that
  // project dir so the new agent is created as a child of that project (path is fixed,
  // not re-pickable). A blank launcherCwd ("New project") keeps the free folder picker.
  const pinnedCwd = launcherCwd?.trim() ? launcherCwd.trim() : null;
  const trimmedCwd = pinnedCwd ?? cwd.trim();
  const canLaunch = trimmedCwd.length > 0;
  // The live custom-launcher config, shared by preview, launch, and save.
  const customConfig = useMemo<CustomLauncherConfig>(
    () => ({
      command: customCommand,
      paneCount: customPaneCount,
      customizePanes,
      paneCommands: customPaneCommands,
    }),
    [customCommand, customPaneCount, customizePanes, customPaneCommands],
  );
  const trimmedCustomCommand = customCommand.trim();
  const customLaunchCommands = useMemo(
    () => buildCustomLaunchCommands(customConfig),
    [customConfig],
  );
  const canLaunchCustom = canLaunch && customLaunchCommands.length > 0;
  // A preset is folder-independent, so saving only needs a runnable command.
  const canSavePreset = customLaunchCommands.length > 0;

  const browseForFolder = async () => {
    const picked = await readNativeApi()?.dialogs.pickFolder();
    if (picked) setCwd(picked);
  };

  const launch = (option: AgentLaunchOption) => {
    if (!canLaunch) return;
    createSession({
      cwd: trimmedCwd,
      agent: option.key,
      label: option.label,
      launchCommands: [createSingleAgentLaunchCommand(option)],
    });
  };

  const launchCustom = () => {
    if (!canLaunchCustom) return;
    createSession({
      cwd: trimmedCwd,
      agent: "custom",
      label: customLaunchLabel(customLaunchCommands),
      launchCommands: customLaunchCommands,
    });
  };

  const handleSavePreset = () => {
    if (!canSavePreset) return;
    const fallbackName = customLaunchLabel(customLaunchCommands);
    saveCustomLauncher({
      ...(editingLauncherId ? { id: editingLauncherId } : {}),
      name: presetName.trim() || fallbackName,
      config: customConfig,
    });
    setPresetName("");
    setEditingLauncherId(null);
    toastManager.add({
      type: "success",
      title: editingLauncherId ? "Custom launcher updated" : "Custom launcher saved",
      description: "Find it under Saved launchers to relaunch it anytime.",
    });
  };

  const loadSavedLauncher = (launcher: SavedCustomLauncher) => {
    setCustomCommand(launcher.command);
    setCustomPaneCount(
      Math.max(1, Math.min(launcher.paneCount, CUSTOM_LAUNCHER_PANE_LIMIT)) as 1 | 2 | 3 | 4,
    );
    setCustomizePanes(launcher.customizePanes);
    setCustomPaneCommands(
      Array.from(
        { length: CUSTOM_LAUNCHER_PANE_LIMIT },
        (_, index) => launcher.paneCommands[index] ?? "",
      ),
    );
    setPresetName(launcher.name);
    setEditingLauncherId(launcher.id);
  };

  const launchSavedLauncher = (launcher: SavedCustomLauncher) => {
    if (!canLaunch) return;
    const commands = buildCustomLaunchCommands(launcher);
    if (commands.length === 0) return;
    createSession({
      cwd: trimmedCwd,
      agent: "custom",
      label: launcher.name || customLaunchLabel(commands),
      launchCommands: commands,
    });
  };

  const removeSavedLauncher = (launcher: SavedCustomLauncher) => {
    removeCustomLauncher(launcher.id);
    if (editingLauncherId === launcher.id) {
      setEditingLauncherId(null);
    }
  };

  const setCustomPaneCommand = (index: number, value: string) => {
    setCustomPaneCommands((commands) => {
      const next = [...commands];
      next[index] = value;
      return next;
    });
  };

  return (
    <MainSurface>
      <MainTopBar />
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 py-10">
        <div className="flex w-full max-w-3xl flex-col gap-6">
          <header className="flex flex-col gap-1.5">
            <h1 className="text-xl font-medium tracking-tight text-foreground">Launch an agent</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {pinnedCwd
                ? `New agent in ${folderName(pinnedCwd)} — launch one command across split terminal panes.`
                : "Pick a folder, then launch one command across split terminal panes."}
            </p>
          </header>

          <section className="flex flex-col gap-2">
            <span className={SETTINGS_SECTION_LABEL_CLASS_NAME}>Working folder</span>
            {pinnedCwd ? (
              // Opened from a project's "+": the new agent is a child of this project, so the
              // folder is fixed. Use "New project" in the sidebar to launch in a different folder.
              <div
                className="flex flex-col rounded-md border border-[color:var(--color-border)] bg-[var(--color-background-elevated-secondary)] px-3 py-2"
                title={pinnedCwd}
              >
                <span className="truncate text-[length:var(--app-font-size-ui,12px)] font-medium text-foreground">
                  {folderName(pinnedCwd)}
                </span>
                <span className="truncate font-mono text-[length:var(--app-font-size-ui-sm,11px)] text-muted-foreground">
                  {pinnedCwd}
                </span>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input
                    value={cwd}
                    onChange={(event) => setCwd(event.target.value)}
                    placeholder="/path/to/project"
                    spellCheck={false}
                    className="flex-1 font-mono text-[length:var(--app-font-size-ui,12px)]"
                  />
                  <Button type="button" variant="chrome-outline" onClick={browseForFolder}>
                    Browse…
                  </Button>
                </div>
                {recentFolders.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 px-2">
                    {recentFolders.map((folder) => {
                      const isActive = trimmedCwd === folder;
                      return (
                        <button
                          key={folder}
                          type="button"
                          onClick={() => setCwd(folder)}
                          title={folder}
                          aria-pressed={isActive}
                          className={cn(
                            "rounded-md border px-2.5 py-1 text-[length:var(--app-font-size-ui-sm,11px)] transition-colors",
                            isActive
                              ? "border-[color:var(--color-border-focus)] bg-[var(--color-background-elevated-secondary)] text-foreground"
                              : "border-[color:var(--color-border)] text-muted-foreground hover:bg-[var(--color-background-elevated-secondary)] hover:text-foreground",
                          )}
                        >
                          {folderName(folder)}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </>
            )}
          </section>

          <section className={cn(SETTINGS_CARD_CLASS_NAME, "flex flex-col gap-4 p-4")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-[color:var(--color-border)] bg-muted/60">
                  <CentralIcon name="code-lines" className="size-4 text-muted-foreground" />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <h2 className="text-sm font-semibold text-foreground">Custom launcher</h2>
                  <p className="text-[length:var(--app-font-size-ui,12px)] text-muted-foreground">
                    Run the same CLI in multiple split panes, or override individual panes.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={!canLaunchCustom}
                onClick={launchCustom}
              >
                <CentralIcon name="layout-window" />
                Launch {customLaunchCommands.length || customPaneCount}
              </Button>
            </div>

            <label className="grid gap-1.5">
              <span className={FIELD_LABEL_CLASS_NAME}>Command</span>
              <Input
                value={customCommand}
                onChange={(event) => setCustomCommand(event.target.value)}
                placeholder="claude --dangerously-skip-permissions"
                spellCheck={false}
                className="font-mono text-[length:var(--app-font-size-ui,12px)]"
              />
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className={FIELD_LABEL_CLASS_NAME}>Panes</span>
                <div className="flex items-center gap-1 rounded-lg border border-[color:var(--color-border)] bg-[var(--color-background-elevated-secondary)]/40 p-1">
                  {CUSTOM_PANE_COUNTS.map((count) => {
                    const isActive = customPaneCount === count;
                    return (
                      <button
                        key={count}
                        type="button"
                        onClick={() => setCustomPaneCount(count)}
                        className={cn(
                          "flex size-8 items-center justify-center rounded-md text-[length:var(--app-font-size-ui-sm,11px)] font-semibold tabular-nums transition-colors",
                          isActive
                            ? "bg-secondary text-secondary-foreground shadow-sm"
                            : "text-muted-foreground hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground",
                        )}
                        aria-pressed={isActive}
                        aria-label={`${count} pane${count > 1 ? "s" : ""}`}
                      >
                        {count}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border px-3 py-1.5 transition-colors",
                  customizePanes
                    ? "border-[color:var(--color-border-focus)]/60 bg-[var(--color-background-elevated-secondary)]/40"
                    : "border-[color:var(--color-border)]",
                )}
              >
                <span className="text-[length:var(--app-font-size-ui-sm,11px)] font-medium text-foreground">
                  Customize each pane
                </span>
                <Switch checked={customizePanes} onCheckedChange={setCustomizePanes} />
              </label>
            </div>

            {/* One card per pane. When customizing, the card hosts an inline command override;
              otherwise it previews the command the pane will run (resolved from the override or
              the shared command above). A dot marks panes that have a command ready. */}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: customPaneCount }, (_, index) => {
                const override = customPaneCommands[index]?.trim();
                const resolved = customizePanes && override ? override : trimmedCustomCommand;
                const isReady = Boolean(resolved);
                return (
                  <div
                    key={index}
                    className="flex flex-col gap-2 rounded-xl border border-[color:var(--color-border)] bg-[var(--color-background-elevated-secondary)]/30 p-3 transition-colors hover:border-[color:var(--color-border-focus)]/50"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-md text-[length:var(--app-font-size-ui-sm,11px)] font-semibold tabular-nums transition-colors",
                          isReady
                            ? "bg-secondary text-secondary-foreground"
                            : "bg-muted/60 text-muted-foreground",
                        )}
                      >
                        {index + 1}
                      </span>
                      <span className="text-[length:var(--app-font-size-ui-sm,11px)] font-medium text-foreground">
                        Pane {index + 1}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "ml-auto size-1.5 rounded-full transition-colors",
                          isReady
                            ? "bg-emerald-500 dark:bg-emerald-400/90"
                            : "bg-muted-foreground/30",
                        )}
                        title={isReady ? "Ready" : "Waiting for command"}
                      />
                    </div>
                    {customizePanes ? (
                      <Input
                        value={customPaneCommands[index] ?? ""}
                        onChange={(event) => setCustomPaneCommand(index, event.target.value)}
                        placeholder={trimmedCustomCommand || "uses main command"}
                        spellCheck={false}
                        aria-label={`Pane ${index + 1} command`}
                        className="h-7 font-mono text-[length:var(--app-font-size-ui-sm,11px)]"
                      />
                    ) : (
                      <div className="truncate font-mono text-[length:var(--app-font-size-ui-sm,11px)] text-muted-foreground">
                        {resolved || "Waiting for command"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-col gap-2 border-t border-[color:var(--color-border)] pt-3 sm:flex-row sm:items-center">
              <Input
                value={presetName}
                onChange={(event) => setPresetName(event.target.value)}
                placeholder={editingLauncherId ? "Preset name" : "Name this launcher (optional)"}
                spellCheck={false}
                className="flex-1 text-[length:var(--app-font-size-ui,12px)]"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleSavePreset();
                  }
                }}
              />
              <div className="flex items-center gap-2">
                {editingLauncherId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingLauncherId(null);
                      setPresetName("");
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canSavePreset}
                  onClick={handleSavePreset}
                >
                  <StarIcon />
                  {editingLauncherId ? "Update preset" : "Save preset"}
                </Button>
              </div>
            </div>
            {!canLaunch ? (
              <p className="text-[length:var(--app-font-size-ui,12px)] text-muted-foreground">
                Choose a folder to enable launching.
              </p>
            ) : null}
          </section>

          {savedLaunchers.length > 0 ? (
            <section className="flex flex-col gap-2">
              <span className={SETTINGS_SECTION_LABEL_CLASS_NAME}>Saved launchers</span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {savedLaunchers.map((launcher) => {
                  const commands = buildCustomLaunchCommands(launcher);
                  const summary = launcher.command.trim() || customLaunchLabel(commands);
                  return (
                    <div
                      key={launcher.id}
                      className="group relative rounded-lg border border-[color:var(--color-border)] bg-transparent transition-colors hover:bg-[var(--color-background-elevated-secondary)]"
                    >
                      <button
                        type="button"
                        disabled={!canLaunch}
                        onClick={() => launchSavedLauncher(launcher)}
                        title={canLaunch ? `Launch ${launcher.name}` : "Choose a folder first"}
                        className="flex w-full flex-col items-start gap-1 px-4 py-3 pr-16 text-left disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span className="flex w-full items-center gap-1.5 text-[length:var(--app-font-size-ui,12px)] font-medium text-foreground">
                          <CentralIcon
                            name="layout-window"
                            className="size-3.5 shrink-0 text-muted-foreground"
                          />
                          <span className="truncate">{launcher.name}</span>
                        </span>
                        <span className="w-full truncate font-mono text-[length:var(--app-font-size-ui-sm,11px)] text-muted-foreground">
                          {summary}
                          {commands.length > 1 ? ` · ${commands.length} panes` : ""}
                        </span>
                      </button>
                      <div className="absolute right-2 top-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Edit ${launcher.name}`}
                          onClick={() => loadSavedLauncher(launcher)}
                        >
                          <PencilIcon />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Remove ${launcher.name}`}
                          onClick={() => removeSavedLauncher(launcher)}
                        >
                          <XIcon />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="flex flex-col gap-2">
            <span className={SETTINGS_SECTION_LABEL_CLASS_NAME}>Quick launch</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {AGENT_LAUNCH_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  disabled={!canLaunch}
                  onClick={() => launch(option)}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-lg border border-[color:var(--color-border)] bg-transparent px-4 py-3 text-left transition-colors",
                    "hover:bg-[var(--color-background-elevated-secondary)]",
                    "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
                  )}
                >
                  <span className="text-[length:var(--app-font-size-ui,12px)] font-medium text-foreground">
                    {option.label}
                  </span>
                  <span className="font-mono text-[length:var(--app-font-size-ui-sm,11px)] text-muted-foreground">
                    {option.command ?? "shell"}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </MainSurface>
  );
}

export default AgentLauncher;
