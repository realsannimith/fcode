// FILE: TerminalWorkspaceTabs.tsx
// Purpose: Renders the top-level workspace switcher between terminal and chat surfaces.
// Layer: Chat workspace chrome
// Depends on: terminal workspace store layout state and shared className helpers.
//
// Note: the two raw <button>s are intentional — they are tabs, not shadcn
// Buttons. Tab-shape rendering (rounded-top corners, no bottom border on the
// active tab, z-index stacking) doesn't fit the Button taxonomy.

import { cn } from "~/lib/utils";

import { type ThreadTerminalWorkspaceTab } from "../types";
import { AgentProgressIndicator } from "./ui/agent-progress-indicator";

interface TerminalWorkspaceTabsProps {
  activeTab: ThreadTerminalWorkspaceTab;
  isWorking: boolean;
  terminalCount: number;
  variant?: "row" | "inline";
  onSelectTab: (tab: ThreadTerminalWorkspaceTab) => void;
}

export default function TerminalWorkspaceTabs({
  activeTab,
  isWorking,
  terminalCount,
  variant = "row",
  onSelectTab,
}: TerminalWorkspaceTabsProps) {
  const tabClassName =
    "group relative -mb-px inline-flex h-8 shrink-0 items-center rounded-t-[10px] border border-b-0 px-3 text-xs transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

  const tabs = (
    <div
      role="tablist"
      aria-label="Thread views"
      className="flex min-w-0 items-end gap-1.5 overflow-x-auto pt-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "terminal"}
        className={cn(
          tabClassName,
          activeTab === "terminal"
            ? "z-[1] border-border/70 bg-[var(--composer-surface)] text-foreground"
            : "border-transparent bg-transparent text-muted-foreground hover:bg-background/55 hover:text-foreground",
        )}
        onClick={() => {
          onSelectTab("terminal");
        }}
      >
        <span className="font-mono tracking-wide">Terminal</span>
        {terminalCount > 0 ? (
          <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
            {terminalCount}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "chat"}
        className={cn(
          tabClassName,
          activeTab === "chat"
            ? "z-[1] border-border/70 bg-[var(--composer-surface)] text-foreground"
            : "border-transparent bg-transparent text-muted-foreground hover:bg-background/55 hover:text-foreground",
        )}
        onClick={() => {
          onSelectTab("chat");
        }}
      >
        <span className="font-mono tracking-wide">Chat</span>
        {isWorking ? (
          <AgentProgressIndicator className="ml-1.5" label="Chat agent is generating" />
        ) : null}
      </button>
    </div>
  );

  if (variant === "inline") {
    return tabs;
  }

  return (
    <div className="relative border-b border-border/70 bg-muted/10 px-3 sm:px-5">
      {tabs}
    </div>
  );
}
