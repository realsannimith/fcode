// FILE: TerminalChrome.tsx
// Purpose: Reusable terminal chrome primitives for tab bars, sidebars, and toolbar actions.
// Layer: Terminal presentation components
// Depends on: terminal visual identities plus shared popover/button styling.
//
// Note: raw <button> usage in this file is intentional. These are tab-strip and
// list-row affordances (activate tab, close tab, terminal row, group header)
// rather than generic action buttons, so they live outside the shadcn Button
// taxonomy. When/if we introduce a shared Tabs primitive, these can migrate.

import type { ReactNode } from "react";

import type { ResolvedTerminalVisualIdentity } from "@t3tools/shared/terminalThreads";
import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { IconButton } from "~/components/ui/icon-button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { selectRepresentativeTerminalVisualIdentity } from "~/terminalVisualIdentity";

import { DOCK_HEADER_ICON_BUTTON_CLASS, SurfaceTabChip } from "../chat/chatHeaderControls";
import type { ThreadTerminalDropPosition } from "../../types";
import type { ResolvedTerminalGroupLayout } from "./TerminalLayout";
import TerminalActivityIndicator from "./TerminalActivityIndicator";
import TerminalIdentityIcon from "./TerminalIdentityIcon";

export interface TerminalChromeActionItem {
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}

export function TerminalChromeActions(props: {
  actions: ReadonlyArray<TerminalChromeActionItem>;
  variant: "compact" | "workspace" | "sidebar";
}) {
  const buttonClassName =
    props.variant === "sidebar"
      ? "!size-6 shrink-0 rounded-md [&_svg,&_[data-slot=central-icon]]:mx-0"
      : DOCK_HEADER_ICON_BUTTON_CLASS;

  return (
    <div className="inline-flex items-center gap-0.5">
      {props.actions.map((action) => (
        <IconButton
          key={action.label}
          className={cn(buttonClassName, action.disabled ? "pointer-events-none opacity-45" : "")}
          label={action.label}
          tooltip={action.label}
          tooltipSide="bottom"
          size="icon-xs"
          variant="chrome"
          disabled={action.disabled}
          onClick={() => {
            if (action.disabled) return;
            action.onClick();
          }}
        >
          {action.children}
        </IconButton>
      ))}
    </div>
  );
}

// Drag-id namespaces. Group tabs drag under their plain group id (they are
// @dnd-kit sortable items); pane tabs drag under a prefixed id so the shared
// context can tell the two gestures apart.
const TERMINAL_GROUP_DROP_ZONE_ID_PREFIX = "terminal-group-drop:";
const TERMINAL_PANE_TAB_DRAG_ID_PREFIX = "terminal-tab:";
const TERMINAL_PANE_DROP_ZONE_ID_PREFIX = "terminal-pane-drop:";

export type TerminalSurfaceDragState =
  | { kind: "group"; groupId: string }
  | { kind: "terminal"; terminalId: string };

function isDropPosition(position: string): position is ThreadTerminalDropPosition {
  return (
    position === "top" ||
    position === "right" ||
    position === "bottom" ||
    position === "left" ||
    position === "center"
  );
}

function terminalGroupDropZoneId(position: ThreadTerminalDropPosition): string {
  return `${TERMINAL_GROUP_DROP_ZONE_ID_PREFIX}${position}`;
}

function parseTerminalGroupDropZoneId(id: string): ThreadTerminalDropPosition | null {
  if (!id.startsWith(TERMINAL_GROUP_DROP_ZONE_ID_PREFIX)) {
    return null;
  }
  const position = id.slice(TERMINAL_GROUP_DROP_ZONE_ID_PREFIX.length);
  return isDropPosition(position) ? position : null;
}

function terminalPaneTabDragId(terminalId: string): string {
  return `${TERMINAL_PANE_TAB_DRAG_ID_PREFIX}${terminalId}`;
}

function parseTerminalPaneTabDragId(id: string): string | null {
  return id.startsWith(TERMINAL_PANE_TAB_DRAG_ID_PREFIX)
    ? id.slice(TERMINAL_PANE_TAB_DRAG_ID_PREFIX.length)
    : null;
}

// Position comes before the terminal id so parsing stays unambiguous even if a
// terminal id ever contains ":".
function terminalPaneDropZoneId(targetTerminalId: string, position: ThreadTerminalDropPosition) {
  return `${TERMINAL_PANE_DROP_ZONE_ID_PREFIX}${position}:${targetTerminalId}`;
}

