// FILE: TerminalAgentLauncherMenu.tsx
// Purpose: Terminal-header dropdown that launches a user-configured AI CLI (Claude, Codex, …)
//          in a fresh terminal on one click. The command list is the `agentLaunchers` app
//          setting, editable in Settings → Behavior → Agent launchers.
// Layer: Terminal presentation components

import { useAppSettings } from "~/appSettings";
import { agentLauncherIconKey } from "~/agentLaunchers";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { SettingsIcon, SparklesIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

import { DOCK_HEADER_ICON_BUTTON_CLASS } from "../chat/chatHeaderControls";
import TerminalIdentityIcon from "./TerminalIdentityIcon";

export interface TerminalAgentLaunch {
  command: string;
  label: string;
}

// Keep the highlighted-item hover behaviour consistent with the terminal chrome (no accent
// swap on plain hover, only on keyboard/focus) — mirrors ProjectScriptsControl's menu rows.
// The default menu surface applies no row padding, so set it here: without it the label
// sits flush against the panel edge and the hover fill hugs the text.
const menuItemClassName =
  "min-h-7 gap-2 px-2 py-1 data-highlighted:bg-transparent data-highlighted:text-foreground hover:bg-[var(--sidebar-accent)] hover:text-foreground focus-visible:bg-[var(--sidebar-accent)] focus-visible:text-foreground";

export function TerminalAgentLauncherMenu({
  onLaunch,
  onOpenSettings,
}: {
  onLaunch: (launch: TerminalAgentLaunch) => void;
  onOpenSettings?: (() => void) | undefined;
}) {
  const { settings } = useAppSettings();
  const launchers = settings.agentLaunchers;

  return (
    <Menu highlightItemOnHover={false}>
      <MenuTrigger
        render={
          <Button
            size="icon-xs"
            variant="chrome"
            className={DOCK_HEADER_ICON_BUTTON_CLASS}
            aria-label="Launch AI agent"
            title="Launch AI agent"
          />
        }
      >
        <SparklesIcon className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="start">
        {launchers.length === 0 ? (
          <MenuItem className={cn(menuItemClassName, "text-muted-foreground")} disabled>
            No launchers configured
          </MenuItem>
        ) : (
          launchers.map((launcher) => (
            <MenuItem
              key={launcher.id}
              className={menuItemClassName}
              onClick={() => onLaunch({ command: launcher.command, label: launcher.label })}
            >
              <TerminalIdentityIcon
                className="size-4"
                iconKey={agentLauncherIconKey(launcher.command)}
              />
              <span className="truncate">{launcher.label}</span>
            </MenuItem>
          ))
        )}
        {onOpenSettings ? (
          <MenuItem className={menuItemClassName} onClick={onOpenSettings}>
            <SettingsIcon className="size-4" />
            <span className="truncate">Edit launchers…</span>
          </MenuItem>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

export default TerminalAgentLauncherMenu;
