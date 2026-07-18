// FILE: agent-progress-indicator.tsx
// Purpose: Shared compact dot loader for live AI-agent work across the app.
// Layer: UI primitive

import { useState } from "react";

import { cn } from "~/lib/utils";

interface AgentProgressIndicatorProps {
  className?: string | undefined;
  label?: string | undefined;
}

// The 8 dots render row-major in a 2x4 grid (indices 0..7). To make the lit
// highlight travel around the ring — a circular chase — rather than sweep top to
// bottom, the animation delay for each grid slot follows the grid perimeter order
// (0 -> 1 -> 3 -> 5 -> 7 -> 6 -> 4 -> 2) instead of the raw index.
const RING_STEP_BY_INDEX = [0, 1, 7, 2, 6, 3, 5, 4] as const;
const DOT_COUNT = 8;
const RING_STEP_MS = 131; // 8 steps * 131ms ~= the 1.05s pulse period, so one full lap.
const HUE_STEP = 360 / DOT_COUNT;

export function AgentProgressIndicator({
  className,
  label = "Agent is working",
}: AgentProgressIndicatorProps) {
  // Pick a random base hue once per mount so every live indicator gets its own unique,
  // colorful rainbow that flows around the ring as the highlight chases. Chosen once
  // (never per frame) so it stays stable for the indicator's lifetime; different
  // instances look different from each other.
  const [baseHue] = useState(() => Math.floor(Math.random() * 360));
  return (
    <span
      role="status"
      aria-label={label}
      className={cn("grid h-3.5 w-2 shrink-0 grid-cols-2 grid-rows-4 gap-x-1 gap-y-0.5", className)}
    >
      {Array.from({ length: DOT_COUNT }, (_, index) => {
        const ringStep = RING_STEP_BY_INDEX[index] ?? index;
        return (
          <span
            key={index}
            aria-hidden="true"
            className="agent-progress-dot size-1 self-center rounded-full bg-current motion-reduce:animate-none"
            style={{
              // Hue follows the ring order so the color transitions smoothly around the
              // wheel along the chase path.
              color: `hsl(${(baseHue + ringStep * HUE_STEP) % 360} 85% 60%)`,
              animationDelay: `${ringStep * RING_STEP_MS}ms`,
            }}
          />
        );
      })}
    </span>
  );
}