function parseTerminalPaneDropZoneId(
  id: string,
): { targetTerminalId: string; position: ThreadTerminalDropPosition } | null {
  if (!id.startsWith(TERMINAL_PANE_DROP_ZONE_ID_PREFIX)) {
    return null;
  }
  const rest = id.slice(TERMINAL_PANE_DROP_ZONE_ID_PREFIX.length);
  const separatorIndex = rest.indexOf(":");
  if (separatorIndex < 0) {
    return null;
  }
  const position = rest.slice(0, separatorIndex);
  const targetTerminalId = rest.slice(separatorIndex + 1);
  if (!isDropPosition(position) || targetTerminalId.length === 0) {
    return null;
  }
  return { targetTerminalId, position };
}

// Shared drag context for the terminal surface. It spans the group tab bar
// (sortable reorder + drop-on-viewport) and the per-pane tab strips (drag a
// pane tab onto another pane to move or split, cmux-style), so it must wrap
// both — the drawer mounts it around the whole terminal surface. Zones win
// over tabs when the pointer is inside one; otherwise the nearest tab keeps
// the familiar reorder behavior.
export function TerminalDndContext(props: {
  onReorderGroups?: ((activeGroupId: string, overGroupId: string) => void) | undefined;
  onDropGroupOnViewport?:
    | ((groupId: string, position: ThreadTerminalDropPosition) => void)
    | undefined;
  onDropTerminalOnPane?:
    | ((terminalId: string, targetTerminalId: string, position: ThreadTerminalDropPosition) => void)
    | undefined;
  onDragStateChange: (dragState: TerminalSurfaceDragState | null) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const collisionDetection: CollisionDetection = (args) => {
    const withinPointer = pointerWithin(args);
    return withinPointer.length > 0 ? withinPointer : closestCenter(args);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const activeId = String(event.active.id);
    const draggedTerminalId = parseTerminalPaneTabDragId(activeId);
    props.onDragStateChange(
      draggedTerminalId
        ? { kind: "terminal", terminalId: draggedTerminalId }
        : { kind: "group", groupId: activeId },
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    props.onDragStateChange(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    const draggedTerminalId = parseTerminalPaneTabDragId(activeId);
    if (draggedTerminalId) {
      const paneDrop = parseTerminalPaneDropZoneId(overId);
      if (paneDrop) {
        props.onDropTerminalOnPane?.(
          draggedTerminalId,
          paneDrop.targetTerminalId,
          paneDrop.position,
        );
      }
      return;
    }

    const groupDropPosition = parseTerminalGroupDropZoneId(overId);
    if (groupDropPosition) {
      props.onDropGroupOnViewport?.(activeId, groupDropPosition);
      return;
    }
    if (activeId === overId || parseTerminalPaneDropZoneId(overId)) return;
    props.onReorderGroups?.(activeId, overId);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => props.onDragStateChange(null)}
    >
      {props.children}
    </DndContext>
  );
}

interface TerminalGroupDropZoneSpec {
  position: ThreadTerminalDropPosition;
  // Pointer hit area — the five areas partition the viewport without overlap.
  hitClassName: string;
  // Highlight showing where the dropped group's pane would land.
  previewClassName: string;
}

const TERMINAL_GROUP_DROP_ZONES: readonly TerminalGroupDropZoneSpec[] = [
  {
    position: "left",
    hitClassName: "inset-y-0 left-0 w-1/4",
    previewClassName: "inset-y-0 left-0 w-1/2",
  },
  {
    position: "right",
    hitClassName: "inset-y-0 right-0 w-1/4",
    previewClassName: "inset-y-0 right-0 w-1/2",
  },
  {
    position: "top",
    hitClassName: "top-0 left-1/4 right-1/4 h-1/3",
    previewClassName: "inset-x-0 top-0 h-1/2",
  },
  {
    position: "bottom",
    hitClassName: "bottom-0 left-1/4 right-1/4 h-1/3",
    previewClassName: "inset-x-0 bottom-0 h-1/2",
  },
  {
    position: "center",
    hitClassName: "left-1/4 right-1/4 top-1/3 bottom-1/3",
    previewClassName: "inset-1",
  },
];

function TerminalDropZone(props: TerminalGroupDropZoneSpec & { id: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: props.id });
  return (
    <>
      <div ref={setNodeRef} className={cn("absolute", props.hitClassName)} />
      {isOver ? (
        <div
          className={cn(
            "pointer-events-none absolute rounded-md bg-primary/15 ring-1 ring-inset ring-primary/50",
            props.previewClassName,
          )}
        />
      ) : null}
    </>
  );
}

// Overlay rendered above the active group's viewport while a group tab drag is
// in flight. Edges split the group in that direction; the center merges the
// dragged terminals in as pane tabs.
export function TerminalGroupDropZones() {
  return (
    <div className="absolute inset-0 z-30">
      {TERMINAL_GROUP_DROP_ZONES.map((zone) => (
        <TerminalDropZone
          key={zone.position}
          id={terminalGroupDropZoneId(zone.position)}
          {...zone}
        />
      ))}
    </div>
  );
}

// Overlay rendered above one pane while a pane tab drag is in flight. Edges
// split that pane with the dragged terminal; the center moves it into the
// pane's tab strip. targetTerminalId anchors the drop in the layout tree — it
// must be a terminal already in the pane and not the dragged one.
export function TerminalPaneDropZones(props: { targetTerminalId: string }) {
  return (
    <div className="absolute inset-0 z-30">
      {TERMINAL_GROUP_DROP_ZONES.map((zone) => (
        <TerminalDropZone
          key={zone.position}
          id={terminalPaneDropZoneId(props.targetTerminalId, zone.position)}
          {...zone}
        />
      ))}
    </div>
  );
}

// Makes a pane-local tab chip draggable within the shared TerminalDndContext.
// Like SortableTerminalGroupTab, the chip's own activate/close buttons keep
// working because the PointerSensor only claims the gesture past its
// activation distance.
export function DraggableTerminalPaneTab(props: { terminalId: string; children: ReactNode }) {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useDraggable({
    id: terminalPaneTabDragId(props.terminalId),
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn("flex shrink-0", isDragging && "z-10 opacity-70")}
      {...attributes}
      {...listeners}
    >
      {props.children}
    </div>
  );
}

// A single draggable group tab. Wrapping the shared SurfaceTabChip in a
// @dnd-kit sortable node keeps the chip's own activate/close buttons intact
// (the PointerSensor only claims the gesture past its activation distance, so a
// plain click still selects/closes the tab) while the whole chip acts as the
// drag handle for reordering and for the viewport drop zones.
function SortableTerminalGroupTab(props: { id: string; children: ReactNode }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: props.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("flex shrink-0", isDragging && "z-10 opacity-70")}
      {...attributes}
      {...listeners}
    >
      {props.children}
    </div>
  );
}

