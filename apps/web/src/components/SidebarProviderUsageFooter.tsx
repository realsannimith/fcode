// FILE: SidebarProviderUsageFooter.tsx
// Purpose: Always-visible "provider usage" display rendered inline in the sidebar
// footer. Shows one compact chip per usage-capable provider (icon + the two key
// window percentages, Session over Weekly) so users can see each provider's usage
// at a glance — the OpenUsage menu-bar strip style. Hovering a chip shows a labeled
// tooltip; clicking opens the OpenUsage-style detail card (every window's meter plus
// the local spend lines).
// Reuses the same data + presentation layer as Settings → Usage and the chat-header
// usage chip (useProviderUsageSummary + providerUsageDisplay helpers).

import type { ProviderKind, ServerProviderUsageSnapshot } from "@t3tools/contracts";
import { PROVIDER_USAGE_PROVIDERS, providerUsageDisplayName } from "@t3tools/shared/providerUsage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { resolveCodexUsageHomePath, useAppSettings } from "~/appSettings";
import { useProviderUsageSummary } from "~/hooks/useProviderUsageSummary";
import { RefreshCwIcon } from "~/lib/icons";
import { openUsageQueryKeys } from "~/lib/openUsageReactQuery";
import {
  deriveProviderUsageDisplayRows,
  selectPrimaryProviderUsageDisplayRow,
  type ProviderUsageDisplayRow,
  type ProviderUsageTone,
} from "~/lib/providerUsageDisplay";
import { deriveAccountRateLimits, type ProviderRateLimit } from "~/lib/rateLimits";
import { serverAllProviderUsageQueryOptions, serverQueryKeys } from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import { useStore } from "~/store";
import { createAllThreadsSelector } from "~/storeSelectors";

import { ProviderIcon } from "./ProviderIcon";
import { ProviderUsageMenuPopup, type ProviderUsageMenuModel } from "./ProviderUsageMenuControl";
import { MenuTrigger } from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { SIDEBAR_SECTION_LABEL_CLASS_NAME } from "../sidebarRowStyles";

// Chip percentages read in the provider's tone: healthy stays neutral (like the
// OpenUsage strip), warning/danger tint so a nearly-exhausted quota stands out.
const CHIP_TONE_TEXT: Record<ProviderUsageTone, string> = {
  healthy: "text-foreground",
  warning: "text-amber-500",
  danger: "text-red-500",
};

// The 5h window is branded "Session" in OpenUsage; everything else keeps its label.
function displayWindowLabel(label: string): string {
  return label === "5h" ? "Session" : label;
}

function statusLabel(snapshot: ServerProviderUsageSnapshot | undefined): string {
  switch (snapshot?.status) {
    case "needs-auth":
      return "Sign in";
    case "unsupported":
      return "—";
    case "error":
      return "Unavailable";
    default:
      return "No data";
  }
}

