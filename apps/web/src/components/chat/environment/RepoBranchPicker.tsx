// FILE: RepoBranchPicker.tsx
// Purpose: Standalone branch switcher for a single git repository (used by the
//          multi-repo Environment section). Lists local + remote branches, checks
//          out the selected one, and can create a new branch — all scoped to one
//          `cwd`, with no thread/worktree coupling. Checking out a remote branch
//          lets git create the local tracking branch, then we read back the name.
// Layer: Environment panel UI

import type { GitBranch } from "@t3tools/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState, useTransition } from "react";

import { dedupeRemoteBranchesWithLocalMatches } from "~/components/BranchToolbar.logic";
import { Button } from "~/components/ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "~/components/ui/combobox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { toastManager } from "~/components/ui/toast";
import { CentralIcon } from "~/lib/central-icons";
import { PlusIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import {
  gitBranchesQueryOptions,
  gitStatusQueryOptions,
  invalidateGitQueriesForCwds,
} from "~/lib/gitReactQuery";

interface RepoBranchPickerProps {
  readonly cwd: string;
  readonly disabled?: boolean;
  /** Fill the parent's width and truncate the branch label — used in the narrow panel row. */
  readonly fullWidth?: boolean;
}

const DIRTY_CHECKOUT_PATTERN = /uncommitted changes|would be overwritten|local changes/i;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}

