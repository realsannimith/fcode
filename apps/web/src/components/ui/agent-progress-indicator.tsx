// FILE: agent-progress-indicator.tsx
// Purpose: Shared compact dot loader for live AI-agent work across the app.
// Layer: UI primitive

import { cn } from "~/lib/utils";

interface AgentProgressIndicatorProps {
  className?: string | undefined;
  label?: string | undefined;
}

export function AgentProgressIndicator({
  className,
  label = "Agent is working",
}: AgentProgressIndicatorProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        "grid h-3.5 w-2 shrink-0 grid-cols-2 grid-rows-4 gap-x-1 gap-y-0.5 text-emerald-400",
        className,
      )}
    >
      {Array.from({ length: 8 }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className="agent-progress-dot size-1 self-center rounded-full bg-current motion-reduce:animate-none"
          style={{ animationDelay: `${index * 90}ms` }}
        />
      ))}
    </span>
  );
}
