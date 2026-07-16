// FILE: agent-progress-indicator.tsx
// Purpose: Shared compact progress ring for live AI-agent work across the app.
// Layer: UI primitive

import { cn } from "~/lib/utils";

interface AgentProgressIndicatorProps {
  className?: string;
  label?: string;
}

export function AgentProgressIndicator({
  className,
  label = "Agent is working",
}: AgentProgressIndicatorProps) {
  return (
    <svg
      role="status"
      aria-label={label}
      viewBox="0 0 14 14"
      fill="none"
      className={cn("size-3 shrink-0 motion-safe:animate-spin", className)}
    >
      <circle
        cx="7"
        cy="7"
        r="5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="20 12"
      />
    </svg>
  );
}
