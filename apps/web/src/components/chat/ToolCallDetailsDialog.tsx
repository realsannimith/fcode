// FILE: ToolCallDetailsDialog.tsx
// Purpose: Modal inspector for command and file-change tool calls from transcript rows.
// Layer: Chat presentation component
// Exports: ToolCallDetailsDialog
// Depends on: WorkLogEntry.toolDetails and shared dialog chrome

import type { CSSProperties, ReactNode } from "react";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { ChangesIcon, CheckIcon, CopyIcon, MinusIcon, PlusIcon, TerminalIcon } from "~/lib/icons";
import { createMarkdownCodeFence, formatShellTranscript } from "~/lib/toolCallDetailsFormatting";
import { cn } from "~/lib/utils";
import {
  countTextLines,
  splitTextLines,
  type WorkLogToolDetails,
  type WorkLogToolOutputDetails,
} from "../../lib/toolCallDetails";
import type { WorkLogEntry } from "../../session-logic";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { DiffStat } from "./DiffStatLabel";
import { FileEntryIcon } from "./FileEntryIcon";

const DETAIL_HEADER_CLASS_NAME =
  "border-b border-border/45 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.14em]";
const DETAIL_CODE_BLOCK_CLASS_NAME =
  "max-h-[min(46vh,30rem)] overflow-auto whitespace-pre-wrap break-words font-chat-code text-[11px] leading-relaxed text-foreground/88";
const TOOL_DETAILS_MARKDOWN_CLASS_NAME =
  "text-[length:var(--app-font-size-ui,12px)] leading-relaxed";
// Fenced code blocks inside ChatMarkdown read the chat transcript's chat-code
// font size (tuned for the main timeline), which reads oversized in this dense
// dialog. Scope a smaller override to just this subtree instead of touching the
// shared transcript font-size setting.
const TOOL_DETAILS_CODEBLOCK_FONT_SIZE_STYLE = {
  "--app-font-size-chat-code": "11px",
} as CSSProperties;

