// FILE: CodexAccountsSettingsSection.tsx
// Purpose: Settings → Providers → Codex accounts manager. Lists the default login
// plus additional accounts (each backed by its own CODEX_HOME shadow directory with
// a private auth.json), with in-app sign-in/sign-out and add/remove.
// Layer: Web settings presentation

import type {
  CodexAccountSettings,
  ServerCodexAccountStatus,
  ServerConfig,
  ServerProviderAuthStatus,
  ServerProviderStatus,
} from "@t3tools/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { deriveCodexAccountHomePath, useAppSettings } from "~/appSettings";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { toastManager } from "~/components/ui/toast";
import { useRefreshProviderStatusesNow } from "~/hooks/useProviderStatusRefresh";
import { serverConfigQueryOptions, serverQueryKeys } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { cn } from "~/lib/utils";

const ACCOUNT_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

// Settings persist asynchronously after `updateSettings`; delay the status
// re-probe slightly so the server sees the new accounts list.
const POST_SETTINGS_REFRESH_DELAY_MS = 1_000;

function slugifyAccountLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 48);
}

function deriveAccountId(label: string, existing: ReadonlySet<string>): string | null {
  const base = slugifyAccountLabel(label);
  if (!base || !ACCOUNT_ID_PATTERN.test(base)) {
    return null;
  }
  if (!existing.has(base)) {
    return base;
  }
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

function authPill(authStatus: ServerProviderAuthStatus | undefined, authLabel?: string) {
  if (authStatus === "authenticated") {
    return {
      label: authLabel ?? "Signed in",
      className: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
    };
  }
  if (authStatus === "unauthenticated") {
    return {
      label: "Not signed in",
      className: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
    };
  }
  return { label: "Unknown", className: "bg-muted text-muted-foreground" };
}

function AccountRow(props: {
  title: string;
  homePathHint: string;
  authStatus: ServerProviderAuthStatus | undefined;
  authLabel: string | undefined;
  statusMessage: string | undefined;
  signInPending: boolean;
  onSignIn: () => void;
  onCancelSignIn: () => void;
  onSignOut: () => void;
  onRemove?: () => void;
}) {
  const pill = authPill(props.authStatus, props.authLabel);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--color-border)] bg-transparent px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm text-foreground">{props.title}</span>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none",
              pill.className,
            )}
            title={props.statusMessage}
          >
            {props.signInPending ? "Waiting for browser sign-in…" : pill.label}
          </span>
        </div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
          {props.homePathHint}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {props.signInPending ? (
          <Button type="button" size="xs" variant="outline" onClick={props.onCancelSignIn}>
            Cancel
          </Button>
        ) : props.authStatus === "authenticated" ? (
          <Button type="button" size="xs" variant="outline" onClick={props.onSignOut}>
            Sign out
          </Button>
        ) : (
          <Button type="button" size="xs" variant="outline" onClick={props.onSignIn}>
            Sign in
          </Button>
        )}
        {props.onRemove ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="text-muted-foreground"
            onClick={props.onRemove}
          >
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function CodexAccountsSettingsSection() {
  const { settings, updateSettings } = useAppSettings();
  const queryClient = useQueryClient();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const refreshProviderStatuses = useRefreshProviderStatusesNow();
  const [newAccountLabel, setNewAccountLabel] = useState("");
  const [pendingSignIns, setPendingSignIns] = useState<ReadonlySet<string>>(new Set());
  const refreshTimerRef = useRef<number | null>(null);

  const codexStatus: ServerProviderStatus | undefined = useMemo(
    () => serverConfigQuery.data?.providers.find((status) => status.provider === "codex"),
    [serverConfigQuery.data?.providers],
  );
  const accountStatusById = useMemo(
    () =>
      new Map<string, ServerCodexAccountStatus>(
        (codexStatus?.accounts ?? []).map((entry) => [entry.id, entry]),
      ),
    [codexStatus?.accounts],
  );

  // A pending sign-in resolves when the pushed provider status flips the
  // account (or the primary login) to authenticated.
  useEffect(() => {
    if (pendingSignIns.size === 0) {
      return;
    }
    const resolved = [...pendingSignIns].filter((accountId) => {
      const authStatus =
        accountId === "" ? codexStatus?.authStatus : accountStatusById.get(accountId)?.authStatus;
      return authStatus === "authenticated";
    });
    if (resolved.length > 0) {
      setPendingSignIns((current) => {
        const next = new Set(current);
        for (const accountId of resolved) {
          next.delete(accountId);
        }
        return next;
      });
    }
  }, [accountStatusById, codexStatus?.authStatus, pendingSignIns]);

  useEffect(
    () => () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    },
    [],
  );

  const scheduleStatusRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      refreshProviderStatuses();
    }, POST_SETTINGS_REFRESH_DELAY_MS);
  }, [refreshProviderStatuses]);

  const setPending = useCallback((accountId: string, pending: boolean) => {
    setPendingSignIns((current) => {
      const next = new Set(current);
      if (pending) {
        next.add(accountId);
      } else {
        next.delete(accountId);
      }
      return next;
    });
  }, []);

  const signIn = useCallback(
    (accountId: string) => {
      const api = ensureNativeApi();
      void api.server
        .codexAccountLogin(accountId ? { accountId } : {})
        .then((result) => {
          if (result.status === "started" || result.status === "alreadyRunning") {
            setPending(accountId, true);
            toastManager.add({
              type: "success",
              title: "Codex sign-in started",
              description: "Complete the sign-in in your browser.",
            });
          }
        })
        .catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: "Could not start Codex sign-in",
            description: error instanceof Error ? error.message : "Unknown error.",
          });
        });
    },
    [setPending],
  );

  const cancelSignIn = useCallback(
    (accountId: string) => {
      const api = ensureNativeApi();
      void api.server
        .codexAccountLoginCancel(accountId ? { accountId } : {})
        .catch(() => undefined)
        .finally(() => {
          setPending(accountId, false);
        });
    },
    [setPending],
  );

  const signOut = useCallback(
    (accountId: string) => {
      const api = ensureNativeApi();
      void api.server
        .codexAccountLogout(accountId ? { accountId } : {})
        .then((result) => {
          queryClient.setQueryData<ServerConfig>(serverQueryKeys.config(), (current) =>
            current ? { ...current, providers: result.providers } : current,
          );
        })
        .catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: "Could not sign out",
            description: error instanceof Error ? error.message : "Unknown error.",
          });
        });
    },
    [queryClient],
  );

  const addAccount = useCallback(() => {
    const label = newAccountLabel.trim();
    const existingIds = new Set(settings.codexAccounts.map((account) => account.id));
    const id = deriveAccountId(label, existingIds);
    if (!id) {
      toastManager.add({
        type: "error",
        title: "Could not add account",
        description: "Enter a name containing at least one letter.",
      });
      return;
    }
    const account: CodexAccountSettings = {
      id,
      label,
      // Persist the resolved home explicitly so probes, sign-in, and sessions
      // agree on this account's directory even if the shared home changes.
      shadowHomePath: deriveCodexAccountHomePath(settings.codexHomePath, {
        id,
        shadowHomePath: "",
      }),
    };
    updateSettings({ codexAccounts: [...settings.codexAccounts, account] });
    setNewAccountLabel("");
    scheduleStatusRefresh();
  }, [
    newAccountLabel,
    scheduleStatusRefresh,
    settings.codexAccounts,
    settings.codexHomePath,
    updateSettings,
  ]);

  const removeAccount = useCallback(
    (accountId: string) => {
      updateSettings({
        codexAccounts: settings.codexAccounts.filter((account) => account.id !== accountId),
        ...(settings.codexActiveAccountId === accountId ? { codexActiveAccountId: "" } : {}),
      });
      scheduleStatusRefresh();
    },
    [scheduleStatusRefresh, settings.codexAccounts, settings.codexActiveAccountId, updateSettings],
  );

  return (
    <div className="space-y-2">
      <span className="block text-xs font-medium text-foreground">Accounts</span>
      <p className="text-xs text-muted-foreground">
        Run Codex with more than one account. Accounts share the Codex home (sessions, config,
        caches) but keep separate logins, so you can switch accounts in the model picker — even for
        existing threads.
      </p>

      <div className="space-y-2">
        <AccountRow
          title="Default"
          homePathHint={settings.codexHomePath.trim() || "~/.codex"}
          authStatus={codexStatus?.authStatus}
          authLabel={codexStatus?.authLabel}
          statusMessage={codexStatus?.message}
          signInPending={pendingSignIns.has("")}
          onSignIn={() => signIn("")}
          onCancelSignIn={() => cancelSignIn("")}
          onSignOut={() => signOut("")}
        />
        {settings.codexAccounts.map((account) => {
          const accountStatus = accountStatusById.get(account.id);
          return (
            <AccountRow
              key={account.id}
              title={account.label.trim() || account.id}
              homePathHint={deriveCodexAccountHomePath(settings.codexHomePath, account)}
              authStatus={accountStatus?.authStatus}
              authLabel={accountStatus?.authLabel}
              statusMessage={accountStatus?.message}
              signInPending={pendingSignIns.has(account.id)}
              onSignIn={() => signIn(account.id)}
              onCancelSignIn={() => cancelSignIn(account.id)}
              onSignOut={() => signOut(account.id)}
              onRemove={() => removeAccount(account.id)}
            />
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <Input
          size="sm"
          variant="soft"
          value={newAccountLabel}
          onChange={(event) => setNewAccountLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addAccount();
            }
          }}
          placeholder="e.g. Work"
          aria-label="New Codex account name"
          spellCheck={false}
        />
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="shrink-0"
          onClick={addAccount}
          disabled={newAccountLabel.trim().length === 0}
        >
          Add account
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Removing an account does not delete its home directory or sign it out.
      </p>
    </div>
  );
}
