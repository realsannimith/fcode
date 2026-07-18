// FILE: TerminalIdentityIcon.tsx
// Purpose: Renders a terminal/provider icon without extra activity chrome.
// Layer: Terminal presentation primitive
// Depends on: shared terminal icon keys plus local provider/icon components.

import type { TerminalIconKey } from "@t3tools/shared/terminalThreads";

import grokLogoUrl from "~/assets/grok.svg";
import kiroLogoUrl from "~/assets/kiro.svg";
import openCodeLogoUrl from "~/assets/opencode.svg";
import { BotIcon, TerminalSquare } from "~/lib/icons";
import { cn } from "~/lib/utils";

import { ClaudeAI, CursorIcon, OpenAI } from "../Icons";

interface TerminalIdentityIconProps {
  iconKey: TerminalIconKey;
  className?: string;
}

// Keep provider branding reusable across every terminal surface.
export default function TerminalIdentityIcon({ iconKey, className }: TerminalIdentityIconProps) {
  if (iconKey === "kiro") {
    return (
      <img
        src={kiroLogoUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={cn("shrink-0 rounded-[3px] object-contain", className)}
      />
    );
  }

  if (iconKey === "grok") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-[3px] bg-black",
          className,
        )}
      >
        <img src={grokLogoUrl} alt="" draggable={false} className="size-[82%] object-contain" />
      </span>
    );
  }

  if (iconKey === "opencode") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-[3px] bg-white",
          className,
        )}
      >
        <img src={openCodeLogoUrl} alt="" draggable={false} className="size-[88%] object-contain" />
      </span>
    );
  }

  const IconComponent =
    iconKey === "openai"
      ? OpenAI
      : iconKey === "claude"
        ? ClaudeAI
        : iconKey === "cursor"
          ? CursorIcon
          : iconKey === "agent"
            ? BotIcon
            : TerminalSquare;

  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center", className)}>
      <IconComponent className={cn("size-full text-[var(--color-text-foreground)]")} />
    </span>
  );
}
