// FILE: TerminalActivityIndicator.tsx
// Purpose: Compact terminal lifecycle indicator — a pulsing dot while the agent is
// running, a steady dot for attention/review. Renders nothing when idle.
// Layer: Terminal presentation primitive

import type { TerminalVisualState } from "@t3tools/shared/terminalThreads";

import { cn } from "~/lib/utils";

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

  // Running = the agent is actively working. A solid dot under an expanding "ping"
  // ring reads as live without a heavy spinner. motion-safe keeps it static for
  // users who prefer reduced motion.
  if (state === "running") {
    return (
      <span aria-hidden="true" className={cn("relative inline-flex size-1.5 shrink-0", className)}>
        <span className="absolute inline-flex h-full w-full rounded-full bg-sky-500 opacity-75 motion-safe:animate-ping dark:bg-sky-400/90" />
        <span className="relative inline-flex size-1.5 rounded-full bg-sky-500 dark:bg-sky-400/90" />
      </span>
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