function SidebarProviderUsageChip({
  provider,
  snapshot,
  threadRateLimits,
  codexHomePath,
}: {
  provider: ProviderKind;
  snapshot: ServerProviderUsageSnapshot | undefined;
  threadRateLimits: ReadonlyArray<ProviderRateLimit>;
  codexHomePath: string | null;
}) {
  const usageSummary = useProviderUsageSummary({
    provider,
    threadRateLimits,
    codexHomePath,
    ...(snapshot ? { providerSnapshot: snapshot } : {}),
  });
  const meterRows = useMemo(
    () => deriveProviderUsageDisplayRows(usageSummary.rateLimits),
    [usageSummary.rateLimits],
  );
  // The chip surfaces the two headline windows (Session, then Weekly); the detail
  // card behind the click shows every window.
  const chipRows = useMemo<ReadonlyArray<ProviderUsageDisplayRow>>(
    () => meterRows.slice(0, 2),
    [meterRows],
  );
  const primaryRow = useMemo(() => selectPrimaryProviderUsageDisplayRow(meterRows), [meterRows]);
  const displayName = providerUsageDisplayName(provider);

  const chipInner = (
    <div className="flex items-center gap-2">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-[color:var(--color-border)] bg-background/50">
        <ProviderIcon provider={provider} className="size-3.5" />
      </span>
      {chipRows.length > 0 ? (
        <span className="flex min-w-0 flex-col leading-tight">
          {chipRows.map((row) => (
            <span
              key={row.id}
              className={cn(
                "text-[length:var(--app-font-size-ui,12px)] font-semibold tabular-nums",
                CHIP_TONE_TEXT[row.remainingTone],
              )}
            >
              {row.remainingLabel}
            </span>
          ))}
        </span>
      ) : (
        <span className="min-w-0 truncate text-[length:var(--app-font-size-ui-meta,11px)] text-muted-foreground/60">
          {statusLabel(snapshot)}
        </span>
      )}
    </div>
  );

  // No live data → nothing to expand, so keep the chip static (non-interactive).
  // (chipRows is non-empty exactly when meterRows is, i.e. when primaryRow exists,
  // but narrow explicitly so the menu model's non-null primaryRow typechecks.)
  if (chipRows.length === 0 || !primaryRow) {
    return (
      <div className="rounded-md px-2 py-1.5" title={`${displayName} · ${statusLabel(snapshot)}`}>
        {chipInner}
      </div>
    );
  }

  const tooltipContent = (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium text-foreground">{displayName}</span>
      {chipRows.map((row) => (
        <span key={row.id} className="tabular-nums text-muted-foreground">
          {displayWindowLabel(row.label)} {row.leftText}
          {row.resetText ? ` · ${row.resetText}` : ""}
        </span>
      ))}
    </div>
  );

  const menuModel: ProviderUsageMenuModel = {
    menuTitle: `${displayName} usage`,
    primaryRow,
    rateLimits: usageSummary.rateLimits,
    usageLines: usageSummary.usageLines,
    isLoading: usageSummary.isLoading,
    learnMoreHref: usageSummary.learnMoreHref,
  };

  return (
    <ProviderUsageMenuPopup
      provider={provider}
      model={menuModel}
      variant="card"
      align="start"
      side="right"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <button
                  type="button"
                  aria-label={menuModel.menuTitle}
                  className="block w-full rounded-md px-2 py-1.5 text-left transition hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              }
            >
              {chipInner}
            </MenuTrigger>
          }
        />
        <TooltipPopup side="right">{tooltipContent}</TooltipPopup>
      </Tooltip>
    </ProviderUsageMenuPopup>
  );
}

export function SidebarProviderUsageFooter() {
  const { settings } = useAppSettings();
  const codexHomePath = resolveCodexUsageHomePath(settings);
  const usageHiddenProviders = settings.usageHiddenProviders;
  const visibleProviders = useMemo(
    () => PROVIDER_USAGE_PROVIDERS.filter((provider) => !usageHiddenProviders.includes(provider)),
    [usageHiddenProviders],
  );
  const threads = useStore(useMemo(() => createAllThreadsSelector(), []));
  // Account/thread fallback rows are shared across every provider chip; derive once.
  const threadRateLimits = useMemo(() => deriveAccountRateLimits(threads), [threads]);
  const usageQuery = useQuery(serverAllProviderUsageQueryOptions({ codexHomePath }));
  const snapshotByProvider = useMemo(() => {
    const map = new Map<ProviderKind, ServerProviderUsageSnapshot>();
    for (const snapshot of usageQuery.data ?? []) {
      map.set(snapshot.provider, snapshot);
    }
    return map;
  }, [usageQuery.data]);

  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Refresh re-pulls every query the chips read: the all-provider snapshot, each
  // per-provider snapshot, and the OpenUsage snapshots. Polling already runs on an
  // interval; this lets the user force an immediate update.
  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: serverQueryKeys.allProviderUsage() }),
      queryClient.invalidateQueries({ queryKey: ["server", "providerUsage"] }),
      queryClient.invalidateQueries({ queryKey: openUsageQueryKeys.all }),
    ]).finally(() => setIsRefreshing(false));
  }, [queryClient]);
  const spinning = isRefreshing || usageQuery.isFetching;

  return (
    <div className="rounded-lg border border-[color:var(--color-border)] bg-[var(--color-background-elevated-secondary)]/40 px-1 py-1.5">
      <div className="flex items-center justify-between pb-0.5 pr-1 pl-2">
        <span className={SIDEBAR_SECTION_LABEL_CLASS_NAME}>Usage</span>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={spinning}
          aria-label="Refresh usage"
          title="Refresh usage"
          className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-sidebar-accent hover:text-foreground disabled:opacity-60"
        >
          <RefreshCwIcon className={cn("size-3.5", spinning && "motion-safe:animate-spin")} />
        </button>
      </div>
      {visibleProviders.length === 0 ? (
        <p className="px-2 py-1 text-[length:var(--app-font-size-ui-meta,11px)] text-muted-foreground/70">
          No providers selected. Choose which to show in Settings → Usage.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-0.5">
          {visibleProviders.map((provider) => (
            <SidebarProviderUsageChip
              key={provider}
              provider={provider}
              snapshot={snapshotByProvider.get(provider)}
              threadRateLimits={threadRateLimits}
              codexHomePath={codexHomePath}
            />
          ))}
        </div>
      )}
    </div>
  );
}
