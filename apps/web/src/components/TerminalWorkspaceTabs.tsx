// FILE: TerminalWorkspaceTabs.tsx
// Purpose: Renders the top-level workspace switcher between terminal and one or more chats.
// Layer: Chat workspace chrome
// Depends on: terminal workspace store layout state and shared className helpers.
//
// Note: the two raw <button>s are intentional — they are tabs, not shadcn
// Buttons. Tab-shape rendering (rounded-top corners, no bottom border on the
// active tab, z-index stacking) doesn't fit the Button taxonomy.

import type { ThreadId } from "@t3tools/contracts";

import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { MessageCircleIcon, Plus, TerminalIcon, XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

import { type ThreadTerminalWorkspaceTab } from "../types";
import { AgentProgressIndicator } from "./ui/agent-progress-indicator";

export interface WorkspaceChatTab {
  id: ThreadId;
  label: string;
  title?: string;
  isWorking: boolean;
  canClose: boolean;
}

interface TerminalWorkspaceTabsProps {
  activeTab: ThreadTerminalWorkspaceTab;
  activeChatTabId?: ThreadId;
  chatTabs?: readonly WorkspaceChatTab[];
  isWorking: boolean;
  terminalCount: number;
  variant?: "row" | "inline";
  onSelectTab: (tab: ThreadTerminalWorkspaceTab) => void;
  onSelectChatTab?: (threadId: ThreadId) => void;
  onAddChatTab?: () => void;
  onAddTerminalTab?: () => void;
  onCloseChatTab?: (threadId: ThreadId) => void;
}

export default function TerminalWorkspaceTabs({
  activeTab,
  activeChatTabId,
  chatTabs,
  isWorking,
  terminalCount,
  variant = "row",
  onSelectTab,
  onSelectChatTab,
  onAddChatTab,
  onAddTerminalTab,
  onCloseChatTab,
}: TerminalWorkspaceTabsProps) {
  const tabClassName =
    "group relative -mb-px inline-flex h-8 shrink-0 items-center rounded-t-[10px] border border-b-0 px-3 text-xs transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

  const resolvedChatTabs =
    chatTabs && chatTabs.length > 0
      ? chatTabs
      : ([
          {
            id: activeChatTabId ?? ("chat" as ThreadId),
            label: "Chat",
            isWorking,
            canClose: false,
          },
        ] satisfies readonly WorkspaceChatTab[]);

  const tabs = (
    <div className="flex min-w-0 items-end gap-1.5">
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
        {resolvedChatTabs.map((chatTab) => {
          const isActive =
            activeTab === "chat" &&
            (activeChatTabId === undefined || chatTab.id === activeChatTabId);
          return (
            <div
              key={chatTab.id}
              role="presentation"
              title={chatTab.title}
              className={cn(
                tabClassName,
                isActive
                  ? "z-[1] border-border/70 bg-[var(--composer-surface)] text-foreground"
                  : "border-transparent bg-transparent text-muted-foreground hover:bg-background/55 hover:text-foreground",
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={chatTab.title ? `${chatTab.label}: ${chatTab.title}` : chatTab.label}
                className="flex min-w-0 flex-1 items-center focus-visible:z-10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => {
                  if (onSelectChatTab) {
                    onSelectChatTab(chatTab.id);
                  } else {
                    onSelectTab("chat");
                  }
                }}
              >
                <span className="font-mono tracking-wide">{chatTab.label}</span>
                {chatTab.isWorking ? (
                  <AgentProgressIndicator
                    className="ml-1.5"
                    label={`${chatTab.label} agent is generating`}
                  />
                ) : null}
              </button>
              {chatTab.canClose && onCloseChatTab ? (
                <button
                  type="button"
                  aria-label={`Close ${chatTab.label}`}
                  title={`Close ${chatTab.label}`}
                  className="ml-1 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseChatTab(chatTab.id);
                  }}
                >
                  <XIcon className="size-3" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {onAddChatTab || onAddTerminalTab ? (
        <Menu modal={false}>
          <MenuTrigger
            aria-label="Add workspace tab"
            title="Add workspace tab"
            className="mb-px inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/55 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Plus className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="start" className="min-w-44">
            {onAddChatTab ? (
              <MenuItem onClick={onAddChatTab}>
                <MessageCircleIcon className="mr-2 size-3.5" />
                New chat
              </MenuItem>
            ) : null}
            {onAddTerminalTab ? (
              <MenuItem onClick={onAddTerminalTab}>
                <TerminalIcon className="mr-2 size-3.5" />
                New terminal
              </MenuItem>
            ) : null}
          </MenuPopup>
        </Menu>
      ) : null}
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
