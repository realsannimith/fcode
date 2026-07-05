// FILE: ProviderUsageSettingsPanel.tsx
// Purpose: Settings → Usage panel. One card per supported provider showing live remaining
// quota/credits with linear progress meters, the provider brand icon, and plan/status pills.
// Usage is fetched read-only from each CLI's stored credentials by the server.

import type { ProviderKind, ServerProviderUsageSnapshot } from "@t3tools/contracts";
import {
  PROVIDER_USAGE_PROVIDERS,
  providerUsageDisplayName,
  providerUsageNeedsAuthDetail,
} from "@t3tools/shared/providerUsage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { resolveCodexUsageHomePath, useAppSettings } from "~/appSettings";
import { ProviderIcon } from "~/components/ProviderIcon";
import { ProviderUsageLimitRows } from "~/components/ProviderUsageLimitRows";
import { ProviderUsageLineList } from "~/components/ProviderUsageLineList";
import { SettingsCard } from "~/components/settings/SettingsPanelPrimitives";
import { Button } from "~/components/ui/button";
import { useProviderUsageSummary } from "~/hooks/useProviderUsageSummary";
import { EyeIcon, EyeOffIcon, RotateCcwIcon } from "~/lib/icons";
import { deriveProviderUsageDisplayRows } from "~/lib/providerUsageDisplay";
import { deriveAccountRateLimits, type ProviderRateLimit } from "~/lib/rateLimits";
import {
  fetchAllProviderUsage,
  serverAllProviderUsageQueryOptions,
  serverQueryKeys,
} from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import {
  SETTINGS_PANEL_SECTION_CLASS_NAME,
  SETTINGS_SECTION_LABEL_CLASS_NAME,
} from "~/settingsPanelStyles";
import { useStore } from "~/store";
import { createAllThreadsSelector } from "~/storeSelectors";

const PILL_CLASS_NAME = "shrink-0 rounded-full px-2 py-1 text-[11px] font-medium leading-none";

// Bold usage card: filled, rounded-xl, lifts on hover. Distinct from the flat
// shared SettingsCard so the usage dashboard reads as its own surface.
const USAGE_CARD_CLASS_NAME = cn(
  "rounded-xl border border-[color:var(--color-border)] bg-muted/30",
  "transition-colors hover:border-[color:var(--color-border-hover,var(--color-border))] hover:bg-muted/50",
);

interface StatusPill {
  label: string;
  className: string;
}

function statusPill(status: ServerProviderUsageSnapshot["status"]): StatusPill | null {
  switch (status) {
    case "needs-auth":
      return {
        label: "Not signed in",
        className: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
      };
    case "unsupported":
      return { label: "Unsupported", className: "bg-muted text-muted-foreground" };
    case "error":
      return { label: "Unavailable", className: "bg-red-500/12 text-red-600 dark:text-red-400" };
    default:
      return null;
  }
}

