// FILE: ProviderUsageLimitRows.tsx
// Purpose: Shared provider usage limit-row renderer for Settings and compact
// popovers. Keeps labels, progress tracks, pace details, and tones consistent.

import {
  providerUsagePaceDetails,
  providerUsageProgressTrackProps,
  type ProviderUsageDisplayRow,
} from "~/lib/providerUsageDisplay";
import { cn } from "~/lib/utils";

import { UsageProgressTrack } from "./UsageProgressTrack";

export type ProviderUsageLimitRowsSurface = "settings" | "popover";

function ProviderUsagePaceLine({
  row,
  surface,
}: {
  row: ProviderUsageDisplayRow;
  surface: ProviderUsageLimitRowsSurface;
}) {
  const paceDetails = providerUsagePaceDetails(row);
  if (!paceDetails) return null;

  if (surface === "popover") {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 text-muted-foreground">
        {paceDetails.amountText ? (
          <div className="min-w-0 truncate tabular-nums">{paceDetails.amountText}</div>
        ) : (
          <div />
        )}
        {paceDetails.etaText ? (
          <div className="min-w-0 truncate text-right tabular-nums text-muted-foreground/80">
            {paceDetails.etaText}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
      {paceDetails.amountText ? <span>{paceDetails.amountText}</span> : <span />}
      {paceDetails.etaText ? <span>{paceDetails.etaText}</span> : null}
    </div>
  );
}

function ProviderUsageTrack({
  row,
  surface,
}: {
  row: ProviderUsageDisplayRow;
  surface: ProviderUsageLimitRowsSurface;
}) {
  const trackProps = providerUsageProgressTrackProps(row);

  return (
    <UsageProgressTrack
      {...trackProps}
      className={surface === "popover" ? "h-1.5 bg-muted/80" : "h-2.5"}
      markerGapClassName={surface === "popover" ? "bg-popover" : undefined}
    />
  );
}

function SettingsUsageLimitRow({ row }: { row: ProviderUsageDisplayRow }) {
  const trackProps = providerUsageProgressTrackProps(row);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {row.label}
        </span>
        <span
          className={cn("size-1.5 shrink-0 rounded-full", trackProps.markerClassName)}
          title={row.pace ? `Usage pace: ${row.pace.status}` : undefined}
          aria-hidden
        />
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-semibold leading-none tabular-nums text-foreground">
          {row.leftText}
        </span>
        {row.resetText ? (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {row.resetText}
          </span>
        ) : null}
      </div>
      <ProviderUsageTrack row={row} surface="settings" />
      <ProviderUsagePaceLine row={row} surface="settings" />
    </div>
  );
}

function PopoverUsageLimitRow({ row }: { row: ProviderUsageDisplayRow }) {
  return (
    <div className="space-y-1 text-[length:var(--app-font-size-chat-meta,10px)] leading-tight">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-x-3">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 text-[11px] font-medium text-foreground">{row.label}</span>
          <span className="min-w-0 truncate tabular-nums text-foreground">{row.leftText}</span>
        </div>
        <div className="min-w-0 text-right text-muted-foreground">
          {row.resetText ? <div className="truncate tabular-nums">{row.resetText}</div> : null}
        </div>
      </div>
      <ProviderUsageTrack row={row} surface="popover" />
      <ProviderUsagePaceLine row={row} surface="popover" />
    </div>
  );
}

export function ProviderUsageLimitRows({
  rows,
  surface,
}: {
  rows: ReadonlyArray<ProviderUsageDisplayRow>;
  surface: ProviderUsageLimitRowsSurface;
}) {
  if (rows.length === 0) return null;

  return (
    <div className={surface === "settings" ? "space-y-3" : "space-y-1.5"}>
      {rows.map((row) =>
        surface === "settings" ? (
          <SettingsUsageLimitRow key={row.id} row={row} />
        ) : (
          <PopoverUsageLimitRow key={row.id} row={row} />
        ),
      )}
    </div>
  );
}