interface ToolCallDetailsDialogProps {
  entry: WorkLogEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ToolCallDetailsDialog({ entry, open, onOpenChange }: ToolCallDetailsDialogProps) {
  const details = entry?.toolDetails;
  const Icon = details?.kind === "file-change" ? ChangesIcon : TerminalIcon;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup surface="solid" className="max-h-[min(86vh,760px)] max-w-4xl gap-0 p-0">
        <DialogHeader className="border-b border-border/55 pr-10">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border/45 bg-background/65 text-muted-foreground/62">
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-base">
                {details?.title ?? "Tool call"}
              </DialogTitle>
              <DialogDescription>
                {details?.kind === "file-change"
                  ? "Edit payload captured for this tool call."
                  : "Command payload captured for this tool call."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogPanel
          className="max-h-[min(72vh,620px)] space-y-4 px-4 py-4"
          data-tool-details-dialog="true"
        >
          <ToolCallDetailsContent details={details} />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

export function ToolCallDetailsContent({ details }: { details: WorkLogToolDetails | undefined }) {
  if (!details) {
    return (
      <div className="rounded-lg border border-border/45 bg-background/60 px-3 py-2 text-sm text-muted-foreground">
        No detailed payload was available for this tool call.
      </div>
    );
  }

  // The per-edit path bars already surface every edited path, so drop files that
  // an edit already covers to avoid repeating the same path two or three times.
  const editPaths = new Set(
    (details.edits ?? [])
      .map((edit) => edit.path)
      .filter((path): path is string => path !== undefined),
  );
  const unreferencedFiles = (details.files ?? []).filter((file) => !editPaths.has(file));

  return (
    <>
      {details.command ? (
        <div className="space-y-2">
          <MarkdownToolCodeBlock language="bash">
            {formatShellTranscript(details.command, details.output)}
          </MarkdownToolCodeBlock>
          {details.output ? <ToolOutputMetadata output={details.output} /> : null}
        </div>
      ) : null}

      {unreferencedFiles.length ? (
        <ToolDetailSection title="Files">
          <div className="flex flex-wrap gap-1.5">
            {unreferencedFiles.map((file) => (
              <PathLabel
                key={file}
                path={file}
                className="max-w-full rounded-md border border-border/45 bg-background/70 px-2 py-1 font-chat-code text-[11px]"
              />
            ))}
          </div>
        </ToolDetailSection>
      ) : null}

      {details.diff ? (
        <ToolDetailSection title="Diff">
          <DiffCodeBlock>{details.diff}</DiffCodeBlock>
        </ToolDetailSection>
      ) : null}

      {details.edits?.length ? (
        <ToolDetailSection title="Edits">
          <div className="space-y-3">
            {details.edits.map((edit, index) => {
              const oldLineCount = edit.oldText !== undefined ? countTextLines(edit.oldText) : 0;
              const newLineCount = edit.newText !== undefined ? countTextLines(edit.newText) : 0;
              return (
                <div
                  key={`${edit.path ?? "edit"}:${index}`}
                  className="@container overflow-hidden rounded-lg border border-border/45 bg-background/58"
                >
                  {edit.path ? (
                    <div className="flex items-center gap-2 border-b border-border/45 bg-background/70 px-3 py-2">
                      <FileEntryIcon
                        pathValue={edit.path}
                        kind="file"
                        realIcon
                        className="size-3.5 shrink-0 text-muted-foreground/70"
                      />
                      <PathLabel
                        path={edit.path}
                        className="min-w-0 flex-1 font-chat-code text-[11px]"
                      />
                      {edit.oldText !== undefined && edit.newText !== undefined ? (
                        <DiffStat
                          additions={newLineCount}
                          deletions={oldLineCount}
                          className="shrink-0 text-[10px]"
                        />
                      ) : null}
                    </div>
                  ) : null}
                  <div
                    className={cn(
                      "grid gap-0",
                      // Container query (not a viewport `md:` breakpoint) so the
                      // two-up layout only kicks in when *this card* actually has
                      // room — it renders both in the wide details dialog and
                      // inline inside the (often much narrower) chat transcript
                      // column, and a viewport breakpoint ignored that difference.
                      edit.oldText !== undefined && edit.newText !== undefined
                        ? "@lg:grid-cols-2"
                        : "grid-cols-1",
                    )}
                  >
                    {edit.oldText !== undefined ? (
                      <TextChangeBlock title="Before" tone="remove" lineCount={oldLineCount}>
                        {edit.oldText}
                      </TextChangeBlock>
                    ) : null}
                    {edit.newText !== undefined ? (
                      <TextChangeBlock title="After" tone="add" lineCount={newLineCount}>
                        {edit.newText}
                      </TextChangeBlock>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </ToolDetailSection>
      ) : null}

      {details.content ? (
        <ToolDetailSection title="Written Content">
          <PlainTextBlock>{details.content}</PlainTextBlock>
        </ToolDetailSection>
      ) : null}

      {details.output && !details.command ? <ToolOutputSection output={details.output} /> : null}
    </>
  );
}

function MarkdownToolCodeBlock(props: { language: string; children: string }) {
  return (
    <div style={TOOL_DETAILS_CODEBLOCK_FONT_SIZE_STYLE}>
      <ChatMarkdown
        text={createMarkdownCodeFence(props.language, props.children)}
        cwd={undefined}
        className={TOOL_DETAILS_MARKDOWN_CLASS_NAME}
      />
    </div>
  );
}

function ToolDetailSection(props: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/56">
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

function ToolOutputMetadata({ output }: { output: WorkLogToolOutputDetails }) {
  if (output.exitCode === undefined && !output.truncated) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground/68">
      {output.exitCode !== undefined ? (
        <span className="rounded-full border border-border/45 px-2 py-0.5">
          Exit code {output.exitCode}
        </span>
      ) : null}
      {output.truncated ? (
        <span className="rounded-full border border-amber-500/30 bg-amber-500/8 px-2 py-0.5 text-amber-200/90">
          Truncated
        </span>
      ) : null}
    </div>
  );
}

function ToolOutputSection({ output }: { output: WorkLogToolOutputDetails }) {
  return (
    <ToolDetailSection title="Output">
      <div className="space-y-3">
        {output.output ? <PlainTextBlock>{output.output}</PlainTextBlock> : null}
        {output.stdout ? (
          <LabeledCodeBlock title="Stdout" tone="output">
            {output.stdout}
          </LabeledCodeBlock>
        ) : null}
        {output.stderr ? (
          <LabeledCodeBlock title="Stderr" tone="error">
            {output.stderr}
          </LabeledCodeBlock>
        ) : null}
        <ToolOutputMetadata output={output} />
      </div>
    </ToolDetailSection>
  );
}

// Plain, unhighlighted text/output — deliberately not routed through the
// markdown code-fence renderer, whose `.chat-markdown pre code` rule forces
// the (larger) chat-code font size and adds a redundant language/copy header
// that duplicates the section title above it.
function PlainTextBlock(props: { children: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/45 bg-background/58">
      <ToolCodeBlock bare>{props.children}</ToolCodeBlock>
    </div>
  );
}

function LabeledCodeBlock(props: { title: string; tone: "output" | "error"; children: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/45 bg-background/58">
      <div
        className={cn(
          DETAIL_HEADER_CLASS_NAME,
          props.tone === "error" ? "text-rose-200/88" : "text-muted-foreground/60",
        )}
      >
        {props.title}
      </div>
      <ToolCodeBlock bare>{props.children}</ToolCodeBlock>
    </div>
  );
}

function TextChangeBlock(props: {
  title: string;
  tone: "add" | "remove";
  lineCount: number;
  children: string;
}) {
  const isEmpty = props.children.length === 0;
  const Icon = props.tone === "add" ? PlusIcon : MinusIcon;
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col border-border/45 @lg:[&:not(:first-child)]:border-l @lg:[&:not(:first-child)]:border-t-0",
        "[&:not(:first-child)]:border-t",
        props.tone === "add" ? "bg-emerald-500/[0.06]" : "bg-rose-500/[0.06]",
      )}
    >
      <div
        className={cn(
          DETAIL_HEADER_CLASS_NAME,
          "flex items-center justify-between gap-2",
          props.tone === "add" ? "text-emerald-200/85" : "text-rose-200/85",
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "flex size-3.5 shrink-0 items-center justify-center rounded-full",
              props.tone === "add" ? "bg-emerald-500/15" : "bg-rose-500/15",
            )}
          >
            <Icon aria-hidden="true" className="size-2" />
          </span>
          {props.title}
          {!isEmpty ? (
            <span className="font-normal normal-case tracking-normal text-muted-foreground/50">
              {props.lineCount} {props.lineCount === 1 ? "line" : "lines"}
            </span>
          ) : null}
        </span>
        {!isEmpty ? <CopyTextButton text={props.children} label={props.title} /> : null}
      </div>
      {isEmpty ? (
        <div className="px-3 py-2.5 font-chat-code text-[11px] italic text-muted-foreground/45">
          (empty)
        </div>
      ) : (
        <NumberedCodeBlock text={props.children} />
      )}
    </div>
  );
}

function CopyTextButton(props: { text: string; label: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="-my-1 shrink-0 text-muted-foreground/55 normal-case hover:text-foreground"
      aria-label={`Copy ${props.label.toLowerCase()} text`}
      onClick={(event) => {
        event.stopPropagation();
        copyToClipboard(props.text, undefined);
      }}
    >
      {isCopied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
    </Button>
  );
}

// Renders code with a right-aligned, non-selectable line-number gutter so
// before/after snippets read like the rest of the app's diff surfaces instead
// of an undifferentiated wall of wrapped text.
function NumberedCodeBlock(props: { text: string }) {
  const lines = splitTextLines(props.text);
  return (
    <div className="max-h-[min(46vh,30rem)] overflow-y-auto py-1.5 font-chat-code text-[11px] leading-relaxed text-foreground/88">
      {lines.map((line, index) => (
        <div key={index} className="flex">
          <span className="w-7 shrink-0 select-none pr-2.5 text-right text-muted-foreground/40 tabular-nums">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words pr-3">
            {line.length > 0 ? line : "\u00a0"}
          </span>
        </div>
      ))}
    </div>
  );
}

// Splits a filesystem path into its directory prefix and final segment so the UI
// can de-emphasize the long directory while keeping the filename readable.
function splitPath(path: string): { dir: string; name: string } {
  const normalized = path.replace(/[/\\]+$/, "");
  const slash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return slash >= 0
    ? { dir: normalized.slice(0, slash + 1), name: normalized.slice(slash + 1) }
    : { dir: "", name: normalized };
}

function PathLabel({ path, className }: { path: string; className?: string }) {
  const { dir, name } = splitPath(path);
  return (
    <span className={cn("flex min-w-0 max-w-full items-baseline", className)} title={path}>
      {dir ? <span className="min-w-0 truncate text-muted-foreground/50">{dir}</span> : null}
      <span className="shrink-0 whitespace-pre text-foreground/85">{name}</span>
    </span>
  );
}

function ToolCodeBlock(props: { children: string; tone?: "default" | "command"; bare?: boolean }) {
  return (
    <pre
      className={cn(
        DETAIL_CODE_BLOCK_CLASS_NAME,
        props.tone === "command" && "text-sky-100/92",
        props.bare
          ? "px-3 py-2.5"
          : "rounded-lg border border-border/45 bg-background/70 px-3 py-2.5",
      )}
    >
      {props.children}
    </pre>
  );
}

function DiffCodeBlock({ children }: { children: string }) {
  const lines = children.split(/\r?\n/);
  return (
    <pre className="max-h-[min(52vh,34rem)] overflow-auto rounded-lg border border-border/45 bg-background/70 px-0 py-2 font-chat-code text-[11px] leading-relaxed">
      {lines.map((line, index) => (
        <span
          key={`${index}:${line.slice(0, 24)}`}
          className={cn(
            "block min-w-max whitespace-pre-wrap break-words px-3",
            line.startsWith("+") && !line.startsWith("+++")
              ? "bg-emerald-500/8 text-emerald-100/92"
              : null,
            line.startsWith("-") && !line.startsWith("---")
              ? "bg-rose-500/8 text-rose-100/92"
              : null,
            line.startsWith("@@") ? "text-sky-200/90" : null,
            /^(diff --git|index |--- |\+\+\+ )/.test(line) ? "text-muted-foreground/62" : null,
          )}
        >
          {line.length > 0 ? line : " "}
        </span>
      ))}
    </pre>
  );
}