export function RepoBranchPicker({
  cwd,
  disabled = false,
  fullWidth = false,
}: RepoBranchPickerProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [isPending, startTransition] = useTransition();

  const branchesQuery = useQuery(gitBranchesQueryOptions(cwd));
  const statusQuery = useQuery(gitStatusQueryOptions(cwd));

  const branches = useMemo(
    () => dedupeRemoteBranchesWithLocalMatches(branchesQuery.data?.branches ?? []),
    [branchesQuery.data?.branches],
  );
  const hasOriginRemote = branchesQuery.data?.hasOriginRemote ?? false;
  const branchByName = useMemo(
    () => new Map(branches.map((branch) => [branch.name, branch] as const)),
    [branches],
  );
  const branchNames = useMemo(() => branches.map((branch) => branch.name), [branches]);

  const currentBranch =
    statusQuery.data?.branch ?? branches.find((branch) => branch.current)?.name ?? null;

  const normalizedQuery = query.trim().toLowerCase();
  const filteredNames = useMemo(
    () =>
      normalizedQuery.length === 0
        ? branchNames
        : branchNames.filter((name) => name.toLowerCase().includes(normalizedQuery)),
    [branchNames, normalizedQuery],
  );

  const runBranchAction = useCallback(
    (action: () => Promise<void>) => {
      startTransition(async () => {
        await action().catch(() => undefined);
        await invalidateGitQueriesForCwds(queryClient, [cwd]).catch(() => undefined);
      });
    },
    [cwd, queryClient],
  );

  const checkout = useCallback(
    (branch: GitBranch) => {
      const api = ensureNativeApi();
      if (isPending) return;
      setOpen(false);
      runBranchAction(async () => {
        try {
          await api.git.checkout({ cwd, branch: branch.name });
        } catch (error) {
          const message = toErrorMessage(error);
          const isDirty = DIRTY_CHECKOUT_PATTERN.test(message);
          toastManager.add({
            type: isDirty ? "warning" : "error",
            title: isDirty ? "Uncommitted changes block switch" : "Failed to switch branch",
            description: isDirty
              ? "Commit or stash this repository's changes before switching."
              : message,
            ...(isDirty
              ? {
                  actionProps: {
                    children: "Stash & switch",
                    onClick: () =>
                      runBranchAction(async () => {
                        try {
                          await api.git.stashAndCheckout({ cwd, branch: branch.name });
                        } catch (stashError) {
                          toastManager.add({
                            type: "error",
                            title: "Failed to stash & switch",
                            description: toErrorMessage(stashError),
                          });
                        }
                      }),
                  },
                }
              : {}),
          });
        }
      });
    },
    [cwd, isPending, runBranchAction],
  );

  const createBranch = useCallback(
    (rawName: string) => {
      const name = rawName.trim();
      const api = ensureNativeApi();
      if (!name || isPending || branchByName.has(name)) return;
      setIsCreateOpen(false);
      setOpen(false);
      runBranchAction(async () => {
        try {
          await api.git.createBranch({ cwd, branch: name, publish: hasOriginRemote });
          await api.git.checkout({ cwd, branch: name });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to create branch",
            description: toErrorMessage(error),
          });
        }
      });
    },
    [branchByName, cwd, hasOriginRemote, isPending, runBranchAction],
  );

  const triggerLabel = currentBranch ?? "Select branch";

  return (
    <>
      <Combobox
        items={branchNames}
        filteredItems={filteredNames}
        autoHighlight
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
        value={currentBranch}
      >
        <ComboboxTrigger
          className={cn(
            "cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-[var(--color-text-foreground-secondary)] transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-[var(--color-text-foreground)] disabled:cursor-not-allowed disabled:opacity-50",
            fullWidth ? "flex w-full min-w-0" : "inline-flex max-w-36",
          )}
          disabled={disabled || isPending || (branchesQuery.isLoading && branches.length === 0)}
          title={currentBranch ? `Branch: ${currentBranch}` : "Switch branch"}
        >
          <CentralIcon name="branch" className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
        </ComboboxTrigger>
        <ComboboxPopup align="end" side="bottom" className="w-72">
          <div className="border-b p-1">
            <ComboboxInput
              inputClassName="ring-0"
              placeholder="Search branches..."
              showTrigger={false}
              size="sm"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <ComboboxEmpty>No branches found.</ComboboxEmpty>
          <ComboboxList className="max-h-56">
            {filteredNames.map((name, index) => {
              const branch = branchByName.get(name);
              if (!branch) return null;
              const badge = branch.current
                ? "current"
                : branch.isRemote
                  ? "remote"
                  : branch.isDefault
                    ? "default"
                    : null;
              return (
                <ComboboxItem
                  hideIndicator
                  key={name}
                  index={index}
                  value={name}
                  className={cn(
                    name === currentBranch &&
                      "bg-[var(--color-background-elevated-secondary)] text-[var(--color-text-foreground)]",
                  )}
                  onClick={() => checkout(branch)}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="truncate">{name}</span>
                    {badge ? (
                      <span className="shrink-0 text-[10px] text-muted-foreground/45">{badge}</span>
                    ) : null}
                  </div>
                </ComboboxItem>
              );
            })}
          </ComboboxList>
          <div className="border-t border-[color:var(--color-border-light)] p-1">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[length:var(--app-font-size-ui,12px)] text-[var(--color-text-foreground)] transition-colors hover:bg-[var(--color-background-elevated-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isPending}
              onClick={() => {
                const seed = query.trim();
                setCreateName(seed.length > 0 && !branchByName.has(seed) ? seed : "");
                setOpen(false);
                setIsCreateOpen(true);
              }}
            >
              <PlusIcon className="size-3.5 shrink-0" />
              <span className="truncate">
                {query.trim().length > 0 && !branchByName.has(query.trim())
                  ? `Create and checkout "${query.trim()}"`
                  : "Create and checkout new branch..."}
              </span>
            </button>
          </div>
        </ComboboxPopup>
      </Combobox>

      <Dialog
        open={isCreateOpen}
        onOpenChange={(next) => {
          setIsCreateOpen(next);
          if (!next) setCreateName("");
        }}
      >
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create branch</DialogTitle>
            <DialogDescription>
              {`Create and switch to a new branch from ${currentBranch ?? "the current HEAD"}.`}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                createBranch(createName);
              }}
            >
              <div className="space-y-1.5">
                <label className="block font-medium text-sm" htmlFor={`branch-create-${cwd}`}>
                  Branch name
                </label>
                <Input
                  autoFocus
                  id={`branch-create-${cwd}`}
                  placeholder="feature/my-change"
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                />
              </div>
              {branchByName.has(createName.trim()) ? (
                <p className="text-destructive text-sm">A branch with this name already exists.</p>
              ) : null}
              <DialogFooter variant="bare">
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setIsCreateOpen(false);
                    setCreateName("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={createName.trim().length === 0 || branchByName.has(createName.trim())}
                >
                  Create and switch
                </Button>
              </DialogFooter>
            </form>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}

export default RepoBranchPicker;
