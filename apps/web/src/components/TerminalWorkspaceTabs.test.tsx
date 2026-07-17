// FILE: TerminalWorkspaceTabs.test.tsx
// Purpose: Guards the per-thread terminal/chat tab visibility rules.
// Layer: Component rendering tests
// Depends on: TerminalWorkspaceTabs and React server rendering.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ThreadId } from "@t3tools/contracts";

import TerminalWorkspaceTabs from "./TerminalWorkspaceTabs";

describe("TerminalWorkspaceTabs", () => {
  it("renders multiple chat tabs and an accessible add control", () => {
    const chatOne = ThreadId.makeUnsafe("chat-one");
    const chatTwo = ThreadId.makeUnsafe("chat-two");
    const markup = renderToStaticMarkup(
      <TerminalWorkspaceTabs
        activeTab="chat"
        activeChatTabId={chatTwo}
        chatTabs={[
          { id: chatOne, label: "Chat", title: "Main task", isWorking: false, canClose: true },
          { id: chatTwo, label: "Chat 2", title: "Alternative", isWorking: true, canClose: true },
        ]}
        isWorking={false}
        terminalCount={1}
        onAddChatTab={vi.fn()}
        onAddTerminalTab={vi.fn()}
        onCloseChatTab={vi.fn()}
        onSelectChatTab={vi.fn()}
        onSelectTab={vi.fn()}
      />,
    );

    expect(markup).toContain("Chat 2");
    expect(markup).toContain('aria-label="Add workspace tab"');
    expect(markup).toContain('aria-label="Close Chat 2"');
    expect(markup).toContain('aria-label="Close Chat"');
    expect(markup).toContain('aria-label="Chat 2 agent is generating"');
  });

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
