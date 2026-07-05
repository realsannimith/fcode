// FILE: MultiRepoGitSection.tsx
// Purpose: Environment-panel section that appears when the active project folder is a
//          *container* of several independent git repos (e.g. `pk/frontend`, `pk/backend`)
//          rather than a single repo. Each repo gets its branch + change stats, a branch
//          switcher, and commit / push / commit&push actions (commit opens a message
//          dialog). A header offers "Commit all" and "Push all" across every repo.
// Layer: Environment panel UI
//
// The section self-gates on repository discovery: when the project root is itself a repo
// (the normal single-repo case) it renders nothing, leaving the existing GitActionsControl
// to drive the experience unchanged.

import { useCallback, useMemo, useState } from "react";

import type { GitDiscoveredRepository, GitStackedAction, ThreadId } from "@t3tools/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import {
  gitDiscoverRepositoriesQueryOptions,
  gitStatusQueryOptions,
  invalidateGitQueriesForCwds,
} from "~/lib/gitReactQuery";
import {
  EllipsisIcon,
  FolderClosedIcon,
  GitCommitIcon,
  GitMergeIcon,
  LoaderCircleIcon,
  PushIcon,
} from "~/lib/icons";
import { cn, randomUUID } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";

import { MergeConflictCheckDialog } from "../../MergeConflictCheckDialog";

import {
  ENVIRONMENT_ROW_ICON_CLASS_NAME,
  EnvironmentLabeledSection,
  EnvironmentRow,
} from "./EnvironmentRow";
import {
  describeStackedResult,
  summarizeRepoActionResults,
  type RepoActionResult,
} from "./MultiRepoGitSection.logic";
import { RepoBranchPicker } from "./RepoBranchPicker";

interface MultiRepoGitSectionProps {
  readonly gitCwd: string | null;
  readonly activeThreadId: ThreadId | null;
}

// A commit needs a message dialog; push is fire-and-forget. `commit_push` reuses the dialog.
type CommitDialogState = {
  readonly target: "all" | GitDiscoveredRepository;
  readonly action: Extract<GitStackedAction, "commit" | "commit_push">;
};

const STATS_TEXT_CLASS_NAME =
  "flex shrink-0 items-center gap-1 tabular-nums text-xs text-[var(--color-text-foreground-secondary)]";

function repoLabel(target: "all" | GitDiscoveredRepository): string {
  return target === "all" ? "all repositories" : target.name;
}

