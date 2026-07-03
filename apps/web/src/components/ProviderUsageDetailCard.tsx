// FILE: ProviderUsageDetailCard.tsx
// Purpose: OpenUsage-style expanded usage card shown when a sidebar usage chip is
// opened. Header (provider icon + name), an inset container with one meter row per
// rate-limit window (Session/Weekly: full-width capsule bar, "X% left" ⟷ reset
// countdown, flame warning when projected to run out), the local spend lines
// (Today / Yesterday / Last 30 Days), and a Dashboard link.
// Mirrors OpenUsage's WidgetGroupedListView/WidgetRowView layout while reusing
// FCode's existing derived usage data (providerUsageDisplay + openUsageRateLimits).

import type { ProviderKind } from "@t3tools/contracts";
import { providerUsageDisplayName } from "@t3tools/shared/providerUsage";

import { ArrowUpRightIcon, FlameIcon } from "~/lib/icons";
import type { OpenUsageUsageLine } from "~/lib/openUsageRateLimits";
import {
  providerUsagePaceDetails,
  type ProviderUsageDisplayRow,
  type ProviderUsageTone,
} from "~/lib/providerUsageDisplay";
import { cn } from "~/lib/utils";

import { ProviderIcon } from "./ProviderIcon";

// OpenUsage palette: healthy meters read blue (not FCode's emerald) to match the
// reference; warning/danger stay amber/red. Scoped to this surface so Settings and
// the chat-header chip keep the shared tone colors.
const OPEN_USAGE_TONE_FILL: Record<ProviderUsageTone, string> = {
  healthy: "bg-blue-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
};

// The 5h window is branded "Session" in OpenUsage; everything else keeps its label.
function displayWindowLabel(label: string): string {
  return label === "5h" ? "Session" : label;
}

function UsageMeterRow({ row }: { row: ProviderUsageDisplayRow }) {
  const pace = providerUsagePaceDetails(row);
  const runningOut = row.pace?.status === "behind" && pace?.etaText;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-foreground">
          {displayWindowLabel(row.label)}
        </span>
        {runningOut ? (
          <span className="flex items-center gap-1 text-[11px] font-medium text-red-500">
            <FlameIcon className="size-3.5" />
            <span className="tabular-nums">{pace?.etaText}</span>
          </span>
        ) : null}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/70">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            OPEN_USAGE_TONE_FILL[row.remainingTone],
          )}
          style={{ width: `${row.remainingPercent}%` }}
        />
      </div>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="font-medium tabular-nums text-foreground">{row.leftText}</span>
        {row.resetText ? (
          <span className="tabular-nums text-muted-foreground">{row.resetText}</span>
        ) : null}
      </div>
    </div>
  );
}

function UsageSpendRow({ line }: { line: OpenUsageUsageLine }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]">
      <span className="shrink-0 font-medium text-foreground">{line.label}</span>
      <span className="min-w-0 truncate text-right tabular-nums text-muted-foreground">
        {line.value}
      </span>
    </div>
  );
}

export function ProviderUsageDetailCard({
  provider,
  rows,
  usageLines,
  learnMoreHref,
  isLoading,
}: {
  provider: ProviderKind;
  rows: ReadonlyArray<ProviderUsageDisplayRow>;
  usageLines: ReadonlyArray<OpenUsageUsageLine>;
  learnMoreHref?: string | null | undefined;
  isLoading?: boolean | undefined;
}) {
  const hasContent = rows.length > 0 || usageLines.length > 0;

  return (
    <div className="w-64 space-y-3 p-1">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="truncate text-[15px] font-semibold text-foreground">
          {providerUsageDisplayName(provider)}
        </span>
        <ProviderIcon provider={provider} className="size-4 shrink-0" />
      </div>

      {hasContent ? (
        <div className="space-y-3 rounded-lg border border-[color:var(--color-border)] bg-background/40 px-3 py-3">
          {rows.map((row) => (
            <UsageMeterRow key={row.id} row={row} />
          ))}
          {rows.length > 0 && usageLines.length > 0 ? (
            <div className="border-t border-[color:var(--color-border)]" />
          ) : null}
          {usageLines.length > 0 ? (
            <div className="space-y-2">
              {usageLines.map((line) => (
                <UsageSpendRow key={`${line.label}:${line.value}`} line={line} />
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="px-1 text-[12px] leading-relaxed text-muted-foreground">
          {isLoading ? "Loading usage data…" : "No usage data yet for this provider."}
        </p>
      )}

      {learnMoreHref ? (
        <a
          href={learnMoreHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 rounded-md border border-[color:var(--color-border)] bg-background/40 px-2 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-sidebar-accent/60"
        >
          Dashboard
          <ArrowUpRightIcon className="size-3.5" />
        </a>
      ) : null}
    </div>
  );
}
