// FILE: ProviderUsageMenuControl.tsx
// Purpose: Shared provider-usage chip/menu used in the chat header and Environment panel.

import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from "@t3tools/contracts";
import { useMemo, type ReactNode } from "react";

import { resolveCodexUsageHomePath, useAppSettings } from "~/appSettings";
import { useProviderUsageSummary } from "~/hooks/useProviderUsageSummary";
import {
  deriveProviderUsageDisplayRows,
  selectPrimaryProviderUsageDisplayRow,
  type ProviderUsageDisplayRow,
} from "~/lib/providerUsageDisplay";
import type { OpenUsageUsageLine } from "~/lib/openUsageRateLimits";
import type { ProviderRateLimit } from "~/lib/rateLimits";
import { useStore } from "~/store";
import { createAllThreadsSelector } from "~/storeSelectors";

import { ComposerPickerMenuPopup } from "./chat/ComposerPickerMenuPopup";
import { ChatHeaderButton } from "./chat/chatHeaderControls";
import { ProviderIcon } from "./ProviderIcon";
import { ProviderUsageDetailCard } from "./ProviderUsageDetailCard";
import { ProviderUsagePanelContent } from "./ProviderUsagePanelContent";
import { Menu, MenuTrigger } from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export interface ProviderUsageMenuModel {
  menuTitle: string;
  primaryRow: ProviderUsageDisplayRow;
  rateLimits: ReadonlyArray<ProviderRateLimit>;
  usageLines: ReadonlyArray<OpenUsageUsageLine>;
  isLoading: boolean;
  learnMoreHref?: string | null | undefined;
}

export function useProviderUsageMenuModel(provider: ProviderKind): ProviderUsageMenuModel | null {
  const { settings } = useAppSettings();
  const selectAllThreads = useMemo(() => createAllThreadsSelector(), []);
  const threads = useStore(selectAllThreads);
  const usageSummary = useProviderUsageSummary({
    provider,
    threads,
    codexHomePath: resolveCodexUsageHomePath(settings),
  });
  const usageRows = useMemo(
    () => deriveProviderUsageDisplayRows(usageSummary.rateLimits),
    [usageSummary.rateLimits],
  );
  const primaryRow = useMemo(() => selectPrimaryProviderUsageDisplayRow(usageRows), [usageRows]);

  if (!primaryRow) {
    return null;
  }

  return {
    menuTitle: `${PROVIDER_DISPLAY_NAMES[provider]} usage`,
    primaryRow,
    rateLimits: usageSummary.rateLimits,
    usageLines: usageSummary.usageLines,
    isLoading: usageSummary.isLoading,
  };
}

export function ProviderUsageMenuPopup({
  provider,
  model,
  align = "end",
  side = "bottom",
  variant = "compact",
  children,
}: {
  provider: ProviderKind;
  model: ProviderUsageMenuModel;
  align?: "start" | "end";
  side?: "top" | "bottom" | "left" | "right";
  // "compact": the terse chat-header/env popover. "card": the OpenUsage-style
  // expanded detail used by the sidebar usage chips.
  variant?: "compact" | "card";
  children: ReactNode;
}) {
  return (
    <Menu modal={false}>
      {children}
      <ComposerPickerMenuPopup
        align={align}
        side={side}
        className={variant === "card" ? "w-auto min-w-0 p-0" : "w-64 min-w-64"}
      >
        {variant === "card" ? (
          <ProviderUsageDetailCard
            provider={provider}
            rows={deriveProviderUsageDisplayRows(model.rateLimits)}
            usageLines={model.usageLines}
            learnMoreHref={model.learnMoreHref}
            isLoading={model.isLoading}
          />
        ) : (
          <ProviderUsagePanelContent
            provider={provider}
            rateLimits={model.rateLimits}
            usageLines={model.usageLines}
            isLoading={model.isLoading}
            showUsageLines={false}
            showTitle={false}
            className="px-2 pb-1 pt-1"
          />
        )}
      </ComposerPickerMenuPopup>
    </Menu>
  );
}

export function ProviderUsageMenuControl({ provider }: { provider: ProviderKind }) {
  const model = useProviderUsageMenuModel(provider);

  if (!model) {
    return null;
  }

  return (
    <ProviderUsageMenuPopup provider={provider} model={model}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <ChatHeaderButton
                  type="button"
                  tone="plain"
                  className="gap-1.5 px-2"
                  aria-label={model.menuTitle}
                />
              }
            >
              <ProviderIcon provider={provider} tone="header" className="size-3.5 shrink-0" />
              <span className="truncate font-normal">{model.primaryRow.remainingLabel}</span>
            </MenuTrigger>
          }
        />
        <TooltipPopup side="bottom">{model.menuTitle}</TooltipPopup>
      </Tooltip>
    </ProviderUsageMenuPopup>
  );
}
