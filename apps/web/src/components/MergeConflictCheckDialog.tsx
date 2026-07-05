// FILE: MergeConflictCheckDialog.tsx
// Purpose: Dialog for merging any local branch into any other. Checks for conflicts
//          first (read-only, via git merge-tree), performs the merge when clean —
//          ref-only when the target isn't checked out — with optional pushes, and when
//          conflicts are found lets the user pick a side per file and hand the
//          resolution to the agent as a composer prompt. Shared by the single-repo
//          GitActionsControl dropdown and the multi-repo Environment panel rows.
// Layer: Git dialog UI

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  GitCheckMergeConflictsResult,
  GitMergeBranchResult,
  ThreadId,
} from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useComposerDraftStore } from "~/composerDraftStore";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { toastManager } from "~/components/ui/toast";
import {
  gitBranchesQueryOptions,
  gitCheckMergeConflictsMutationOptions,
  gitMergeBranchMutationOptions,
} from "~/lib/gitReactQuery";

import {
  buildMergeConflictResolutionPrompt,
  type MergeConflictSideChoice,
} from "./GitActionsControl.logic";

interface MergeConflictCheckDialogProps {
  readonly cwd: string | null;
  readonly activeThreadId: ThreadId | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

// Conflicts can come from the read-only check or from an attempted merge; both render
// through the same resolution UI.
interface MergeConflictInfo {
  readonly sourceBranch: string;
  readonly targetBranch: string;
  readonly conflictingFiles: readonly string[];
  readonly hasUncommittedChanges: boolean;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function describeMergeResult(result: GitMergeBranchResult): string {
  const base =
    result.status === "already_up_to_date"
      ? `${result.targetBranch} already contains ${result.sourceBranch}.`
      : result.fastForward
        ? `Fast-forwarded ${result.targetBranch} to ${result.sourceBranch}.`
        : `Created merge commit ${result.mergeCommitSha?.slice(0, 7) ?? ""} on ${result.targetBranch}.`;
  const pushed =
    result.pushedBranches.length > 0 ? ` Pushed ${result.pushedBranches.join(", ")}.` : "";
  return `${base}${pushed}`.trim();
}

export function MergeConflictCheckDialog({
  cwd,
  activeThreadId,
  open,
  onOpenChange,
}: MergeConflictCheckDialogProps) {
  const queryClient = useQueryClient();
  const { data: branchList = null } = useQuery({
    ...gitBranchesQueryOptions(cwd),
    enabled: open && cwd !== null,
  });
  const checkMutation = useMutation(gitCheckMergeConflictsMutationOptions({ cwd }));
  const mergeMutation = useMutation(gitMergeBranchMutationOptions({ cwd, queryClient }));
  const [selectedSourceBranch, setSelectedSourceBranch] = useState<string | null>(null);
  const [selectedTargetBranch, setSelectedTargetBranch] = useState<string | null>(null);
  const [pushSourceBranch, setPushSourceBranch] = useState(false);
  const [pushTargetBranch, setPushTargetBranch] = useState(false);
  const [mergeConflictChoices, setMergeConflictChoices] = useState<
    Record<string, MergeConflictSideChoice>
  >({});

  const currentBranchName = branchList?.branches.find((branch) => branch.current)?.name ?? null;
  const defaultBranchName =
    branchList?.branches.find((branch) => !branch.isRemote && branch.isDefault)?.name ?? null;
  const hasOriginRemote = branchList?.hasOriginRemote ?? false;

  // Merge works on commits, so only local branches qualify on either side.
  const localBranchNames = useMemo(
    () =>
      (branchList?.branches ?? [])
        .filter((branch) => !branch.isRemote)
        .map((branch) => branch.name),
    [branchList?.branches],
  );

  // Selections stay null until the user picks, so defaults can settle after the branch
  // list finishes loading without an effect racing it.
  const sourceBranch = selectedSourceBranch ?? currentBranchName ?? localBranchNames[0] ?? null;
  const targetBranchOptions = useMemo(
    () => localBranchNames.filter((name) => name !== sourceBranch),
    [localBranchNames, sourceBranch],
  );
  const targetBranch =
    selectedTargetBranch && selectedTargetBranch !== sourceBranch
      ? selectedTargetBranch
      : defaultBranchName && defaultBranchName !== sourceBranch
        ? defaultBranchName
        : (targetBranchOptions[0] ?? null);

  const checkResult: GitCheckMergeConflictsResult | null = checkMutation.data ?? null;
  const mergeResult: GitMergeBranchResult | null = mergeMutation.data ?? null;

  // A merge attempt that hit conflicts takes precedence over an older check result.
  const conflictInfo: MergeConflictInfo | null = useMemo(
    () =>
      mergeResult?.status === "conflicts"
        ? {
            sourceBranch: mergeResult.sourceBranch,
            targetBranch: mergeResult.targetBranch,
            conflictingFiles: mergeResult.conflictingFiles,
            hasUncommittedChanges: checkResult?.hasUncommittedChanges ?? false,
          }
        : checkResult && !checkResult.mergeable
          ? checkResult
          : null,
    [checkResult, mergeResult],
  );

  const resetCheckMutation = checkMutation.reset;
  const resetMergeMutation = mergeMutation.reset;
  const resetResults = useCallback(() => {
    resetCheckMutation();
    resetMergeMutation();
    setMergeConflictChoices({});
  }, [resetCheckMutation, resetMergeMutation]);

  useEffect(() => {
    if (!open) return;
    resetCheckMutation();
    resetMergeMutation();
    setSelectedSourceBranch(null);
    setSelectedTargetBranch(null);
    setPushSourceBranch(false);
    setPushTargetBranch(false);
    setMergeConflictChoices({});
  }, [cwd, open, resetCheckMutation, resetMergeMutation]);

  const closeDialog = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const runMergeCheck = useCallback(() => {
    if (!sourceBranch || !targetBranch) return;
    resetMergeMutation();
    setMergeConflictChoices({});
    checkMutation.mutate({ targetBranch, sourceBranch });
  }, [checkMutation, resetMergeMutation, sourceBranch, targetBranch]);

  const runMerge = useCallback(() => {
    if (!sourceBranch || !targetBranch) return;
    setMergeConflictChoices({});
    mergeMutation.mutate(
      {
        sourceBranch,
        targetBranch,
        ...(pushSourceBranch ? { pushSourceBranch: true } : {}),
        ...(pushTargetBranch ? { pushTargetBranch: true } : {}),
      },
      {
        onSuccess: (result) => {
          if (result.status === "conflicts") return;
          if (result.pushFailures.length > 0) {
            toastManager.add({
              type: "warning",
              title: "Merged, but push failed",
              description: `${describeMergeResult(result)} Push failed: ${result.pushFailures.join("; ")}`,
              ...(activeThreadId ? { data: { threadId: activeThreadId } } : {}),
            });
          } else {
            toastManager.add({
              type: "success",
              title:
                result.status === "already_up_to_date" ? "Already up to date" : "Branches merged",
              description: describeMergeResult(result),
              ...(activeThreadId ? { data: { threadId: activeThreadId } } : {}),
            });
          }
          closeDialog();
        },
      },
    );
  }, [
    activeThreadId,
    closeDialog,
    mergeMutation,
    pushSourceBranch,
    pushTargetBranch,
    sourceBranch,
    targetBranch,
  ]);

  const resolveMergeConflictsWithAgent = useCallback(() => {
    if (!conflictInfo || !activeThreadId) return;
    const prompt = buildMergeConflictResolutionPrompt({
      sourceBranch: conflictInfo.sourceBranch,
      targetBranch: conflictInfo.targetBranch,
      files: conflictInfo.conflictingFiles.map((path) => ({
        path,
        choice: mergeConflictChoices[path] ?? "agent",
      })),
      hasUncommittedChanges: conflictInfo.hasUncommittedChanges,
    });
    useComposerDraftStore.getState().setPrompt(activeThreadId, prompt);
    closeDialog();
    toastManager.add({
      type: "success",
      title: "Resolution prompt ready",
      description: "Review the merge instructions in the composer and send them to the agent.",
      data: { threadId: activeThreadId },
    });
  }, [activeThreadId, closeDialog, conflictInfo, mergeConflictChoices]);

  const isBusy = checkMutation.isPending || mergeMutation.isPending;
  const branchPickerReady = sourceBranch !== null && targetBranch !== null;

  const renderBranchSelect = (input: {
    id: string;
    ariaLabel: string;
    value: string | null;
    options: readonly string[];
    onChange: (value: string) => void;
  }) => (
    <Select
      value={input.value}
      onValueChange={(value) => {
        if (typeof value !== "string") return;
        input.onChange(value);
        resetResults();
      }}
    >
      <SelectTrigger size="sm" className="w-full" id={input.id} aria-label={input.ariaLabel}>
        <SelectValue className="truncate text-left">{input.value ?? "Select a branch"}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {input.options.map((branchName) => (
          <SelectItem key={branchName} value={branchName}>
            {branchName}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Merge Branch</DialogTitle>
          <DialogDescription>
            Merge any local branch into another. Conflicts are detected before anything changes;
            when the target branch is not checked out, your working tree stays untouched.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block font-medium text-sm" htmlFor="merge-source-branch">
                Merge
              </label>
              {renderBranchSelect({
                id: "merge-source-branch",
                ariaLabel: "Source branch",
                value: sourceBranch,
                options: localBranchNames,
                onChange: (value) => {
                  setSelectedSourceBranch(value);
                  if (selectedTargetBranch === value) setSelectedTargetBranch(null);
                },
              })}
            </div>
            <div className="space-y-1.5">
              <label className="block font-medium text-sm" htmlFor="merge-target-branch">
                Into
              </label>
              {renderBranchSelect({
                id: "merge-target-branch",
                ariaLabel: "Target branch",
                value: targetBranch,
                options: targetBranchOptions,
                onChange: setSelectedTargetBranch,
              })}
            </div>
          </div>
          {hasOriginRemote ? (
            <div className="space-y-1.5 text-xs">
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={pushSourceBranch}
                  onCheckedChange={(checked) => setPushSourceBranch(checked === true)}
                />
                <span>Push {sourceBranch ?? "source branch"} to origin</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={pushTargetBranch}
                  onCheckedChange={(checked) => setPushTargetBranch(checked === true)}
                />
                <span>Push {targetBranch ?? "target branch"} to origin after merge</span>
              </label>
            </div>
          ) : null}
          {branchList && targetBranchOptions.length === 0 ? (
            <p className="text-muted-foreground text-sm">No other local branches to merge into.</p>
          ) : null}
          {checkMutation.error ? (
            <p className="text-destructive text-sm">
              {errorText(checkMutation.error, "Merge conflict check failed.")}
            </p>
          ) : null}
          {mergeMutation.error ? (
            <p className="text-destructive text-sm">
              {errorText(mergeMutation.error, "Merge failed.")}
            </p>
          ) : null}
          {checkResult?.mergeable && mergeResult === null ? (
            <p className="text-sm text-success">
              No conflicts: {checkResult.sourceBranch} merges cleanly into{" "}
              {checkResult.targetBranch}. Ready to merge.
            </p>
          ) : null}
          {conflictInfo ? (
            <div className="space-y-2">
              <p className="text-sm text-warning">
                {conflictInfo.conflictingFiles.length}{" "}
                {conflictInfo.conflictingFiles.length === 1 ? "file conflicts" : "files conflict"}{" "}
                when merging {conflictInfo.sourceBranch} into {conflictInfo.targetBranch}. Nothing
                was changed. Pick which side to keep per file, then hand the merge to the agent.
              </p>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">Apply to all files</span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="xs" onClick={() => setMergeConflictChoices({})}>
                    Agent decides
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="max-w-40 truncate"
                    onClick={() =>
                      setMergeConflictChoices(
                        Object.fromEntries(
                          conflictInfo.conflictingFiles.map((path) => [path, "source"]),
                        ),
                      )
                    }
                  >
                    Keep {conflictInfo.sourceBranch}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="max-w-40 truncate"
                    onClick={() =>
                      setMergeConflictChoices(
                        Object.fromEntries(
                          conflictInfo.conflictingFiles.map((path) => [path, "target"]),
                        ),
                      )
                    }
                  >
                    Keep {conflictInfo.targetBranch}
                  </Button>
                </div>
              </div>
              <ScrollArea className="max-h-56 rounded-md border border-[color:var(--color-border)] bg-[var(--color-background-elevated-primary-opaque)]">
                <div className="space-y-1 p-1">
                  {conflictInfo.conflictingFiles.map((path) => (
                    <div
                      key={path}
                      className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-xs"
                    >
                      <span className="truncate font-mono">{path}</span>
                      <Select
                        value={mergeConflictChoices[path] ?? "agent"}
                        onValueChange={(value) => {
                          if (value !== "agent" && value !== "source" && value !== "target") {
                            return;
                          }
                          setMergeConflictChoices((prev) => ({ ...prev, [path]: value }));
                        }}
                      >
                        <SelectTrigger
                          size="xs"
                          className="w-44 shrink-0"
                          aria-label={`Resolution for ${path}`}
                        >
                          <SelectValue className="truncate text-left">
                            {(mergeConflictChoices[path] ?? "agent") === "agent"
                              ? "Agent decides"
                              : mergeConflictChoices[path] === "source"
                                ? `Keep ${conflictInfo.sourceBranch}`
                                : `Keep ${conflictInfo.targetBranch}`}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          <SelectItem value="agent">Agent decides</SelectItem>
                          <SelectItem value="source">Keep {conflictInfo.sourceBranch}</SelectItem>
                          <SelectItem value="target">Keep {conflictInfo.targetBranch}</SelectItem>
                        </SelectPopup>
                      </Select>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              {conflictInfo.hasUncommittedChanges ? (
                <p className="text-muted-foreground text-xs">
                  Uncommitted working tree changes are not part of this simulation.
                </p>
              ) : null}
            </div>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={closeDialog}>
            Close
          </Button>
          {conflictInfo ? (
            <Button
              size="sm"
              disabled={!activeThreadId}
              title={!activeThreadId ? "Open a thread to hand the merge to the agent." : undefined}
              onClick={resolveMergeConflictsWithAgent}
            >
              Resolve with Agent
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={!branchPickerReady || isBusy}
                onClick={runMergeCheck}
              >
                {checkMutation.isPending ? "Checking..." : "Check Conflicts"}
              </Button>
              <Button size="sm" disabled={!branchPickerReady || isBusy} onClick={runMerge}>
                {mergeMutation.isPending ? "Merging..." : "Merge"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export default MergeConflictCheckDialog;
