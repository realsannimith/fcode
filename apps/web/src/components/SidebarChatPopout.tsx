// FILE: SidebarChatPopout.tsx
// Purpose: Quick-chat panel opened from the sidebar "Chat" item. The whole
//          conversation happens inside the panel: it lists recent home chats,
//          opens them in place, and sends turns itself. Panel turns always run
//          chat-only (runtimeMode "approval-required" = read-only sandbox), so
//          the agent can answer but never edits files or runs mutating commands.
// Layer: overlay — portaled to <body> so sidebar collapse/transform styles never
//        clip or reposition the fixed panel; React context (stores, tooltips)
//        still flows through the portal. Supports docked (bottom-right) and
//        free-floating (drag by header) placement, persisted per client.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { LuPictureInPicture2 } from "react-icons/lu";

import { type ModelSelection, type ThreadId } from "@t3tools/contracts";
import { buildPromptThreadTitleFallback } from "@t3tools/shared/chatThreads";
import { getDefaultModel } from "@t3tools/shared/model";

import {
  ChevronLeftIcon,
  ComposerSendArrowIcon,
  Maximize2,
  MessageCircleIcon,
  MinusIcon,
  NewThreadIcon,
} from "~/lib/icons";
import { cn } from "~/lib/utils";
import { useAppSettings } from "../appSettings";
import { ensureHomeChatProject } from "../lib/chatProjects";
import { formatRelativeTime } from "../lib/relativeTime";
import { promoteThreadCreate } from "../lib/threadCreatePromotion";
import { newCommandId, newMessageId, newThreadId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { createSidebarThreadSummarySelector } from "../storeSelectors";
import { getThreadFromState } from "../threadDerivation";
import { retainThreadDetailSubscription } from "../threadDetailSubscriptionRetention";
import type { SidebarThreadSummary } from "../types";
import { useWorkspaceStore } from "../workspaceStore";
import ChatMarkdown from "./ChatMarkdown";
import { SidebarIconButton } from "./SidebarIconButton";

// Read-only sandbox across providers: the quick chat can answer and read, but
// any mutating action needs an approval that only the full view can grant.
const QUICK_CHAT_RUNTIME_MODE = "approval-required" as const;

const LAYOUT_STORAGE_KEY = "fcode:chat-popout-layout:v1";

type PopoutLayout = "docked" | "floating";

interface PersistedPopoutLayout {
  readonly layout: PopoutLayout;
  readonly x: number;
  readonly y: number;
}

function readPersistedLayout(): PersistedPopoutLayout {
  const fallback: PersistedPopoutLayout = { layout: "docked", x: 0, y: 0 };
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedPopoutLayout>;
    return {
      layout: parsed.layout === "floating" ? "floating" : "docked",
      x: typeof parsed.x === "number" && Number.isFinite(parsed.x) ? parsed.x : 0,
      y: typeof parsed.y === "number" && Number.isFinite(parsed.y) ? parsed.y : 0,
    };
  } catch {
    return fallback;
  }
}

function persistLayout(input: PersistedPopoutLayout): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(input));
  } catch {
    // Layout preference is cosmetic; ignore storage failures.
  }
}

function clampPosition(x: number, y: number, panelWidth: number): { x: number; y: number } {
  const margin = 8;
  const maxX = Math.max(margin, window.innerWidth - panelWidth - margin);
  const maxY = Math.max(margin, window.innerHeight - 120);
  return {
    x: Math.min(Math.max(x, margin), maxX),
    y: Math.min(Math.max(y, margin), maxY),
  };
}

export interface SidebarChatPopoutProps {
  readonly open: boolean;
  /** Minimize the panel (– affordance and Escape). */
  readonly onClose: () => void;
  /** Open a brand-new full chat page on the main surface and minimize the panel. */
  readonly onOpenFullView: () => void;
  /** Open an existing thread as a full page and minimize the panel. */
  readonly onOpenThreadFullView: (threadId: ThreadId) => void;
  /** Recent home-chat threads, already sorted per the user's sidebar sort order. */
  readonly chatThreads: readonly SidebarThreadSummary[];
  /** Extra header controls (sort menu) rendered before the layout/minimize cluster. */
  readonly headerActions?: ReactNode;
}

