// FILE: TerminalViewportPane.tsx
// Purpose: Renders the active terminal pane tree with nested splits and pane-local tab strips.
// Layer: Terminal presentation components
// Depends on: caller-provided viewport renderer so xterm lifecycle can stay external.
//
// Note: pane-tab activate and close buttons are intentionally raw <button>; they
// are tab-strip affordances, not shadcn Buttons. See TerminalChrome.tsx for the
// same rationale.

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

import type { ResolvedTerminalVisualIdentity } from "@t3tools/shared/terminalThreads";

import { IconButton } from "~/components/ui/icon-button";
import {
  Maximize2,
  Minimize2,
  PanelRightCloseIcon,
  Plus,
  SquareSplitHorizontal,
  SquareSplitVertical,
  TerminalSquareIcon,
  Trash2,
} from "~/lib/icons";
import { cn } from "~/lib/utils";

import { DOCK_HEADER_ICON_BUTTON_CLASS, SurfaceTabChip } from "../chat/chatHeaderControls";
import { DraggableTerminalPaneTab, TerminalPaneDropZones } from "./TerminalChrome";
import type {
  ThreadTerminalLayoutNode,
  ThreadTerminalPresentationMode,
  ThreadTerminalSplitNode,
} from "../../types";
import TerminalActivityIndicator from "./TerminalActivityIndicator";
import { TerminalAgentLauncherMenu, type TerminalAgentLaunch } from "./TerminalAgentLauncherMenu";
import TerminalIdentityIcon from "./TerminalIdentityIcon";
// ponytail: importing two runtime control fns (not the xterm object) so a divider
// drag can pause per-frame reflow; avoids threading callbacks through 3 layers.
import { resumeTerminalVisualResize, suspendTerminalVisualResize } from "./terminalRuntime";

const MIN_TERMINAL_PANE_SIZE_PX = 180;

interface TerminalViewportPaneProps {
  groupId: string;
  layout: ThreadTerminalLayoutNode;
  resolvedActiveTerminalId: string;
  terminalVisualIdentityById: ReadonlyMap<string, ResolvedTerminalVisualIdentity>;
  onActiveTerminalChange: (terminalId: string) => void;
  onResizeSplit: (groupId: string, splitId: string, weights: number[]) => void;
  renderViewport: (
    terminalId: string,
    options: { autoFocus: boolean; isVisible: boolean },
  ) => ReactNode;
  onSplitTerminalRight?: ((terminalId: string) => void) | undefined;
  onSplitTerminalDown?: ((terminalId: string) => void) | undefined;
  onNewTerminalTab?: ((terminalId: string) => void) | undefined;
  onLaunchAgentCommand?: ((launch: TerminalAgentLaunch) => void) | undefined;
  onMoveTerminalToGroup?: ((terminalId: string) => void) | undefined;
  onCloseTerminal?: ((terminalId: string) => void) | undefined;
  // Terminal id of the pane tab currently being dragged (from the shared
  // TerminalDndContext). While set, each pane shows drop zones so the tab can
  // be dropped to move or split, cmux-style.
  draggingTerminalId?: string | null | undefined;
  presentationMode: ThreadTerminalPresentationMode;
  onTogglePresentationMode?: (() => void) | undefined;
  onTogglePanel?: (() => void) | undefined;
  isPanelOpen?: boolean | undefined;
  // When the workspace group tab bar is already showing this group's identity
  // (multiple groups exist) and the group holds a single, unsplit terminal, the
  // pane's lone tab chip is a duplicate of the group chip above it. Hide it so the
  // pane header collapses to just its action controls instead of a redundant
  // second tab row. Only affects the single-terminal case; split panes still
  // render their chips so each pane stays identifiable.
  hideSoleTabChip?: boolean | undefined;
}

function normalizeWeights(weights: number[]): number[] {
  return weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 1));
}

