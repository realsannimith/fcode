// Purpose: Renders the compact, explicitly layered terminal-agent icon stack in sidebar rows.
// Layer: Sidebar UI primitive

import type { TerminalIconKey } from "@t3tools/shared/terminalThreads";

import { pluralize } from "@t3tools/shared/text";
import { resolveSidebarTerminalIconStackLayout } from "../sidebarTerminalIconStack";
import TerminalIdentityIcon from "./terminal/TerminalIdentityIcon";

export function SidebarTerminalIconStack({
  iconKeys,
  terminalCount,
}: {
  iconKeys: readonly TerminalIconKey[];
  terminalCount: number;
}) {
  const layout = resolveSidebarTerminalIconStackLayout(iconKeys);
  if (layout.chips.length === 0) return null;

  const containsDetectedAgent = iconKeys.some((iconKey) => iconKey !== "terminal");
  const ariaLabel = containsDetectedAgent
    ? `${iconKeys.length} detected ${pluralize(iconKeys.length, "agent")} across ${terminalCount} ${pluralize(terminalCount, "terminal")}`
    : "Terminal open";

  return (
    <span
      role="img"
      aria-label={ariaLabel}
      data-sidebar-terminal-icon-stack
      className="relative inline-flex h-3 shrink-0"
      style={{ width: `${layout.widthPx}px` }}
    >
      {layout.chips.map((chip, index) => (
        <span
          key={chip.kind === "icon" ? `${chip.iconKey}-${index}` : `overflow-${index}`}
          aria-hidden="true"
          data-sidebar-terminal-icon-chip={chip.kind}
          className="sidebar-icon-chip absolute top-1/2 inline-flex size-3 -translate-y-1/2 items-center justify-center rounded-full"
          style={{ left: `${chip.leftPx}px`, zIndex: chip.zIndex }}
        >
          {chip.kind === "icon" ? (
            <TerminalIdentityIcon iconKey={chip.iconKey} className="size-2.5" />
          ) : (
            <span className="text-[7px] font-semibold leading-none text-muted-foreground">
              +{chip.overflowCount}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}
