// FILE: EnvironmentPinnedSection.tsx
// Purpose: "Pinned" section of the Environment panel — a checklist of pinned assistant
//          messages with jump-to-message navigation, done toggling (strikethrough),
//          inline rename (double-click), and unpin. Pins are per-thread, server-synced.
// Layer: Environment panel section

import type { MessageId, PinnedMessage } from "@t3tools/contracts";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import { Checkbox } from "~/components/ui/checkbox";
import { IconButton } from "~/components/ui/icon-button";
import { ChevronDownIcon, ChevronUpIcon, GripVerticalIcon, XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { displayLabelFor } from "~/pinnedMessages";

import { EnvironmentCollapsibleSection } from "./EnvironmentRow";

interface EnvironmentPinnedSectionProps {
  pins: readonly PinnedMessage[];
  /** Live text of pinned messages still present in the transcript (absent → unavailable). */
  messageTextById: ReadonlyMap<MessageId, string>;
  onJump: (messageId: MessageId) => void;
  onToggleDone: (messageId: MessageId) => void;
  onUnpin: (messageId: MessageId) => void;
  onRename: (messageId: MessageId, label: string | null) => void;
  onReorder: (messageId: MessageId, targetIndex: number) => void;
}

export function EnvironmentPinnedSection({
  pins,
  messageTextById,
  onJump,
  onToggleDone,
  onUnpin,
  onRename,
  onReorder,
}: EnvironmentPinnedSectionProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activePin = pins.find((pin) => pin.messageId === active.id);
      const targetIndex = pins.findIndex((pin) => pin.messageId === over.id);
      if (!activePin || targetIndex < 0) return;
      onReorder(activePin.messageId, targetIndex);
    },
    [onReorder, pins],
  );

  if (pins.length === 0) {
    return null;
  }
  return (
    <EnvironmentCollapsibleSection label={`Pinned · ${pins.length}`}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
        onDragEnd={handleDragEnd}
      >
        <ul
          className="flex max-h-56 flex-col overflow-y-auto overscroll-contain pr-0.5"
          aria-label="Pinned messages"
        >
          <SortableContext
            items={pins.map((pin) => pin.messageId)}
            strategy={verticalListSortingStrategy}
          >
            {pins.map((pin, index) => (
              <PinnedMessageRow
                key={pin.messageId}
                pin={pin}
                text={messageTextById.get(pin.messageId)}
                onJump={onJump}
                onToggleDone={onToggleDone}
                onUnpin={onUnpin}
                onRename={onRename}
                index={index}
                total={pins.length}
                onReorder={onReorder}
              />
            ))}
          </SortableContext>
        </ul>
      </DndContext>
    </EnvironmentCollapsibleSection>
  );
}