function splitHandleClassName(direction: ThreadTerminalSplitNode["direction"]): string {
  // The visible divider is 1px, but a 1px hit target is nearly impossible to grab over
  // the adjacent xterm panes (which capture pointer events). Wrap it in a ~9px transparent
  // grab zone, raised above the panes; the negative margin keeps the layout footprint at 1px
  // so widening the handle never shifts the panes.
  return direction === "horizontal"
    ? "group/handle relative z-10 flex w-[9px] -mx-1 shrink-0 cursor-col-resize items-center justify-center"
    : "group/handle relative z-10 flex h-[9px] -my-1 shrink-0 cursor-row-resize items-center justify-center";
}

function canMoveTerminalToOwnGroup(node: ThreadTerminalLayoutNode, terminalId: string): boolean {
  if (node.type === "terminal") {
    return node.activeTerminalId === terminalId && node.terminalIds.length > 1;
  }

  return node.children.some((child) => {
    if (child.type === "terminal") {
      return child.terminalIds.includes(terminalId);
    }
    return canMoveTerminalToOwnGroup(child, terminalId);
  });
}

function PaneActionButton(props: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <IconButton
      className={DOCK_HEADER_ICON_BUTTON_CLASS}
      onClick={(event) => {
        event.stopPropagation();
        props.onClick();
      }}
      label={props.label}
      tooltip={props.label}
      tooltipSide="bottom"
      size="icon-xs"
      variant="chrome"
    >
      {props.children}
    </IconButton>
  );
}

