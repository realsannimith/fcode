// FILE: LocalServersMenu.tsx
// Purpose: Shared "running local servers" menu — a popup listing active local dev servers with
// one-click stop + refresh. Reused by the chat Environment panel and the terminal sidebar.
// Layer: Local-servers presentation
// Depends on: server local-server React Query helpers and the shared menu/popup primitives.
//
// The port scan (listLocalServers) only runs while the menu is open (or while an explicit
// `enabled` override is set), so a passively-mounted trigger costs nothing.

import { type ReactNode, useState } from "react";

import type { ServerLocalServerProcess } from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { localServerPrimaryLabel, localServerUrl } from "@t3tools/shared/localServers";

import { LocalServerIdentity } from "./LocalServerIdentity";
import { ComposerPickerMenuPopup } from "./chat/ComposerPickerMenuPopup";
import { Menu, MenuItem, MenuTrigger } from "./ui/menu";
import { GlobeIcon, RefreshCwIcon, XIcon } from "~/lib/icons";
import {
  serverLocalServersQueryOptions,
  serverStopLocalServerMutationOptions,
} from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";

export function describeServerCount(count: number): string {
  if (count === 0) return "No servers running";
  return `${count} server${count === 1 ? "" : "s"} running`;
}

/** Compact, non-closing icon action used for the menu's Refresh affordance. */
function LocalServersRefreshButton({
  refreshing,
  onRefresh,
}: {
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <MenuItem
      closeOnClick={false}
      disabled={refreshing}
      onClick={onRefresh}
      aria-label="Refresh local servers"
      title="Refresh"
      className="inline-flex size-5 items-center justify-center rounded-md p-0 text-muted-foreground/60 transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)] data-highlighted:bg-[var(--color-background-button-secondary-hover)] data-highlighted:text-[var(--color-text-foreground)]"
    >
      <RefreshCwIcon className={cn("size-3", refreshing && "animate-spin")} />
    </MenuItem>
  );
}

/**
 * A single running server: status dot, name, and its `localhost:<port>` address,
 * plus a compact stop control. When `onOpen` is supplied, clicking anywhere on
 * the row besides the stop button opens the server in the in-app browser.
 */
function LocalServerRow({
  server,
  stopping,
  onStop,
  onOpen,
}: {
  server: ServerLocalServerProcess;
  stopping: boolean;
  onStop: (server: ServerLocalServerProcess) => void;
  onOpen?: ((server: ServerLocalServerProcess) => void) | undefined;
}) {
  const stoppable = server.isStoppable && !stopping;
  const primaryLabel = localServerPrimaryLabel(server);
  const stopHint = server.isStoppable
    ? `Stop ${primaryLabel}`
    : (server.stopDisabledReason ?? server.args ?? server.displayName);
  const openHint = `Open ${primaryLabel} in the browser`;

  return (
    <div
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? openHint : undefined}
      title={onOpen ? openHint : undefined}
      onClick={onOpen ? () => onOpen(server) : undefined}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onOpen(server);
            }
          : undefined
      }
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[0.35rem] py-1 pl-2 pr-3",
        onOpen &&
          "cursor-pointer transition-colors hover:bg-[var(--color-background-button-secondary-hover)]",
      )}
    >
      {/* Running indicator: a soft-haloed dot so an active server reads at a glance. */}
      <span className="relative flex size-2 shrink-0 items-center justify-center" aria-hidden>
        <span className="absolute size-2 rounded-full bg-success/25" />
        <span className="relative size-1 rounded-full bg-success" />
      </span>

      <LocalServerIdentity server={server} tone="menu" />

      <MenuItem
        closeOnClick={false}
        disabled={!stoppable}
        onClick={(event) => {
          event.stopPropagation();
          onStop(server);
        }}
        aria-label={stopHint}
        title={stopHint}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-transparent p-0 text-muted-foreground/55 transition-colors hover:border-destructive/40 hover:bg-[color-mix(in_srgb,var(--destructive)_14%,transparent)] hover:text-destructive data-highlighted:border-destructive/40 data-highlighted:bg-[color-mix(in_srgb,var(--destructive)_14%,transparent)] data-highlighted:text-destructive data-disabled:text-muted-foreground/25 data-disabled:hover:border-transparent data-disabled:hover:bg-transparent data-disabled:hover:text-muted-foreground/25"
      >
        {stopping ? (
          <RefreshCwIcon className="size-3.5 animate-spin" />
        ) : (
          <XIcon className="size-3.5" />
        )}
      </MenuItem>
    </div>
  );
}

