// Purpose: Guards split terminal pane chrome against redundant generic actions.
// Layer: Terminal component rendering test

import type { ResolvedTerminalVisualIdentity } from "@t3tools/shared/terminalThreads";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ThreadTerminalLayoutNode } from "../../types";
import TerminalIdentityIcon from "./TerminalIdentityIcon";

if (globalThis.self === undefined) {
  Object.assign(globalThis, { self: globalThis });
}

const { default: TerminalViewportPane } = await import("./TerminalViewportPane");

describe("TerminalViewportPane split actions", () => {
  it("omits the redundant terminal-square action and preserves agent identity icons", () => {
    const layout: ThreadTerminalLayoutNode = {
      type: "split",
      id: "split-1",
      direction: "horizontal",
      weights: [1, 1],
      children: [
        {
          type: "terminal",
          paneId: "pane-claude",
          terminalIds: ["terminal-claude"],
          activeTerminalId: "terminal-claude",
        },
        {
          type: "terminal",
          paneId: "pane-shell",
          terminalIds: ["terminal-shell"],
          activeTerminalId: "terminal-shell",
        },
      ],
    };
    const terminalVisualIdentityById = new Map<string, ResolvedTerminalVisualIdentity>([
      [
        "terminal-claude",
        {
          agentKind: "claude",
          cliKind: "claude",
          iconKey: "claude",
          state: "idle",
          title: "Claude 1",
        },
      ],
      [
        "terminal-shell",
        {
          agentKind: null,
          cliKind: null,
          iconKey: "terminal",
          state: "idle",
          title: "Terminal 1",
        },
      ],
    ]);
    // A stale caller supplying the removed callback must not bring the old button back.
    const legacyMoveActionProp = { onMoveTerminalToGroup: vi.fn() };

    const markup = renderToStaticMarkup(
      <TerminalViewportPane
        {...legacyMoveActionProp}
        groupId="group-1"
        layout={layout}
        resolvedActiveTerminalId="terminal-shell"
        terminalVisualIdentityById={terminalVisualIdentityById}
        onActiveTerminalChange={vi.fn()}
        onResizeSplit={vi.fn()}
        onSplitTerminalRight={vi.fn()}
        onSplitTerminalDown={vi.fn()}
        onCloseTerminal={vi.fn()}
        presentationMode="workspace"
        renderViewport={(terminalId) => <div data-terminal-id={terminalId} />}
      />,
    );

    expect(markup).not.toContain("Move to its own terminal tab");
    expect(markup.match(/aria-label="Split right"/g)).toHaveLength(2);
    expect(markup.match(/aria-label="Split down"/g)).toHaveLength(2);
    expect(markup).toContain(
      renderToStaticMarkup(<TerminalIdentityIcon iconKey="claude" className="size-3.5" />),
    );
    expect(markup).not.toContain(
      renderToStaticMarkup(<TerminalIdentityIcon iconKey="terminal" className="size-3.5" />),
    );
    // Hiding the generic terminal glyph must not take the close affordance with it:
    // a plain shell tab (no agent identity yet) still needs its hover close button.
    expect(markup).toContain('aria-label="Close Terminal 1"');
    expect(markup).toContain('aria-label="Close Claude 1"');
  });
});
