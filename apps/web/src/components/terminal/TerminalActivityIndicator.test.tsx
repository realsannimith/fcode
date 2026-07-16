// FILE: TerminalActivityIndicator.test.tsx
// Purpose: Guards the terminal-agent generating indicator and idle behavior.
// Layer: Component rendering tests

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import TerminalActivityIndicator from "./TerminalActivityIndicator";

describe("TerminalActivityIndicator", () => {
  it("uses the shared progress ring while a terminal agent is generating", () => {
    const markup = renderToStaticMarkup(<TerminalActivityIndicator state="running" />);

    expect(markup).toContain('aria-label="Terminal agent is generating"');
    expect(markup).toContain("motion-safe:animate-spin");
    expect(markup).not.toContain("animate-ping");
  });

  it("renders no status while the terminal agent is idle", () => {
    expect(renderToStaticMarkup(<TerminalActivityIndicator state="idle" />)).toBe("");
  });
});
