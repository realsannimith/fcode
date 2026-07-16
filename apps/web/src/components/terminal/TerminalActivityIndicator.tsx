// FILE: TerminalActivityIndicator.tsx
// Purpose: Compact terminal lifecycle indicator — a pulsing dot while the agent is
// running, a steady dot for attention/review. Renders nothing when idle.
// Layer: Terminal presentation primitive

import type { TerminalVisualState } from "@t3tools/shared/terminalThreads";

import { cn } from "~/lib/utils";
import { AgentProgressIndicator } from "../ui/agent-progress-indicator";

interface TerminalActivityIndicatorProps {
  className?: string;
  state: TerminalVisualState;
}

export default function TerminalActivityIndicator({
  className,
  state,
}: TerminalActivityIndicatorProps) {
  if (state === "idle") {
    return null;
  }

  // Running uses the shared generating ring so terminal-backed agents and native
  // provider sessions communicate live work with exactly the same visual language.
  if (state === "running") {
    return (
      <AgentProgressIndicator
        className={className}
        label="Terminal agent is generating"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-1.5 shrink-0 rounded-full",
        state === "attention"
          ? "bg-amber-500 dark:bg-amber-300/90"
          : "bg-emerald-500 dark:bg-emerald-300/90",
        className,
      )}
    />
  );
}
