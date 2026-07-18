// Purpose: Verifies the sidebar terminal-agent stack applies its deterministic layout.
// Layer: Sidebar component test

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SidebarTerminalIconStack } from "./SidebarTerminalIconStack";

describe("SidebarTerminalIconStack", () => {
  it("renders distinct agent icons in explicitly layered positions", () => {
    const markup = renderToStaticMarkup(
      <SidebarTerminalIconStack iconKeys={["openai", "claude", "kiro"]} terminalCount={3} />,
    );

    expect(markup).toContain('aria-label="3 detected agents across 3 terminals"');
    expect(markup).toContain('style="width:28px"');
    expect(markup).toContain('style="left:0px;z-index:1"');
    expect(markup).toContain('style="left:8px;z-index:2"');
    expect(markup).toContain('style="left:16px;z-index:3"');
  });

  it("caps the stack and renders the remaining count as the top chip", () => {
    const markup = renderToStaticMarkup(
      <SidebarTerminalIconStack
        iconKeys={["openai", "claude", "kiro", "cursor", "agent"]}
        terminalCount={5}
      />,
    );

    expect(markup).toContain('style="width:36px"');
    expect(markup).toContain('data-sidebar-terminal-icon-chip="overflow"');
    expect(markup).toContain('style="left:24px;z-index:4"');
    expect(markup).toContain(">+2</span>");
  });
});
