// FILE: TerminalWorkspaceTabs.test.tsx
// Purpose: Guards the workspace-level terminal/chat tab visibility rules.
// Layer: Component rendering tests
// Depends on: TerminalWorkspaceTabs and React server rendering.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import TerminalWorkspaceTabs from "./TerminalWorkspaceTabs";

describe("TerminalWorkspaceTabs", () => {
  it("hides the workspace switcher in terminal-only mode", () => {
    const markup = renderToStaticMarkup(
      <TerminalWorkspaceTabs
        activeTab="terminal"
        isWorking={false}
        terminalCount={2}
        workspaceLayout="terminal-only"
        onSelectTab={vi.fn()}
      />,
    );

    expect(markup).toBe("");
  });

  it("shows the chat switcher when the workspace still includes chat", () => {
    const markup = renderToStaticMarkup(
      <TerminalWorkspaceTabs
        activeTab="terminal"
        isWorking={false}
        terminalCount={2}
        workspaceLayout="both"
        onSelectTab={vi.fn()}
      />,
    );

    expect(markup).toContain("Terminal");
    expect(markup).toContain("Chat");
  });

  it("uses the shared generating ring while chat is working", () => {
    const markup = renderToStaticMarkup(
      <TerminalWorkspaceTabs
        activeTab="terminal"
        isWorking
        terminalCount={2}
        workspaceLayout="both"
        onSelectTab={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="Chat agent is generating"');
    expect(markup.match(/agent-progress-dot/g)).toHaveLength(10);
  });
});