/** Centered placeholder for loading / error / empty states inside the menu body. */
function LocalServersPlaceholder({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-3 py-3 text-center">
      <span className="text-muted-foreground/40">{icon}</span>
      <span className="text-[length:var(--app-font-size-ui,12px)] text-muted-foreground">
        {title}
      </span>
      {subtitle ? (
        <span className="text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground/60">
          {subtitle}
        </span>
      ) : null}
    </div>
  );
}

export interface LocalServersTriggerState {
  serverCount: number;
  isBusy: boolean;
}

/**
 * The full local-servers menu: a caller-supplied trigger plus the shared popup body. The port
 * scan runs while the menu is open, or while `enabled` is forced on (the Environment panel keeps
 * it live while the panel is expanded so its row badge stays current). `renderTrigger` returns a
 * `<MenuTrigger>` and receives the live count/busy state so each surface can style its own row.
 */
export function LocalServersMenu({
  enabled = false,
  align = "start",
  side = "bottom",
  popupClassName,
  renderTrigger,
  onOpenServer,
}: {
  enabled?: boolean;
  align?: "start" | "end";
  side?: "top" | "bottom" | "left" | "right";
  popupClassName?: string;
  renderTrigger: (state: LocalServersTriggerState) => ReactNode;
  /** When supplied, clicking a server row opens its URL in the in-app browser. */
  onOpenServer?: ((server: ServerLocalServerProcess, url: string) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const localServersQuery = useQuery(serverLocalServersQueryOptions({ enabled: enabled || open }));
  const stopLocalServerMutation = useMutation(
    serverStopLocalServerMutationOptions({ queryClient }),
  );

  const servers = localServersQuery.data?.servers ?? [];
  const serverCount = servers.length;
  const isBusy = localServersQuery.isFetching || stopLocalServerMutation.isPending;
  const activeStoppingPid = stopLocalServerMutation.variables?.pid ?? null;

  const handleOpenServer = onOpenServer
    ? (server: ServerLocalServerProcess) => {
        const url = localServerUrl(server);
        if (!url) return;
        onOpenServer(server, url);
        setOpen(false);
      }
    : undefined;

  return (
    <Menu onOpenChange={setOpen}>
      {renderTrigger({ serverCount, isBusy })}
      <ComposerPickerMenuPopup
        align={align}
        side={side}
        className={cn("w-72 min-w-72", popupClassName)}
      >
        <div className="mb-0.5 flex items-center justify-between gap-2 border-b border-border/60 pb-1 pl-2 pr-3 pt-px">
          <span className="truncate text-[length:var(--app-font-size-ui-xs,10px)] font-normal text-muted-foreground/75">
            {localServersQuery.isLoading ? "Scanning ports…" : describeServerCount(serverCount)}
          </span>
          <LocalServersRefreshButton
            refreshing={localServersQuery.isFetching}
            onRefresh={() => void localServersQuery.refetch()}
          />
        </div>

        {localServersQuery.isLoading ? (
          <LocalServersPlaceholder
            icon={<RefreshCwIcon className="size-4 animate-spin" />}
            title="Scanning local ports"
          />
        ) : localServersQuery.isError ? (
          <LocalServersPlaceholder
            icon={<GlobeIcon className="size-4" />}
            title="Couldn't scan local ports"
            subtitle={
              localServersQuery.error instanceof Error
                ? localServersQuery.error.message
                : "The scan failed. Try refreshing."
            }
          />
        ) : serverCount === 0 ? (
          <LocalServersPlaceholder
            icon={<GlobeIcon className="size-4" />}
            title="No servers running"
            subtitle="Local dev servers will appear here."
          />
        ) : (
          <div className="flex flex-col gap-0.5">
            {servers.map((server) => (
              <LocalServerRow
                key={server.id}
                server={server}
                stopping={activeStoppingPid === server.pid && stopLocalServerMutation.isPending}
                onStop={(selectedServer) =>
                  stopLocalServerMutation.mutate({
                    pid: selectedServer.pid,
                    port: selectedServer.ports[0] ?? 1,
                  })
                }
                onOpen={handleOpenServer}
              />
            ))}
          </div>
        )}
      </ComposerPickerMenuPopup>
    </Menu>
  );
}

export { MenuTrigger };
