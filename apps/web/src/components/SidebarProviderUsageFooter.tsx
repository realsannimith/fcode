// FILE: SidebarProviderUsageFooter.tsx
// Purpose: Always-visible "provider usage" display rendered inline in the sidebar
// footer. Shows one compact row per usage-capable provider (icon, name, remaining
// quota, and a thin tone-colored meter) so users can see each provider's usage at
// a glance without opening Settings → Usage or any popover.
// Reuses the same data + presentation layer as Settings → Usage and the chat-header
// usage chip (useProviderUsageSummary + providerUsageDisplay helpers).

import type { ProviderKind, ServerProviderUsageSnapshot } from "@t3tools/contracts";
import { PROVIDER_USAGE_PROVIDERS, providerUsageDisplayName } from "@t3tools/shared/providerUsage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { useAppSettings } from "~/appSettings";
import { useProviderUsageSummary } from "~/hooks/useProviderUsageSummary";
import { RefreshCwIcon } from "~/lib/icons";
import { openUsageQueryKeys } from "~/lib/openUsageReactQuery";
import {
  deriveProviderUsageDisplayRows,
  providerUsageToneClassName,
  selectPrimaryProviderUsageDisplayRow,
} from "~/lib/providerUsageDisplay";
import { deriveAccountRateLimits, type ProviderRateLimit } from "~/lib/rateLimits";
import { serverAllProviderUsageQueryOptions, serverQueryKeys } from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import { useStore } from "~/store";
import { createAllThreadsSelector } from "~/storeSelectors";

import { ProviderIcon } from "./ProviderIcon";
import { ProviderUsageMenuPopup, type ProviderUsageMenuModel } from "./ProviderUsageMenuControl";
import { MenuTrigger } from "./ui/menu";
import { SIDEBAR_SECTION_LABEL_CLASS_NAME } from "../sidebarRowStyles";

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

function SidebarProviderUsageRow({
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
  const primaryRow = useMemo(() => selectPrimaryProviderUsageDisplayRow(meterRows), [meterRows]);
  const title = primaryRow
    ? `${providerUsageDisplayName(provider)} · ${primaryRow.leftText}${
        primaryRow.resetText ? ` · ${primaryRow.resetText}` : ""
      }`
    : `${providerUsageDisplayName(provider)} · ${statusLabel(snapshot)}`;

  const rowInner = (
    <>
      <div className="flex items-center gap-1.5">
        <ProviderIcon provider={provider} className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[length:var(--app-font-size-ui-meta,11px)] text-muted-foreground/85">
          {providerUsageDisplayName(provider)}
        </span>
        <span
          className={cn(
            "shrink-0 text-[length:var(--app-font-size-ui-meta,11px)] tabular-nums",
            primaryRow ? "text-foreground" : "text-muted-foreground/55",
          )}
        >
          {primaryRow ? primaryRow.remainingLabel : statusLabel(snapshot)}
        </span>
      </div>
      {primaryRow ? (
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted/70">
          <div
            className={cn(
              "h-full rounded-full",
              providerUsageToneClassName(primaryRow.remainingTone),
            )}
            style={{ width: `${primaryRow.remainingPercent}%` }}
          />
        </div>
      ) : null}
    </>
  );

  // No live data → nothing to expand, so keep the row static (non-interactive).
  if (!primaryRow) {
    return (
      <div className="px-2 py-1" title={title}>
        {rowInner}
      </div>
    );
  }

  // With data, the whole row becomes a menu trigger that opens the same detailed
  // usage breakdown (every rate-limit window) shown in the chat header and Settings → Usage.
  const menuModel: ProviderUsageMenuModel = {
    menuTitle: `${providerUsageDisplayName(provider)} usage`,
    primaryRow,
    rateLimits: usageSummary.rateLimits,
    usageLines: usageSummary.usageLines,
    isLoading: usageSummary.isLoading,
  };

  return (
    <ProviderUsageMenuPopup provider={provider} model={menuModel} align="start" side="right">
      <MenuTrigger
        render={
          <button
            type="button"
            title={title}
            aria-label={menuModel.menuTitle}
            className="block w-full rounded-md px-2 py-1 text-left transition hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        }
      >
        {rowInner}
      </MenuTrigger>
    </ProviderUsageMenuPopup>
  );
}

export function SidebarProviderUsageFooter() {
  const { settings } = useAppSettings();
  const codexHomePath = settings.codexHomePath || null;
  const threads = useStore(useMemo(() => createAllThreadsSelector(), []));
  // Account/thread fallback rows are shared across every provider row; derive once.
  const threadRateLimits = useMemo(() => deriveAccountRateLimits(threads), [threads]);
  const usageQuery = useQuery(serverAllProviderUsageQueryOptions());
  const snapshotByProvider = useMemo(() => {
    const map = new Map<ProviderKind, ServerProviderUsageSnapshot>();
    for (const snapshot of usageQuery.data ?? []) {
      map.set(snapshot.provider, snapshot);
    }
    return map;
  }, [usageQuery.data]);

  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Refresh re-pulls every query the rows read: the all-provider snapshot, each
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
      {PROVIDER_USAGE_PROVIDERS.map((provider) => (
        <SidebarProviderUsageRow
          key={provider}
          provider={provider}
          snapshot={snapshotByProvider.get(provider)}
          threadRateLimits={threadRateLimits}
          codexHomePath={codexHomePath}
        />
      ))}
    </div>
  );
}
