// FILE: PullRequestConflictDialog.tsx
// Purpose: Dialog for resolving a pull request's merge conflicts. Resolves a PR by
//          URL/number, simulates merging its head into its base branch server-side
//          (read-only, via git merge-tree on freshly fetched refs), and when conflicts
//          are found lets the user pick a side per file and hand the resolution to the
//          agent as a composer prompt (gh pr checkout + merge base + push).
// Layer: Git dialog UI

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  GitCheckPullRequestConflictsResult,
  ModelSelection,
  ThreadId,
} from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useConflictResolutionStore } from "~/conflictResolutionStore";
import { ModelSelectionPicker } from "~/components/chat/ModelSelectionPicker";
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
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { toastManager } from "~/components/ui/toast";
import {
  gitCheckPullRequestConflictsMutationOptions,
  gitResolvePullRequestQueryOptions,
} from "~/lib/gitReactQuery";
import { cn } from "~/lib/utils";
import { parsePullRequestReference } from "~/pullRequestReference";
import { useStore } from "~/store";
import { createThreadSelector } from "~/storeSelectors";

import {
  buildPullRequestConflictResolutionPrompt,
  type PullRequestConflictSideChoice,
} from "./GitActionsControl.logic";

interface PullRequestConflictDialogProps {
  readonly cwd: string | null;
  readonly activeThreadId: ThreadId | null;
  readonly initialReference: string | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function PullRequestConflictDialog({
  cwd,
  activeThreadId,
  initialReference,
  open,
  onOpenChange,
}: PullRequestConflictDialogProps) {
  const queryClient = useQueryClient();
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const [reference, setReference] = useState(initialReference ?? "");
  const [referenceDirty, setReferenceDirty] = useState(false);
  const [conflictChoices, setConflictChoices] = useState<
    Record<string, PullRequestConflictSideChoice>
  >({});
  // Which agent gets the resolution prompt; null means keep the thread's current
  // composer selection untouched.
  const [agentSelectionOverride, setAgentSelectionOverride] = useState<ModelSelection | null>(null);
  const [debouncedReference, referenceDebouncer] = useDebouncedValue(
    reference,
    { wait: 450 },
    (debouncerState) => ({ isPending: debouncerState.isPending }),
  );
  const activeThread = useStore(
    useMemo(() => createThreadSelector(activeThreadId), [activeThreadId]),
  );
  // Started threads keep their provider (same rule as the composer); fresh threads
  // may hand the resolution to any provider.
  const hasThreadStarted = Boolean(
    activeThread &&
    (activeThread.latestTurn !== null ||
      activeThread.messages.length > 0 ||
      activeThread.session !== null),
  );
  const lockedAgentProvider = hasThreadStarted
    ? (activeThread?.session?.provider ?? activeThread?.modelSelection.provider ?? null)
    : null;
  const agentSelection = agentSelectionOverride ?? activeThread?.modelSelection ?? null;

  const checkMutation = useMutation(
    gitCheckPullRequestConflictsMutationOptions({ cwd, queryClient }),
  );
  const resetCheckMutation = checkMutation.reset;

  useEffect(() => {
    if (!open) return;
    setReference(initialReference ?? "");
    setReferenceDirty(false);
    setConflictChoices({});
    setAgentSelectionOverride(null);
    resetCheckMutation();
  }, [initialReference, open, resetCheckMutation]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      referenceInputRef.current?.focus();
      referenceInputRef.current?.select();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [open]);

  const parsedReference = parsePullRequestReference(reference);
  const parsedDebouncedReference = parsePullRequestReference(debouncedReference);
  const resolvePullRequestQuery = useQuery(
    gitResolvePullRequestQueryOptions({
      cwd,
      reference: open ? parsedDebouncedReference : null,
    }),
  );
  const resolvedPullRequest =
    parsedReference !== null && parsedReference === parsedDebouncedReference
      ? (resolvePullRequestQuery.data?.pullRequest ?? null)
      : null;
  const isResolving =
    open &&
    parsedReference !== null &&
    resolvedPullRequest === null &&
    (referenceDebouncer.state.isPending ||
      parsedReference !== parsedDebouncedReference ||
      resolvePullRequestQuery.isPending ||
      resolvePullRequestQuery.isFetching);
  const statusTone = useMemo(() => {
    switch (resolvedPullRequest?.state) {
      case "merged":
        return "text-violet-600 dark:text-violet-300/90";
      case "closed":
        return "text-zinc-500 dark:text-zinc-400/80";
      case "open":
        return "text-emerald-600 dark:text-emerald-300/90";
      default:
        return "text-muted-foreground";
    }
  }, [resolvedPullRequest?.state]);

  // Discard a stale check result once it no longer matches the entered reference.
  const checkResult: GitCheckPullRequestConflictsResult | null =
    checkMutation.data && checkMutation.data.pullRequest.number === resolvedPullRequest?.number
      ? checkMutation.data
      : null;
  const conflictResult = checkResult && !checkResult.mergeable ? checkResult : null;

  const closeDialog = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const runConflictCheck = useCallback(() => {
    if (!parsedReference) {
      setReferenceDirty(true);
      return;
    }
    setConflictChoices({});
    checkMutation.mutate({ reference: parsedReference });
  }, [checkMutation, parsedReference]);

  const resolveConflictsWithAgent = useCallback(() => {
    if (!conflictResult || !activeThreadId || !cwd) return;
    const prompt = buildPullRequestConflictResolutionPrompt({
      prNumber: conflictResult.pullRequest.number,
      prTitle: conflictResult.pullRequest.title,
      prUrl: conflictResult.pullRequest.url,
      baseBranch: conflictResult.pullRequest.baseBranch,
      headBranch: conflictResult.pullRequest.headBranch,
      files: conflictResult.conflictingFiles.map((path) => ({
        path,
        choice: conflictChoices[path] ?? "agent",
      })),
    });
    if (agentSelectionOverride) {
      useComposerDraftStore.getState().setModelSelection(activeThreadId, agentSelectionOverride);
    }
    useComposerDraftStore.getState().setPrompt(activeThreadId, prompt);
    // Track the handoff so the thread shows live status and auto re-checks the PR once the
    // agent's turn completes (see ConflictResolutionTrackerBanner / ConflictResolutionWatcher).
    useConflictResolutionStore.getState().startTracking({
      threadId: activeThreadId,
      cwd,
      kind: "pr",
      label: `PR #${conflictResult.pullRequest.number} — ${conflictResult.pullRequest.title}`,
      sourceBranch: null,
      targetBranch: null,
      prReference: parsedReference ?? String(conflictResult.pullRequest.number),
      handoffTurnId: activeThread?.latestTurn?.turnId ?? null,
      initialFiles: conflictResult.conflictingFiles,
    });
    closeDialog();
    toastManager.add({
      type: "success",
      title: "Resolution prompt ready",
      description:
        "Review the PR conflict instructions in the composer and send them to the agent. Progress is tracked above the composer.",
      data: { threadId: activeThreadId },
    });
  }, [
    activeThread?.latestTurn?.turnId,
    activeThreadId,
    agentSelectionOverride,
    closeDialog,
    conflictChoices,
    conflictResult,
    cwd,
    parsedReference,
  ]);

  const validationMessage = !referenceDirty
    ? null
    : reference.trim().length === 0
      ? "Paste a GitHub pull request URL or enter 123 / #123."
      : parsedReference === null
        ? "Use a GitHub pull request URL, 123, or #123."
        : null;
  const resolveErrorMessage =
    resolvedPullRequest === null && parsedReference !== null && resolvePullRequestQuery.isError
      ? errorText(resolvePullRequestQuery.error, "Failed to resolve pull request.")
      : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!checkMutation.isPending) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Resolve PR Conflicts</DialogTitle>
          <DialogDescription>
            Check whether a pull request still merges cleanly into its base branch. Conflicts are
            detected without touching your working tree; resolution is handed to the agent.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Pull request</span>
            <Input
              ref={referenceInputRef}
              placeholder="https://github.com/owner/repo/pull/42 or #42"
              value={reference}
              onChange={(event) => {
                setReferenceDirty(true);
                setReference(event.target.value);
                setConflictChoices({});
                resetCheckMutation();
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }
                event.preventDefault();
                if (!isResolving && !checkMutation.isPending) {
                  runConflictCheck();
                }
              }}
            />
          </label>

          {resolvedPullRequest ? (
            <div className="rounded-xl border border-border/70 bg-muted/24 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">{resolvedPullRequest.title}</p>
                  <p className="truncate text-muted-foreground text-xs">
                    #{resolvedPullRequest.number} · {resolvedPullRequest.headBranch} to{" "}
                    {resolvedPullRequest.baseBranch}
                  </p>
                </div>
                <span className={cn("shrink-0 text-xs capitalize", statusTone)}>
                  {resolvedPullRequest.state}
                </span>
              </div>
            </div>
          ) : null}

          {isResolving ? (
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Spinner className="size-3.5" />
              Resolving pull request...
            </div>
          ) : null}

          {validationMessage ? (
            <p className="text-destructive text-xs">{validationMessage}</p>
          ) : null}
          {resolveErrorMessage ? (
            <p className="text-destructive text-xs">{resolveErrorMessage}</p>
          ) : null}
          {checkMutation.error ? (
            <p className="text-destructive text-sm">
              {errorText(checkMutation.error, "Pull request conflict check failed.")}
            </p>
          ) : null}
          {checkResult?.mergeable ? (
            <p className="text-sm text-success">
              No conflicts: pull request #{checkResult.pullRequest.number} merges cleanly into{" "}
              {checkResult.pullRequest.baseBranch}.
            </p>
          ) : null}
          {conflictResult ? (
            <div className="space-y-2">
              <p className="text-sm text-warning">
                {conflictResult.conflictingFiles.length}{" "}
                {conflictResult.conflictingFiles.length === 1 ? "file conflicts" : "files conflict"}{" "}
                when merging pull request #{conflictResult.pullRequest.number} into{" "}
                {conflictResult.pullRequest.baseBranch}. Nothing was changed. Pick which side to
                keep per file, then hand the resolution to the agent.
              </p>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">Apply to all files</span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="xs" onClick={() => setConflictChoices({})}>
                    Agent decides
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="max-w-40 truncate"
                    onClick={() =>
                      setConflictChoices(
                        Object.fromEntries(
                          conflictResult.conflictingFiles.map((path) => [path, "pr"]),
                        ),
                      )
                    }
                  >
                    Keep {conflictResult.pullRequest.headBranch}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="max-w-40 truncate"
                    onClick={() =>
                      setConflictChoices(
                        Object.fromEntries(
                          conflictResult.conflictingFiles.map((path) => [path, "base"]),
                        ),
                      )
                    }
                  >
                    Keep {conflictResult.pullRequest.baseBranch}
                  </Button>
                </div>
              </div>
              <ScrollArea className="max-h-56 rounded-md border border-[color:var(--color-border)] bg-[var(--color-background-elevated-primary-opaque)]">
                <div className="space-y-1 p-1">
                  {conflictResult.conflictingFiles.map((path) => (
                    <div
                      key={path}
                      className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-xs"
                    >
                      <span className="truncate font-mono">{path}</span>
                      <Select
                        value={conflictChoices[path] ?? "agent"}
                        onValueChange={(value) => {
                          if (value !== "agent" && value !== "pr" && value !== "base") {
                            return;
                          }
                          setConflictChoices((prev) => ({ ...prev, [path]: value }));
                        }}
                      >
                        <SelectTrigger
                          size="xs"
                          className="w-44 shrink-0"
                          aria-label={`Resolution for ${path}`}
                        >
                          <SelectValue className="truncate text-left">
                            {(conflictChoices[path] ?? "agent") === "agent"
                              ? "Agent decides"
                              : conflictChoices[path] === "pr"
                                ? `Keep ${conflictResult.pullRequest.headBranch}`
                                : `Keep ${conflictResult.pullRequest.baseBranch}`}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          <SelectItem value="agent">Agent decides</SelectItem>
                          <SelectItem value="pr">
                            Keep {conflictResult.pullRequest.headBranch}
                          </SelectItem>
                          <SelectItem value="base">
                            Keep {conflictResult.pullRequest.baseBranch}
                          </SelectItem>
                        </SelectPopup>
                      </Select>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              {agentSelection ? (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">Resolve with</span>
                  <ModelSelectionPicker
                    value={agentSelection}
                    cwd={cwd}
                    lockedProvider={lockedAgentProvider}
                    onChange={setAgentSelectionOverride}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={closeDialog}
            disabled={checkMutation.isPending}
          >
            Close
          </Button>
          {conflictResult ? (
            <Button
              size="sm"
              disabled={!activeThreadId}
              title={
                !activeThreadId ? "Open a thread to hand the resolution to the agent." : undefined
              }
              onClick={resolveConflictsWithAgent}
            >
              Resolve with Agent
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={!cwd || !resolvedPullRequest || isResolving || checkMutation.isPending}
              onClick={runConflictCheck}
            >
              {checkMutation.isPending ? "Checking..." : "Check Conflicts"}
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export default PullRequestConflictDialog;