export function TerminalWorkspaceTabBar(props: {
  terminalGroups: ResolvedTerminalGroupLayout[];
  activeGroupId: string;
  terminalVisualIdentityById: ReadonlyMap<string, ResolvedTerminalVisualIdentity>;
  actions: ReadonlyArray<TerminalChromeActionItem>;
  onActiveGroupChange: (groupId: string) => void;
  onCloseGroup: (groupId: string) => void;
  onReorderGroups?: ((activeGroupId: string, overGroupId: string) => void) | undefined;
}) {
  const canCloseGroups = props.terminalGroups.length > 1;
  const canReorderGroups = Boolean(props.onReorderGroups) && props.terminalGroups.length > 1;

  const renderGroupTab = (terminalGroup: ResolvedTerminalGroupLayout) => {
    const isActive = terminalGroup.id === props.activeGroupId;
    const visualIdentity = selectRepresentativeTerminalVisualIdentity({
      activeTerminalId: terminalGroup.activeTerminalId,
      terminalIds: terminalGroup.terminalIds,
      terminalVisualIdentityById: props.terminalVisualIdentityById,
    })?.identity;
    const groupTitle = visualIdentity?.title ?? "Terminal";
    const closeTabLabel = `Close ${visualIdentity?.title ?? "Terminal tab"}`;
    return (
      <SurfaceTabChip
        active={isActive}
        title={groupTitle}
        label={groupTitle}
        labelClassName="max-w-40"
        icon={
          <TerminalIdentityIcon
            className="size-3.5"
            iconKey={visualIdentity?.iconKey ?? "terminal"}
          />
        }
        leading={
          visualIdentity && visualIdentity.state !== "idle" ? (
            <TerminalActivityIndicator
              className="text-foreground/70"
              state={visualIdentity.state}
            />
          ) : null
        }
        trailing={
          terminalGroup.terminalIds.length > 1 ? (
            <span className="shrink-0 text-[10px] text-current/55">
              {terminalGroup.terminalIds.length}
            </span>
          ) : null
        }
        closeLabel={closeTabLabel}
        onSelect={() => props.onActiveGroupChange(terminalGroup.id)}
        onClose={canCloseGroups ? () => props.onCloseGroup(terminalGroup.id) : undefined}
      />
    );
  };

  return (
    <div className="flex min-h-9 min-w-0 items-center gap-1 bg-[var(--color-background-surface)] px-1.5 py-1">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {canReorderGroups ? (
          // Sortable items only; the DndContext lives in an ancestor
          // (TerminalGroupDndContext) so viewport drop zones share the drag.
          <SortableContext
            items={props.terminalGroups.map((terminalGroup) => terminalGroup.id)}
            strategy={horizontalListSortingStrategy}
          >
            {props.terminalGroups.map((terminalGroup) => (
              <SortableTerminalGroupTab key={terminalGroup.id} id={terminalGroup.id}>
                {renderGroupTab(terminalGroup)}
              </SortableTerminalGroupTab>
            ))}
          </SortableContext>
        ) : (
          props.terminalGroups.map((terminalGroup) => (
            <div key={terminalGroup.id} className="flex shrink-0">
              {renderGroupTab(terminalGroup)}
            </div>
          ))
        )}
      </div>
      <div className="flex shrink-0 items-center">
        <TerminalChromeActions actions={props.actions} variant="workspace" />
      </div>
    </div>
  );
}