export default function TerminalViewportPane({
  groupId,
  layout,
  resolvedActiveTerminalId,
  terminalVisualIdentityById,
  onActiveTerminalChange,
  onResizeSplit,
  renderViewport,
  onSplitTerminalRight,
  onSplitTerminalDown,
  onNewTerminalTab,
  onLaunchAgentCommand,
  onMoveTerminalToGroup,
  onCloseTerminal,
  draggingTerminalId = null,
  presentationMode,
  onTogglePresentationMode,
  onTogglePanel,
  isPanelOpen,
  hideSoleTabChip = false,
}: TerminalViewportPaneProps) {
  const renderNode = (node: ThreadTerminalLayoutNode): ReactNode => {
    if (node.type === "terminal") {
      const activePaneTerminalId = node.terminalIds.includes(node.activeTerminalId)
        ? node.activeTerminalId
        : (node.terminalIds[0] ?? resolvedActiveTerminalId);
      const isFocusedPane = activePaneTerminalId === resolvedActiveTerminalId;
      const canMoveActiveTerminalToGroup =
        !!onMoveTerminalToGroup && canMoveTerminalToOwnGroup(layout, activePaneTerminalId);
      const moveActiveTerminalToGroup = () => {
        if (!onMoveTerminalToGroup) return;
        onMoveTerminalToGroup(activePaneTerminalId);
      };
      // Anchor for this pane's drop zones: a terminal already in the pane that
      // is not the dragged one. Without an anchor (the pane holds only the
      // dragged tab) a drop here would be a no-op, so the zones stay hidden.
      const paneDropAnchorTerminalId = !draggingTerminalId
        ? null
        : activePaneTerminalId !== draggingTerminalId
          ? activePaneTerminalId
          : (node.terminalIds.find((terminalId) => terminalId !== draggingTerminalId) ?? null);

      return (
        <div
          key={node.paneId}
          className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--color-background-surface)]"
          onMouseDown={() => {
            if (!isFocusedPane) {
              onActiveTerminalChange(activePaneTerminalId);
            }
          }}
        >
          <div className="flex min-h-9 items-center gap-1 bg-[var(--color-background-surface)] px-1.5 py-1">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {hideSoleTabChip && node.terminalIds.length === 1
                ? null
                : node.terminalIds.map((terminalId) => {
                    const visualIdentity = terminalVisualIdentityById.get(terminalId);
                    const isActiveTab = terminalId === activePaneTerminalId;
                    const tabTitle = visualIdentity?.title ?? "Terminal";
                    const closeTabLabel = `Close ${visualIdentity?.title ?? "terminal"}`;

                    return (
                      <DraggableTerminalPaneTab key={terminalId} terminalId={terminalId}>
                        <SurfaceTabChip
                          active={isActiveTab}
                          className={cn(
                            "rounded-md",
                            isActiveTab && !isFocusedPane && "opacity-70",
                          )}
                          title={tabTitle}
                          label={tabTitle}
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
                          closeLabel={closeTabLabel}
                          onSelect={() => onActiveTerminalChange(terminalId)}
                          onClose={onCloseTerminal ? () => onCloseTerminal(terminalId) : undefined}
                        />
                      </DraggableTerminalPaneTab>
                    );
                  })}

              {onNewTerminalTab ? (
                <PaneActionButton
                  label="New terminal tab"
                  onClick={() => onNewTerminalTab(activePaneTerminalId)}
                >
                  <Plus className="size-3.5" />
                </PaneActionButton>
              ) : null}

              {onLaunchAgentCommand ? (
                <TerminalAgentLauncherMenu onLaunch={onLaunchAgentCommand} />
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
              {canMoveActiveTerminalToGroup ? (
                <PaneActionButton
                  label="Move to its own terminal tab"
                  onClick={moveActiveTerminalToGroup}
                >
                  <TerminalSquareIcon className="size-3.5" />
                </PaneActionButton>
              ) : null}
              {onSplitTerminalRight ? (
                <PaneActionButton
                  label="Split right"
                  onClick={() => onSplitTerminalRight(activePaneTerminalId)}
                >
                  <SquareSplitHorizontal className="size-3.5" />
                </PaneActionButton>
              ) : null}
              {onSplitTerminalDown ? (
                <PaneActionButton
                  label="Split down"
                  onClick={() => onSplitTerminalDown(activePaneTerminalId)}
                >
                  <SquareSplitVertical className="size-3.5" />
                </PaneActionButton>
              ) : null}
              {onTogglePresentationMode ? (
                <PaneActionButton
                  label={
                    presentationMode === "workspace"
                      ? "Collapse terminal into chat drawer"
                      : "Expand terminal into workspace"
                  }
                  onClick={onTogglePresentationMode}
                >
                  {presentationMode === "workspace" ? (
                    <Minimize2 className="size-3.5" />
                  ) : (
                    <Maximize2 className="size-3.5" />
                  )}
                </PaneActionButton>
              ) : null}
              {onTogglePanel ? (
                <PaneActionButton
                  label={isPanelOpen ? "Collapse side panel" : "Open side panel"}
                  onClick={onTogglePanel}
                >
                  <PanelRightCloseIcon />
                </PaneActionButton>
              ) : null}
              {onCloseTerminal ? (
                <PaneActionButton
                  label="Close active terminal tab"
                  onClick={() => onCloseTerminal(activePaneTerminalId)}
                >
                  <Trash2 className="size-3.5" />
                </PaneActionButton>
              ) : null}
            </div>
          </div>

          <div className="relative min-h-0 min-w-0 flex-1 bg-[var(--color-background-surface)]">
            {paneDropAnchorTerminalId ? (
              <TerminalPaneDropZones targetTerminalId={paneDropAnchorTerminalId} />
            ) : null}
            {node.terminalIds.map((terminalId) => {
              const isActiveTab = terminalId === activePaneTerminalId;
              return (
                <div
                  key={terminalId}
                  className={cn(
                    "absolute inset-0 min-h-0 min-w-0 transition-opacity",
                    isActiveTab ? "z-[1] opacity-100" : "pointer-events-none z-0 opacity-0",
                  )}
                >
                  {renderViewport(terminalId, {
                    autoFocus: isFocusedPane && isActiveTab,
                    isVisible: isActiveTab,
                  })}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    const weights = normalizeWeights(node.weights);
    const totalWeight =
      weights.reduce((sum, weight) => sum + weight, 0) || node.children.length || 1;

    const beginResize = (
      splitNode: ThreadTerminalSplitNode,
      handleIndex: number,
      event: ReactPointerEvent<HTMLDivElement>,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      // Measure the actual split container, not the handle's immediate parent: each child
      // is wrapped in a `display:contents` element whose getBoundingClientRect is unreliable
      // (zero/one-pane sized), which would dead-early-return or skew the drag math.
      const container = event.currentTarget.closest<HTMLElement>("[data-terminal-split]");
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const totalSize = splitNode.direction === "horizontal" ? rect.width : rect.height;
      if (totalSize <= 0) return;

      const startCoordinate = splitNode.direction === "horizontal" ? event.clientX : event.clientY;
      const startWeights = normalizeWeights(splitNode.weights);
      const currentWeight = startWeights[handleIndex] ?? 1;
      const nextWeight = startWeights[handleIndex + 1] ?? 1;
      const pairWeight = currentWeight + nextWeight;
      const minWeight = Math.max((pairWeight * MIN_TERMINAL_PANE_SIZE_PX) / totalSize, 0.1);
      let resizeFrame = 0;
      let pendingWeights: number[] | null = null;

      // Pause xterm reflow for the duration of the drag; flex handles the visual
      // resize and we snap each affected pane to its final grid on release.
      suspendTerminalVisualResize();

      const flushResize = () => {
        resizeFrame = 0;
        if (!pendingWeights) return;
        const nextWeights = pendingWeights;
        pendingWeights = null;
        onResizeSplit(groupId, splitNode.id, nextWeights);
      };

      const onPointerMove = (moveEvent: PointerEvent) => {
        const currentCoordinate =
          splitNode.direction === "horizontal" ? moveEvent.clientX : moveEvent.clientY;
        const delta = currentCoordinate - startCoordinate;
        const deltaWeight = (delta / totalSize) * totalWeight;
        const resizedCurrent = Math.min(
          Math.max(currentWeight + deltaWeight, minWeight),
          pairWeight - minWeight,
        );
        const resizedNext = pairWeight - resizedCurrent;
        const nextWeights = [...startWeights];
        nextWeights[handleIndex] = resizedCurrent;
        nextWeights[handleIndex + 1] = resizedNext;
        pendingWeights = nextWeights;
        if (resizeFrame === 0) {
          resizeFrame = window.requestAnimationFrame(flushResize);
        }
      };

      const onPointerUp = () => {
        if (resizeFrame !== 0) {
          window.cancelAnimationFrame(resizeFrame);
          resizeFrame = 0;
        }
        if (pendingWeights) {
          onResizeSplit(groupId, splitNode.id, pendingWeights);
          pendingWeights = null;
        }
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
        // Commit weights first, then reflow once to the final pane size.
        resumeTerminalVisualResize();
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp, { once: true });
      // pointercancel guards against a stuck suspend if the gesture is interrupted.
      window.addEventListener("pointercancel", onPointerUp, { once: true });
    };

    return (
      <div
        key={node.id}
        data-terminal-split={node.id}
        className={cn(
          "flex h-full min-h-0 min-w-0 gap-0 overflow-hidden bg-[var(--color-background-surface)]",
          node.direction === "horizontal" ? "flex-row" : "flex-col",
        )}
      >
        {node.children.map((child, index) => {
          const childWeight = weights[index] ?? 1;
          return (
            <div key={child.type === "split" ? child.id : child.paneId} className="contents">
              <div
                className="h-full min-h-0 min-w-0"
                style={{
                  flexGrow: childWeight,
                  flexBasis: 0,
                }}
              >
                {renderNode(child)}
              </div>
              {index < node.children.length - 1 ? (
                <div
                  className={splitHandleClassName(node.direction)}
                  onPointerDown={(event) => beginResize(node, index, event)}
                  onDoubleClick={() =>
                    onResizeSplit(
                      groupId,
                      node.id,
                      node.children.map(() => 1),
                    )
                  }
                >
                  <div
                    className={cn(
                      "bg-border/70 group-hover/handle:bg-[var(--sidebar-accent)]",
                      node.direction === "horizontal" ? "h-full w-px" : "h-px w-full",
                    )}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="h-full min-h-0 min-w-0 overflow-hidden bg-[var(--color-background-surface)]">
      {renderNode(layout)}
    </div>
  );
}
