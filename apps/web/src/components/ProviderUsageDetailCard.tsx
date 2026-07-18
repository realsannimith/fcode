// FILE: ProviderUsageDetailCard.tsx
// Purpose: Expanded plan-usage card shown when a sidebar usage chip is opened.
// Mirrors the compact Codex sidebar treatment: a quiet header, thin divider, and
// one two-line meter per rate-limit window (label + reset + used percentage over a
// slim progress track). Local spend lines remain available below the limit rows.

import type { ProviderKind } from "@t3tools/contracts";
import { providerUsageDisplayName } from "@t3tools/shared/providerUsage";

import { ArrowRightIcon } from "~/lib/icons";
import type { OpenUsageUsageLine } from "~/lib/openUsageRateLimits";
import type { ProviderUsageDisplayRow } from "~/lib/providerUsageDisplay";

// Match the reference's human-readable short-window label; custom windows keep
// their provider-supplied names.
function displayWindowLabel(label: string): string {
  return label === "5h" ? "5-hour limit" : label;
}

function UsageMeterRow({ row }: { row: ProviderUsageDisplayRow }) {
  const usedPercent = Math.min(100, Math.max(0, 100 - row.remainingPercent));
  const usedLabel = `${Math.round(usedPercent)}%`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-4 text-[13px] leading-tight">
        <span className="min-w-0 truncate font-normal text-foreground">
          {displayWindowLabel(row.label)}
        </span>
        <span className="flex shrink-0 items-baseline gap-2 tabular-nums text-muted-foreground">
          {row.resetText ? <span>{row.resetText}</span> : null}
          <span>{usedLabel}</span>
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted/75"
        role="progressbar"
        aria-label={`${displayWindowLabel(row.label)} used`}
        aria-valuenow={Math.round(usedPercent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-blue-500 transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${usedPercent}%` }}
        />
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
  const providerName = providerUsageDisplayName(provider);

  const headerContent = (
    <>
      <span className="min-w-0 truncate">Plan usage limits · {providerName}</span>
      {learnMoreHref ? <ArrowRightIcon className="size-4 shrink-0" aria-hidden /> : null}
    </>
  );

  return (
    <div className="w-[min(22rem,calc(100vw-1rem))] px-3.5 py-3">
      {learnMoreHref ? (
        <a
          href={learnMoreHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-3 text-[13px] font-normal text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {headerContent}
        </a>
      ) : (
        <div className="flex items-center justify-between gap-3 text-[13px] font-normal text-muted-foreground">
          {headerContent}
        </div>
      )}

      {hasContent ? (
        <div className="mt-2.5 border-t border-[color:var(--color-border)] pt-2.5">
          {rows.length > 0 ? (
            <div className="space-y-3">
              {rows.map((row) => (
                <UsageMeterRow key={row.id} row={row} />
              ))}
            </div>
          ) : null}
          {rows.length > 0 && usageLines.length > 0 ? (
            <div className="my-2.5 border-t border-[color:var(--color-border)]" />
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
        <p className="mt-2.5 border-t border-[color:var(--color-border)] pt-2.5 text-[12px] leading-relaxed text-muted-foreground">
          {isLoading ? "Loading usage data…" : "No usage data yet for this provider."}
        </p>
      )}
    </div>
  );
}