export function MultiRepoGitSection({ gitCwd, activeThreadId }: MultiRepoGitSectionProps) {
  const queryClient = useQueryClient();
  const { data: discovery } = useQuery(gitDiscoverRepositoriesQueryOptions(gitCwd));
  const [busyPaths, setBusyPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [commitDialog, setCommitDialog] = useState<CommitDialogState | null>(null);
  const [dialogMessage, setDialogMessage] = useState("");
  const [mergeCheckRepoPath, setMergeCheckRepoPath] = useState<string | null>(null);

  // Only surface for container folders: when the root itself is a repo, the standard
  // single-repo controls already cover it.
  const repositories = useMemo(
    () => (discovery && !discovery.rootIsRepo ? discovery.repositories : []),
    [discovery],
  );

  const threadToastData = useMemo(
    () => (activeThreadId ? { threadId: activeThreadId } : undefined),
    [activeThreadId],
  );

  const runAction = useCallback(
    async (
      repos: readonly GitDiscoveredRepository[],
      action: GitStackedAction,
      actionLabel: string,
      commitMessage?: string,
    ) => {
      if (repos.length === 0) return;
      const api = ensureNativeApi();
      const paths = repos.map((repo) => repo.path);
      setBusyPaths((prev) => new Set([...prev, ...paths]));

      const toastId = toastManager.add({
        type: "loading",
        title: `${actionLabel}...`,
        timeout: 0,
        data: threadToastData,
      });

      const results: RepoActionResult[] = [];
      for (const repo of repos) {
        try {
          const result = await api.git.runStackedAction({
            actionId: randomUUID(),
            cwd: repo.path,
            action,
            ...(commitMessage ? { commitMessage } : {}),
          });
          const described = describeStackedResult(action, result);
          results.push({ name: repo.name, status: described.status, detail: described.detail });
        } catch (error) {
          results.push({
            name: repo.name,
            status: "failed",
            error: error instanceof Error ? error.message : "Action failed.",
          });
        }
        // Refresh only the repos we touched so unrelated caches stay warm.
        await invalidateGitQueriesForCwds(queryClient, [repo.path]);
      }

      const summary = summarizeRepoActionResults({ actionLabel, results });
      toastManager.update(toastId, {
        type: summary.toastType,
        title: summary.title,
        ...(summary.description ? { description: summary.description } : {}),
        data: threadToastData,
      });

      setBusyPaths((prev) => {
        const next = new Set(prev);
        for (const path of paths) next.delete(path);
        return next;
      });
    },
    [queryClient, threadToastData],
  );

  const openCommitDialog = useCallback((state: CommitDialogState) => {
    setDialogMessage("");
    setCommitDialog(state);
  }, []);

  const submitCommitDialog = useCallback(() => {
    const state = commitDialog;
    if (!state) return;
    const repos = state.target === "all" ? repositories : [state.target];
    const verb = state.action === "commit_push" ? "Commit & push" : "Commit";
    const actionLabel = state.target === "all" ? `${verb} all` : `${verb} ${state.target.name}`;
    const trimmed = dialogMessage.trim();
    setCommitDialog(null);
    void runAction(repos, state.action, actionLabel, trimmed.length > 0 ? trimmed : undefined);
  }, [commitDialog, dialogMessage, repositories, runAction]);

  if (repositories.length === 0) return null;

  const isBusy = busyPaths.size > 0;

  return (
    <EnvironmentLabeledSection label="Repositories">
      <EnvironmentRow
        icon={
          isBusy ? (
            <LoaderCircleIcon
              className={cn(ENVIRONMENT_ROW_ICON_CLASS_NAME, "animate-spin")}
              aria-hidden
            />
          ) : (
            <GitCommitIcon className={ENVIRONMENT_ROW_ICON_CLASS_NAME} aria-hidden />
          )
        }
        label="Commit all"
        trailing={<span className="text-xs opacity-60">{repositories.length}</span>}
        disabled={isBusy}
        onClick={() => openCommitDialog({ target: "all", action: "commit" })}
      />
      <EnvironmentRow
        icon={<PushIcon className={ENVIRONMENT_ROW_ICON_CLASS_NAME} aria-hidden />}
        label="Push all"
        disabled={isBusy}
        onClick={() => void runAction(repositories, "push", "Push all")}
      />
      {repositories.map((repo) => (
        <RepoStatusRow
          key={repo.path}
          repo={repo}
          isBusy={busyPaths.has(repo.path)}
          disabled={isBusy}
          onCommit={() => openCommitDialog({ target: repo, action: "commit" })}
          onCommitPush={() => openCommitDialog({ target: repo, action: "commit_push" })}
          onPush={() => void runAction([repo], "push", `Push ${repo.name}`)}
          onCheckMergeConflicts={() => setMergeCheckRepoPath(repo.path)}
        />
      ))}

      <MergeConflictCheckDialog
        cwd={mergeCheckRepoPath}
        activeThreadId={activeThreadId}
        open={mergeCheckRepoPath !== null}
        onOpenChange={(open) => {
          if (!open) setMergeCheckRepoPath(null);
        }}
      />

      <Dialog
        open={commitDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCommitDialog(null);
            setDialogMessage("");
          }
        }}
      >
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {commitDialog?.action === "commit_push" ? "Commit & push" : "Commit"}
            </DialogTitle>
            <DialogDescription>
              {commitDialog
                ? `Commit changes in ${repoLabel(commitDialog.target)}.`
                : "Commit changes."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-1">
            <p className="text-xs font-medium">Commit message (optional)</p>
            <Textarea
              autoFocus
              value={dialogMessage}
              onChange={(event) => setDialogMessage(event.target.value)}
              placeholder="Leave empty to auto-generate"
              size="sm"
            />
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCommitDialog(null);
                setDialogMessage("");
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={submitCommitDialog}>
              {commitDialog?.action === "commit_push" ? "Commit & push" : "Commit"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </EnvironmentLabeledSection>
  );
}

interface RepoStatusRowProps {
  readonly repo: GitDiscoveredRepository;
  readonly isBusy: boolean;
  readonly disabled: boolean;
  readonly onCommit: () => void;
  readonly onCommitPush: () => void;
  readonly onPush: () => void;
  readonly onCheckMergeConflicts: () => void;
}

function RepoStatusRow({
  repo,
  isBusy,
  disabled,
  onCommit,
  onCommitPush,
  onPush,
  onCheckMergeConflicts,
}: RepoStatusRowProps) {
  const { data: status = null } = useQuery(gitStatusQueryOptions(repo.path));
  const hasChanges = status?.hasWorkingTreeChanges ?? false;
  const additions = status?.workingTree.insertions ?? 0;
  const deletions = status?.workingTree.deletions ?? 0;
  const aheadCount = status?.aheadCount ?? 0;
  const canPush = aheadCount > 0;

  const stats = hasChanges ? (
    <>
      <span className="text-success">+{additions}</span>
      <span className="text-destructive">-{deletions}</span>
    </>
  ) : aheadCount > 0 ? (
    <span className="opacity-60">↑{aheadCount}</span>
  ) : (
    <span className="opacity-60">clean</span>
  );

  // Stacked two-line layout so the row fits the narrow (w-72) Environment panel without
  // horizontal overflow: line 1 = name + actions, line 2 = branch picker + change stats.
  return (
    <div className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-1 text-[length:var(--app-font-size-ui,12px)]">
      <div className="flex w-full items-center gap-1.5">
        <span className="flex size-4 shrink-0 items-center justify-center">
          <FolderClosedIcon className={ENVIRONMENT_ROW_ICON_CLASS_NAME} aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate" title={repo.relativePath || repo.name}>
          {repo.name}
        </span>
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Git actions for ${repo.name}`}
                title="Git actions"
                disabled={disabled || isBusy}
                className="[&_svg]:mx-0"
              />
            }
          >
            {isBusy ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <EllipsisIcon className="size-3.5" aria-hidden />
            )}
          </MenuTrigger>
          <MenuPopup align="end" side="bottom" className="min-w-44">
            <MenuItem disabled={!hasChanges} onClick={onCommit}>
              <GitCommitIcon className="size-3.5" aria-hidden />
              <span className="flex-1">Commit…</span>
            </MenuItem>
            <MenuItem disabled={!hasChanges} onClick={onCommitPush}>
              <PushIcon className="size-3.5" aria-hidden />
              <span className="flex-1">Commit &amp; push</span>
            </MenuItem>
            <MenuSeparator />
            <MenuItem disabled={!canPush} onClick={onPush}>
              <PushIcon className="size-3.5" aria-hidden />
              <span className="flex-1">Push</span>
            </MenuItem>
            <MenuSeparator />
            <MenuItem onClick={onCheckMergeConflicts}>
              <GitMergeIcon className="size-3.5" aria-hidden />
              <span className="flex-1">Merge branch…</span>
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      {/* Indented 22px (icon 16 + gap 6) so line 2 aligns under the repo name. */}
      <div className="flex w-full items-center gap-1.5 pl-[22px]">
        <div className="min-w-0 flex-1">
          <RepoBranchPicker cwd={repo.path} disabled={disabled} fullWidth />
        </div>
        <span className={STATS_TEXT_CLASS_NAME}>{stats}</span>
      </div>
    </div>
  );
}

export default MultiRepoGitSection;