function ProviderUsageCard({
  snapshot,
  threadRateLimits,
  codexHomePath,
  hidden,
  onToggleHidden,
}: {
  snapshot: ServerProviderUsageSnapshot;
  threadRateLimits: ReadonlyArray<ProviderRateLimit>;
  codexHomePath: string | null;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const provider = snapshot.provider;
  const status = snapshot.status ?? "ok";
  const usageSummary = useProviderUsageSummary({
    provider,
    threadRateLimits,
    codexHomePath,
    providerSnapshot: snapshot,
  });
  const meterRows = useMemo(
    () => deriveProviderUsageDisplayRows(usageSummary.rateLimits),
    [usageSummary.rateLimits],
  );
  const usageLines = usageSummary.usageLines;

  const hasUsage = meterRows.length > 0 || usageLines.length > 0;
  const pill = status === "ok" ? null : statusPill(snapshot.status);

  const providerName = providerUsageDisplayName(provider);

  return (
    <div className={cn(USAGE_CARD_CLASS_NAME, hidden && "opacity-55")}>
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-[color:var(--color-border)] bg-background/60">
              <ProviderIcon provider={provider} className="size-5" />
            </span>
            <span className="truncate text-sm font-semibold text-foreground">{providerName}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {status === "ok" && snapshot.planName ? (
              <span className={cn(PILL_CLASS_NAME, "bg-muted text-muted-foreground")}>
                {snapshot.planName}
              </span>
            ) : pill ? (
              <span className={cn(PILL_CLASS_NAME, pill.className)}>{pill.label}</span>
            ) : null}
            <button
              type="button"
              onClick={onToggleHidden}
              aria-pressed={!hidden}
              aria-label={
                hidden ? `Show ${providerName} in usage` : `Hide ${providerName} from usage`
              }
              title={
                hidden
                  ? "Hidden from the sidebar usage — click to show"
                  : "Shown in the sidebar usage — click to hide"
              }
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              {hidden ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
            </button>
          </div>
        </div>

        {status === "ok" && hasUsage ? (
          <>
            {meterRows.length > 0 ? (
              <ProviderUsageLimitRows rows={meterRows} surface="settings" />
            ) : null}
            {usageLines.length > 0 ? (
              <ProviderUsageLineList
                className={cn(
                  meterRows.length > 0 && "border-t border-[color:var(--color-border)] pt-3.5",
                )}
                lines={usageLines}
                surface="settings"
              />
            ) : null}
          </>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {status === "ok"
              ? "No usage data reported yet."
              : (snapshot.detail ?? providerUsageNeedsAuthDetail(provider))}
          </p>
        )}
      </div>
    </div>
  );
}

function missingSnapshot(provider: ProviderKind): ServerProviderUsageSnapshot {
  return {
    provider,
    updatedAt: new Date(0).toISOString(),
    limits: [],
    usageLines: [],
    source: "unavailable",
    status: "error",
    detail: "Usage is currently unavailable.",
  };
}

function mergeProviderUsageRefresh(
  previous: readonly ServerProviderUsageSnapshot[] | undefined,
  next: readonly ServerProviderUsageSnapshot[],
): readonly ServerProviderUsageSnapshot[] {
  if (!previous) {
    return next;
  }
  const previousByProvider = new Map(previous.map((snapshot) => [snapshot.provider, snapshot]));
  const nextByProvider = new Map(next.map((snapshot) => [snapshot.provider, snapshot]));
  return PROVIDER_USAGE_PROVIDERS.map(
    (provider) => nextByProvider.get(provider) ?? previousByProvider.get(provider),
  ).filter((snapshot): snapshot is ServerProviderUsageSnapshot => snapshot !== undefined);
}

export function ProviderUsageSettingsPanel() {
  const queryClient = useQueryClient();
  const { settings, updateSettings } = useAppSettings();
  const codexHomePath = resolveCodexUsageHomePath(settings);
  const usageHidden = useMemo(
    () => new Set(settings.usageHiddenProviders),
    [settings.usageHiddenProviders],
  );
  const toggleUsageProviderHidden = useCallback(
    (provider: ProviderKind) => {
      const next = new Set(settings.usageHiddenProviders);
      if (next.has(provider)) {
        next.delete(provider);
      } else {
        next.add(provider);
      }
      updateSettings({ usageHiddenProviders: [...next] });
    },
    [settings.usageHiddenProviders, updateSettings],
  );
  const threads = useStore(useMemo(() => createAllThreadsSelector(), []));
  // Account/thread fallback rows are shared by every provider card; derive them once per panel.
  const threadRateLimits = useMemo(() => deriveAccountRateLimits(threads), [threads]);
  const usageQuery = useQuery(serverAllProviderUsageQueryOptions({ codexHomePath }));
  const refreshMutation = useMutation({
    mutationFn: () =>
      fetchAllProviderUsage({
        forceRefresh: true,
        ...(codexHomePath ? { codexHomePath } : {}),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData<readonly ServerProviderUsageSnapshot[]>(
        serverQueryKeys.allProviderUsage(codexHomePath),
        (previous) => mergeProviderUsageRefresh(previous, data),
      );
    },
  });

  // Always render a card per supported provider, ordered consistently, even if the batch
  // omitted one (e.g. a transient server error) — fall back to an "unavailable" placeholder.
  const cards = useMemo(() => {
    const byProvider = new Map<ProviderKind, ServerProviderUsageSnapshot>();
    for (const snapshot of usageQuery.data ?? []) {
      byProvider.set(snapshot.provider, snapshot);
    }
    return PROVIDER_USAGE_PROVIDERS.map(
      (provider) => byProvider.get(provider) ?? missingSnapshot(provider),
    );
  }, [usageQuery.data]);

  const showInitialLoading = usageQuery.isPending && !usageQuery.data;

  const isRefreshing = usageQuery.isFetching || refreshMutation.isPending;

  return (
    <section className={SETTINGS_PANEL_SECTION_CLASS_NAME}>
      <div className="flex items-center justify-between gap-2">
        <h2 className={SETTINGS_SECTION_LABEL_CLASS_NAME}>Provider usage</h2>
        <Button
          size="xs"
          variant="outline"
          className="shrink-0"
          disabled={isRefreshing}
          onClick={() => refreshMutation.mutate()}
        >
          <RotateCcwIcon className={cn("size-3.5", isRefreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {showInitialLoading ? (
        <SettingsCard>
          <div className="px-4 py-3.5 text-xs text-muted-foreground">Loading provider usage…</div>
        </SettingsCard>
      ) : (
        <div className="flex flex-col gap-3">
          {cards.map((snapshot) => (
            <ProviderUsageCard
              key={snapshot.provider}
              snapshot={snapshot}
              threadRateLimits={threadRateLimits}
              codexHomePath={codexHomePath}
              hidden={usageHidden.has(snapshot.provider)}
              onToggleHidden={() => toggleUsageProviderHidden(snapshot.provider)}
            />
          ))}
        </div>
      )}

      <p className="px-2 text-[11px] leading-relaxed text-muted-foreground">
        Toggle the eye on a provider to show or hide it in the sidebar usage list. Usage is read
        locally from each provider CLI&apos;s stored credentials and fetched directly from the
        provider. OAuth providers may refresh short-lived tokens through their official token
        endpoint; if a provider shows “Not signed in”, re-authenticate with its CLI.
      </p>
    </section>
  );
}
