// FILE: TerminalWorkspaceTabs.test.tsx
// Purpose: Guards the per-thread terminal/chat tab visibility rules.
// Layer: Component rendering tests
// Depends on: TerminalWorkspaceTabs and React server rendering.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import TerminalWorkspaceTabs from "./TerminalWorkspaceTabs";

describe("TerminalWorkspaceTabs", () => {
  it("keeps both thread surfaces available before a terminal is opened", () => {
    const markup = renderToStaticMarkup(
      <TerminalWorkspaceTabs
        activeTab="chat"
        isWorking={false}
        terminalCount={0}
        onSelectTab={vi.fn()}
      />,
    );

    expect(markup).toContain("Terminal");
    expect(markup).toContain("Chat");
    expect(markup).toContain('aria-selected="true"');
  });

  it("keeps both thread surfaces available in terminal-only mode", () => {
    const markup = renderToStaticMarkup(
      <TerminalWorkspaceTabs
        activeTab="terminal"
        isWorking={false}
        terminalCount={2}
        onSelectTab={vi.fn()}
      />,
    );

    expect(markup).toContain("Terminal");
    expect(markup).toContain("Chat");
    expect(markup).toContain('role="tablist"');
  });

  it("shows the switcher for a single terminal", () => {
    const markup = renderToStaticMarkup(
      <TerminalWorkspaceTabs
        activeTab="terminal"
        isWorking={false}
        terminalCount={1}
        onSelectTab={vi.fn()}
      />,
    );

    expect(markup).toContain("Terminal");
    expect(markup).toContain("Chat");
  });

  it("uses the shared dot loader while chat is working", () => {
    const markup = renderToStaticMarkup(
      <TerminalWorkspaceTabs
        activeTab="terminal"
        isWorking
        terminalCount={2}
        onSelectTab={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="Chat agent is generating"');
    expect(markup.match(/agent-progress-dot/g)).toHaveLength(8);
  });
});