export function SidebarChatPopout({
  open,
  onClose,
  onOpenFullView,
  onOpenThreadFullView,
  chatThreads,
  headerActions,
}: SidebarChatPopoutProps) {
  const homeDir = useWorkspaceStore((state) => state.homeDir);
  const chatWorkspaceRoot = useWorkspaceStore((state) => state.chatWorkspaceRoot);
  const { settings } = useAppSettings();

  const [activeThreadId, setActiveThreadId] = useState<ThreadId | null>(null);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const initialLayout = useMemo(readPersistedLayout, []);
  const [layout, setLayout] = useState<PopoutLayout>(initialLayout.layout);
  const [floatPosition, setFloatPosition] = useState<{ x: number; y: number }>({
    x: initialLayout.x,
    y: initialLayout.y,
  });

  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const activeThread = useStore((state) =>
    activeThreadId ? getThreadFromState(state, activeThreadId) : undefined,
  );
  const activeSummarySelector = useMemo(
    () => createSidebarThreadSummarySelector(activeThreadId),
    [activeThreadId],
  );
  const activeSummary = useStore(activeSummarySelector);

  const defaultModelSelection = useMemo<ModelSelection | null>(() => {
    const model = getDefaultModel(settings.defaultProvider);
    // Per-provider structs all share the { provider, model } shape used here.
    return model ? ({ provider: settings.defaultProvider, model } as ModelSelection) : null;
  }, [settings.defaultProvider]);

  // Keep the open panel's thread detail streaming even though it is not the
  // route thread — EventRouter subscribes to every retained id.
  useEffect(() => {
    if (!open || !activeThreadId) {
      return;
    }
    return retainThreadDetailSubscription(activeThreadId);
  }, [open, activeThreadId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  const visibleMessages = useMemo(
    () => (activeThread?.messages ?? []).filter((message) => message.role !== "system"),
    [activeThread?.messages],
  );
  const lastMessage = visibleMessages.at(-1);
  const isTurnRunning =
    activeThread?.session?.orchestrationStatus === "running" ||
    activeThread?.latestTurn?.state === "running";
  const showThinkingIndicator =
    (sending || isTurnRunning) && !(lastMessage?.role === "assistant" && lastMessage.streaming);

  // Follow the tail while the assistant streams; length-based deps keep this
  // effect cheap without re-running on unrelated store updates.
  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) {
      transcript.scrollTop = transcript.scrollHeight;
    }
  }, [activeThreadId, visibleMessages.length, lastMessage?.text.length, showThinkingIndicator]);

  const openThreadInPanel = useCallback((threadId: ThreadId) => {
    setActiveThreadId(threadId);
    setSendError(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const startNewChatInPanel = useCallback(() => {
    setActiveThreadId(null);
    setSendError(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const submitPrompt = useCallback(async () => {
    const text = prompt.trim();
    if (text.length === 0 || sending) {
      return;
    }
    const api = readNativeApi();
    if (!api) {
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      let threadId = activeThreadId;
      let modelSelection = activeSummary?.modelSelection ?? defaultModelSelection;
      if (!threadId) {
        if (!homeDir || !defaultModelSelection) {
          setSendError("Chat is not ready yet — the workspace is still loading.");
          return;
        }
        const projectId = await ensureHomeChatProject({ homeDir, chatWorkspaceRoot });
        if (!projectId) {
          setSendError("Unable to prepare a chat workspace.");
          return;
        }
        threadId = newThreadId();
        modelSelection = defaultModelSelection;
        await promoteThreadCreate(
          {
            type: "thread.create",
            commandId: newCommandId(),
            threadId,
            projectId,
            title: buildPromptThreadTitleFallback(text),
            modelSelection,
            runtimeMode: QUICK_CHAT_RUNTIME_MODE,
            interactionMode: "default",
            envMode: "local",
            entryPoint: "chat",
            branch: null,
            worktreePath: null,
            lastKnownPr: null,
            createdAt: new Date().toISOString(),
          },
          api,
          { force: true },
        );
        setActiveThreadId(threadId);
      }
      if (!modelSelection) {
        setSendError("No default model is configured for quick chat.");
        return;
      }
      await api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text,
          attachments: [],
        },
        modelSelection,
        runtimeMode: QUICK_CHAT_RUNTIME_MODE,
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      });
      setPrompt("");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Failed to send the message.");
    } finally {
      setSending(false);
    }
  }, [
    activeSummary?.modelSelection,
    activeThreadId,
    chatWorkspaceRoot,
    defaultModelSelection,
    homeDir,
    prompt,
    sending,
  ]);

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submitPrompt();
    }
  };

  const toggleLayout = useCallback(() => {
    setLayout((current) => {
      const next: PopoutLayout = current === "docked" ? "floating" : "docked";
      let nextPosition = floatPosition;
      if (next === "floating") {
        const rect = panelRef.current?.getBoundingClientRect();
        nextPosition = rect
          ? clampPosition(rect.left, rect.top, rect.width)
          : clampPosition(window.innerWidth, window.innerHeight, 432);
        setFloatPosition(nextPosition);
      }
      persistLayout({ layout: next, x: nextPosition.x, y: nextPosition.y });
      return next;
    });
  }, [floatPosition]);

  const onHeaderPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (layout !== "floating" || event.button !== 0) {
        return;
      }
      // Buttons in the header keep their click behavior; only bare header
      // surface starts a drag.
      if ((event.target as HTMLElement).closest("button, input, [role=menu]")) {
        return;
      }
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      dragStateRef.current = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
      const onMove = (moveEvent: globalThis.PointerEvent) => {
        const dragState = dragStateRef.current;
        if (!dragState || moveEvent.pointerId !== dragState.pointerId) {
          return;
        }
        const width = panelRef.current?.getBoundingClientRect().width ?? 432;
        setFloatPosition(
          clampPosition(
            moveEvent.clientX - dragState.offsetX,
            moveEvent.clientY - dragState.offsetY,
            width,
          ),
        );
      };
      const onUp = (upEvent: globalThis.PointerEvent) => {
        const dragState = dragStateRef.current;
        if (!dragState || upEvent.pointerId !== dragState.pointerId) {
          return;
        }
        dragStateRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setFloatPosition((position) => {
          persistLayout({ layout: "floating", x: position.x, y: position.y });
          return position;
        });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      event.preventDefault();
    },
    [layout],
  );

  if (!open || typeof document === "undefined") {
    return null;
  }

  const headerTitle = activeThreadId ? (activeSummary?.title ?? "Chat") : "New chat";
  const isThreadView = activeThreadId !== null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Quick chat"
      className={cn(
        "fixed z-50 flex w-120 max-w-[calc(100vw-2rem)] flex-col overflow-hidden",
        "h-[min(42rem,calc(100vh-5rem))]",
        "rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl",
        "animate-[sidebar-chat-popout-in_180ms_ease-out] font-system-ui",
        layout === "docked" && "right-4 bottom-4",
      )}
      style={layout === "floating" ? { left: floatPosition.x, top: floatPosition.y } : undefined}
    >
      <style>{`@keyframes sidebar-chat-popout-in {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}`}</style>

      <div
        className={cn(
          "flex shrink-0 items-center gap-1 border-b border-border/60 px-3 py-2",
          layout === "floating" && "cursor-grab select-none active:cursor-grabbing",
        )}
        onPointerDown={onHeaderPointerDown}
      >
        {isThreadView ? (
          <SidebarIconButton
            icon={ChevronLeftIcon}
            label="Back to recent chats"
            onClick={startNewChatInPanel}
            tooltip="Back"
            tooltipSide="top"
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate text-[length:var(--app-font-size-ui,12px)] font-medium text-foreground">
          {headerTitle}
        </span>
        {headerActions}
        <SidebarIconButton
          icon={NewThreadIcon}
          label="Start a new quick chat"
          onClick={startNewChatInPanel}
          tooltip="New chat"
          tooltipSide="top"
        />
        <SidebarIconButton
          icon={LuPictureInPicture2}
          label={layout === "docked" ? "Float panel" : "Dock panel to corner"}
          onClick={toggleLayout}
          className={cn(layout === "floating" && "text-foreground")}
          tooltip={layout === "docked" ? "Float" : "Dock to corner"}
          tooltipSide="top"
        />
        <SidebarIconButton
          icon={Maximize2}
          label="Open full chat view"
          onClick={() => {
            if (activeThreadId) {
              onOpenThreadFullView(activeThreadId);
              return;
            }
            onOpenFullView();
          }}
          tooltip="Open full view"
          tooltipSide="top"
        />
        <SidebarIconButton
          icon={MinusIcon}
          label="Minimize chat"
          onClick={onClose}
          tooltip="Minimize"
          tooltipSide="top"
        />
      </div>

      {isThreadView ? (
        <div ref={transcriptRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {visibleMessages.length === 0 && !showThinkingIndicator ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground/58">
              <MessageCircleIcon className="size-5" />
              <span className="text-[length:var(--app-font-size-ui,12px)]">
                Ask anything — this chat never touches your files.
              </span>
            </div>
          ) : null}
          {visibleMessages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[var(--sidebar-accent)] px-3 py-2 text-[length:var(--app-font-size-ui,12px)] whitespace-pre-wrap text-foreground">
                  {message.text}
                </div>
              </div>
            ) : (
              <div
                key={message.id}
                className="max-w-full text-[length:var(--app-font-size-ui,12px)]"
              >
                <ChatMarkdown text={message.text} cwd={undefined} isStreaming={message.streaming} />
              </div>
            ),
          )}
          {showThinkingIndicator ? (
            <div className="flex items-center gap-1.5 text-muted-foreground/58">
              <span className="inline-flex size-1.5 animate-pulse rounded-full bg-current" />
              <span className="text-[length:var(--app-font-size-ui,12px)]">Thinking…</span>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <div className="px-2 pb-1 text-[length:var(--app-font-size-ui,12px)] text-muted-foreground/79">
            Recent chats
          </div>
          {chatThreads.length === 0 ? (
            <div className="px-2 py-2 text-[length:var(--app-font-size-ui,12px)] text-muted-foreground/48">
              No chats yet
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {chatThreads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  className="flex w-full cursor-pointer items-baseline gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-accent)]"
                  onClick={() => openThreadInPanel(thread.id)}
                >
                  <span className="min-w-0 flex-1 truncate text-[length:var(--app-font-size-ui,12px)] text-foreground/89">
                    {thread.title}
                  </span>
                  <span className="shrink-0 text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground/50">
                    {formatRelativeTime(
                      thread.updatedAt ?? thread.latestUserMessageAt ?? thread.createdAt,
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="shrink-0 border-t border-border/60 p-2">
        {activeSummary?.hasPendingApprovals ? (
          <button
            type="button"
            className="mb-2 w-full cursor-pointer rounded-lg border border-warning/40 bg-warning/8 px-2.5 py-1.5 text-left text-[length:var(--app-font-size-ui,12px)] text-foreground/89"
            onClick={() => activeThreadId && onOpenThreadFullView(activeThreadId)}
          >
            Quick chat is chat-only — an action needs approval. Open full view to review.
          </button>
        ) : null}
        {sendError ? (
          <div className="mb-2 rounded-lg border border-destructive/40 bg-destructive/8 px-2.5 py-1.5 text-[length:var(--app-font-size-ui,12px)] text-foreground/89">
            {sendError}
          </div>
        ) : null}
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-xl border border-border px-2.5 py-1.5",
            "bg-[var(--color-background-control-opaque,transparent)]",
            "focus-within:border-[color:var(--color-border-focus,var(--color-border))]",
          )}
        >
          <input
            ref={inputRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Ask anything"
            aria-label="Quick chat message"
            className={cn(
              "min-w-0 flex-1 bg-transparent text-[length:var(--app-font-size-ui,12px)]",
              "text-foreground placeholder:text-muted-foreground/58 outline-none",
            )}
          />
          <button
            type="button"
            aria-label="Send message"
            disabled={prompt.trim().length === 0 || sending}
            onClick={() => void submitPrompt()}
            className={cn(
              "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full",
              "bg-primary text-primary-foreground transition-opacity",
              "disabled:cursor-default disabled:opacity-35",
            )}
          >
            <ComposerSendArrowIcon className="size-3.5" />
          </button>
        </div>
        <div className="px-1 pt-1.5 text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground/48">
          Chat only — this panel never edits files or runs commands.
        </div>
      </div>
    </div>,
    document.body,
  );
}
