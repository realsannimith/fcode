// FILE: agent-progress-indicator.tsx
// Purpose: Shared compact dot-matrix loader for live AI-agent work across the app.
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
    <span
      role="status"
      aria-label={label}
      className={cn(
        "grid h-3.5 w-1.5 shrink-0 grid-cols-2 grid-rows-5 gap-x-0.5 gap-y-px text-emerald-500 dark:text-emerald-400",
        className,
      )}
    >
      {Array.from({ length: 10 }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className="agent-progress-dot size-0.5 self-center rounded-full bg-current motion-reduce:animate-none"
          style={{ animationDelay: `${index * 70}ms` }}
        />
      ))}
    </span>
  );
}
