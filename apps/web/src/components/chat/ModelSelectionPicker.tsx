// FILE: ModelSelectionPicker.tsx
// Purpose: Self-contained provider/model picker bound to a ModelSelection value, for
//          composer-like surfaces outside ChatView (automations editor, git conflict
//          dialogs). Wires the shared model catalog, provider statuses, and discovery
//          cwd so callers only supply value/onChange.
// Layer: Chat picker UI

import type { ModelSelection, ProviderKind } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useAppSettings } from "~/appSettings";
import { useProviderModelCatalog } from "~/hooks/useProviderModelCatalog";
import { useProviderStatusesForLocalConfig } from "~/hooks/useProviderStatusesForLocalConfig";
import { resolveProviderDiscoveryCwd } from "~/lib/providerDiscovery";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { buildModelSelection } from "~/providerModelOptions";
import { ProviderModelPicker } from "./ProviderModelPicker";

export function ModelSelectionPicker({
  value,
  cwd,
  onChange,
  lockedProvider = null,
}: {
  readonly value: ModelSelection;
  /** Cwd used to discover project-scoped models; null falls back to the server cwd. */
  readonly cwd: string | null;
  readonly onChange: (value: ModelSelection) => void;
  /** Restricts provider switching (started threads keep their provider), mirroring the composer. */
  readonly lockedProvider?: ProviderKind | null;
}) {
  const { settings } = useAppSettings();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const providerStatuses = useProviderStatusesForLocalConfig();
  const [open, setOpen] = useState(false);
  const modelHintByProvider = useMemo<Partial<Record<ProviderKind, string | null>>>(
    () => ({ [value.provider]: value.model }),
    [value.model, value.provider],
  );
  const providerModelDiscoveryCwd = resolveProviderDiscoveryCwd({
    activeThreadWorktreePath: null,
    activeProjectCwd: cwd,
    serverCwd: serverConfigQuery.data?.cwd ?? null,
  });
  const { modelOptionsByProvider, loadingModelProviders } = useProviderModelCatalog({
    selectedProvider: value.provider,
    discoveryEnabled: open,
    cwd: providerModelDiscoveryCwd,
    modelHintByProvider,
  });

  return (
    <ProviderModelPicker
      compact
      provider={value.provider}
      model={value.model}
      lockedProvider={lockedProvider}
      providers={providerStatuses}
      modelOptionsByProvider={modelOptionsByProvider}
      loadingModelProviders={loadingModelProviders}
      hiddenProviders={settings.hiddenProviders}
      providerOrder={settings.providerOrder}
      open={open}
      onOpenChange={setOpen}
      onProviderModelChange={(provider, model) => onChange(buildModelSelection(provider, model))}
    />
  );
}