export function TerminalSidebar(props: {
  terminalIds: string[];
  terminalGroups: ResolvedTerminalGroupLayout[];
  activeTerminalId: string;
  activeGroupId: string;
  showGroupHeaders: boolean;
  closeShortcutLabel?: string | undefined;
  terminalVisualIdentityById: ReadonlyMap<string, ResolvedTerminalVisualIdentity>;
  actions: ReadonlyArray<TerminalChromeActionItem>;
  onActiveTerminalChange: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
}) {
  return (
    <aside className="flex w-36 min-w-36 flex-col border border-border/70 bg-[var(--color-background-surface)]">
      <div className="flex h-[22px] items-stretch justify-end border-b border-border/70">
        <TerminalChromeActions actions={props.actions} variant="sidebar" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        {props.terminalGroups.map((terminalGroup, groupIndex) => {
          const isGroupActive = terminalGroup.id === props.activeGroupId;
          const groupActiveTerminalId = isGroupActive
            ? props.activeTerminalId
            : terminalGroup.activeTerminalId;
          const groupVisualIdentity = props.terminalVisualIdentityById.get(groupActiveTerminalId);

          return (
            <div key={terminalGroup.id} className="pb-0.5">
              {props.showGroupHeaders && (
                <button
                  type="button"
                  className={`flex w-full items-center px-1 py-0.5 text-[10px] uppercase tracking-[0.08em] ${
                    isGroupActive
                      ? "bg-[var(--sidebar-accent-active)] text-foreground"
                      : "text-muted-foreground hover:bg-[var(--sidebar-accent)] hover:text-foreground"
                  }`}
                  onClick={() => props.onActiveTerminalChange(groupActiveTerminalId)}
                >
                  {groupVisualIdentity?.title ?? `Terminal ${groupIndex + 1}`}
                  {terminalGroup.terminalIds.length > 1
                    ? ` (${terminalGroup.terminalIds.length})`
                    : ""}
                </button>
              )}

              <div
                className={props.showGroupHeaders ? "ml-1 border-l border-border/60 pl-1.5" : ""}
              >
                {terminalGroup.terminalIds.map((terminalId) => {
                  const isActive = terminalId === props.activeTerminalId;
                  const visualIdentity = props.terminalVisualIdentityById.get(terminalId);
                  const closeTerminalLabel = `Close ${
                    visualIdentity?.title ?? "terminal"
                  }${isActive && props.closeShortcutLabel ? ` (${props.closeShortcutLabel})` : ""}`;
                  return (
                    <div
                      key={terminalId}
                      className={`group flex items-center gap-1 px-1 py-0.5 text-[11px] ${
                        isActive
                          ? "bg-[var(--sidebar-accent-active)] text-foreground"
                          : "text-muted-foreground hover:bg-[var(--sidebar-accent)] hover:text-foreground"
                      }`}
                    >
                      {props.showGroupHeaders && (
                        <span className="text-[10px] text-muted-foreground/80">└</span>
                      )}
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-1 text-left"
                        onClick={() => props.onActiveTerminalChange(terminalId)}
                      >
                        <TerminalIdentityIcon
                          className="size-3 shrink-0"
                          iconKey={visualIdentity?.iconKey ?? "terminal"}
                        />
                        {visualIdentity && visualIdentity.state !== "idle" ? (
                          <TerminalActivityIndicator
                            className="text-foreground/70"
                            state={visualIdentity.state}
                          />
                        ) : null}
                        <span className="truncate">{visualIdentity?.title ?? "Terminal"}</span>
                      </button>
                      {props.terminalIds.length > 1 && (
                        <Popover>
                          <PopoverTrigger
                            openOnHover
                            render={
                              <button
                                type="button"
                                className="inline-flex size-3.5 items-center justify-center rounded text-xs font-medium leading-none text-muted-foreground opacity-0 transition hover:bg-[var(--sidebar-accent)] hover:text-foreground group-hover:opacity-100"
                                onClick={() => props.onCloseTerminal(terminalId)}
                                aria-label={closeTerminalLabel}
                              />
                            }
                          >
                            <XIcon className="size-2.5" />
                          </PopoverTrigger>
                          <PopoverPopup
                            tooltipStyle
                            side="bottom"
                            sideOffset={6}
                            align="center"
                            className="pointer-events-none select-none"
                          >
                            {closeTerminalLabel}
                          </PopoverPopup>
                        </Popover>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