const PinnedMessageRow = memo(function PinnedMessageRow({
  pin,
  text,
  onJump,
  onToggleDone,
  onUnpin,
  onRename,
  index,
  total,
  onReorder,
}: {
  pin: PinnedMessage;
  text: string | undefined;
  onJump: (messageId: MessageId) => void;
  onToggleDone: (messageId: MessageId) => void;
  onUnpin: (messageId: MessageId) => void;
  onRename: (messageId: MessageId, label: string | null) => void;
  index: number;
  total: number;
  onReorder: (messageId: MessageId, targetIndex: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const jumpClickTimeoutRef = useRef<number | null>(null);
  const suppressNextBlurCommitRef = useRef(false);
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: pin.messageId,
    disabled: editing || total < 2,
  });

  const available = text !== undefined;
  const resolvedLabel = displayLabelFor(pin, text);
  const displayLabel = resolvedLabel.length > 0 ? resolvedLabel : "(message unavailable)";

  const clearScheduledJump = useCallback(() => {
    if (jumpClickTimeoutRef.current !== null) {
      window.clearTimeout(jumpClickTimeoutRef.current);
      jumpClickTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (editing) {
      inputRef.current?.select();
    }
  }, [editing]);
  useEffect(() => () => clearScheduledJump(), [clearScheduledJump]);

  const beginEditing = useCallback(() => {
    clearScheduledJump();
    suppressNextBlurCommitRef.current = false;
    setDraft(resolvedLabel);
    setEditing(true);
  }, [clearScheduledJump, resolvedLabel]);

  const commitEditing = useCallback(() => {
    suppressNextBlurCommitRef.current = true;
    setEditing(false);
    const trimmed = draft.trim();
    onRename(pin.messageId, trimmed.length === 0 ? null : trimmed);
  }, [draft, onRename, pin.messageId]);

  const cancelEditing = useCallback(() => {
    suppressNextBlurCommitRef.current = true;
    setEditing(false);
  }, []);
  const handleInputBlur = useCallback(() => {
    if (suppressNextBlurCommitRef.current) {
      suppressNextBlurCommitRef.current = false;
      return;
    }
    commitEditing();
  }, [commitEditing]);

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitEditing();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelEditing();
      }
    },
    [cancelEditing, commitEditing],
  );
  const handleLabelClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (!available) {
        beginEditing();
        return;
      }
      if (event.detail > 1) {
        return;
      }
      clearScheduledJump();
      jumpClickTimeoutRef.current = window.setTimeout(() => {
        jumpClickTimeoutRef.current = null;
        onJump(pin.messageId);
      }, 180);
    },
    [available, beginEditing, clearScheduledJump, onJump, pin.messageId],
  );
  const handleLabelDoubleClick = useCallback(() => {
    beginEditing();
  }, [beginEditing]);
  const handleLabelKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "F2" || (!available && event.key === "Enter")) {
        event.preventDefault();
        beginEditing();
      }
    },
    [available, beginEditing],
  );

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group/pin flex items-center gap-1 rounded-lg px-1.5 py-1 hover:bg-[var(--color-background-elevated-secondary)]",
        isDragging && "z-20 bg-[var(--color-background-elevated-secondary)] opacity-75 shadow-sm",
        isOver && !isDragging && "ring-1 ring-primary/35",
      )}
      aria-posinset={index + 1}
      aria-setsize={total}
    >
      <IconButton
        ref={setActivatorNodeRef}
        label="Drag pinned message to reorder"
        tooltip="Drag to reorder"
        size="icon-xs"
        disabled={total < 2 || editing}
        className="size-5 shrink-0 touch-none cursor-grab text-muted-foreground/45 active:cursor-grabbing disabled:cursor-default disabled:opacity-25"
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon className="size-3" />
      </IconButton>
      <Checkbox
        className="size-3.5 sm:size-3.5"
        checked={pin.done}
        onCheckedChange={() => onToggleDone(pin.messageId)}
        aria-label={pin.done ? "Mark not done" : "Mark done"}
      />
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={handleInputBlur}
          onKeyDown={handleInputKeyDown}
          placeholder={available ? "" : "Label"}
          className="min-w-0 flex-1 rounded border border-input bg-background px-1 py-0.5 text-[length:var(--app-font-size-ui,12px)] text-foreground outline-none focus-visible:border-ring"
        />
      ) : (
        <button
          type="button"
          onClick={handleLabelClick}
          // A short delayed jump lets double-click rename cancel the first click's jump.
          onDoubleClick={handleLabelDoubleClick}
          onKeyDown={handleLabelKeyDown}
          aria-label={
            available
              ? "Jump to pinned message. Press F2 to rename."
              : "Pinned message unavailable. Press Enter to rename."
          }
          title={
            available
              ? "Click to jump · double-click or press F2 to rename"
              : "Click or press Enter to rename"
          }
          className={cn(
            "min-w-0 flex-1 truncate text-left text-[length:var(--app-font-size-ui,12px)] outline-none transition-colors",
            pin.done
              ? "text-muted-foreground/55 line-through"
              : "text-[var(--color-text-foreground)] hover:text-foreground",
            available
              ? "cursor-pointer hover:underline"
              : "cursor-default text-muted-foreground/55",
          )}
        >
          {displayLabel}
        </button>
      )}
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/pin:opacity-100 group-focus-within/pin:opacity-100">
        <IconButton
          label="Move pinned message up"
          tooltip="Move up"
          size="icon-xs"
          disabled={index === 0}
          className="size-5 disabled:opacity-30"
          onClick={() => onReorder(pin.messageId, index - 1)}
        >
          <ChevronUpIcon className="size-3" />
        </IconButton>
        <IconButton
          label="Move pinned message down"
          tooltip="Move down"
          size="icon-xs"
          disabled={index === total - 1}
          className="size-5 disabled:opacity-30"
          onClick={() => onReorder(pin.messageId, index + 1)}
        >
          <ChevronDownIcon className="size-3" />
        </IconButton>
      </span>
      <IconButton
        label="Unpin message"
        tooltip="Unpin"
        size="icon-xs"
        className="shrink-0 opacity-0 transition-opacity group-hover/pin:opacity-100 focus-visible:opacity-100"
        onClick={() => onUnpin(pin.messageId)}
      >
        <XIcon className="size-3" />
      </IconButton>
    </li>
  );
});
