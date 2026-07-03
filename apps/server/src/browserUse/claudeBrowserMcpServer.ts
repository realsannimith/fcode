// FILE: claudeBrowserMcpServer.ts
// Purpose: Exposes the FCode in-app browser to Claude sessions as an in-process SDK MCP
//   server, mirroring the browser-use capability Codex gets over the native pipe.
// Layer: Server browser-use bridge
// Depends on: Claude Agent SDK MCP helpers and the browser-use pipe client/session

import {
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readBrowserUsePipePathFromEnv } from "@t3tools/shared/browserUsePipe";
import { z } from "zod";

import { BrowserUsePipeUnavailableError } from "./browserUsePipeClient.ts";
import { BROWSER_USE_PAGE_TEXT_DEFAULT_LIMIT, BrowserUseSession } from "./browserUseSession.ts";
import { getSharedBrowserUseClient } from "./browserUseSessionRegistry.ts";

export const FCODE_BROWSER_MCP_SERVER_NAME = "fcode-browser";

const BROWSER_WAIT_MAX_SECONDS = 10;

const BROWSER_MCP_INSTRUCTIONS = [
  "These tools drive FCode's built-in in-app browser panel, rendered natively inside the app the user is looking at.",
  "Prefer them over external browsers or curl for interactive web tasks: the user watches the page live in the panel.",
  "Typical flow: browser_navigate -> browser_page_state -> browser_click_element / browser_input_text by [index] -> repeat.",
  "Re-fetch browser_page_state after actions that change the page; element indices go stale.",
  "Use browser_screenshot for visual verification (coordinates are CSS pixels, matching browser_click), and browser_read_console when debugging a dev server.",
].join(" ");

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(error: unknown): CallToolResult {
  const message =
    error instanceof BrowserUsePipeUnavailableError
      ? "The in-app browser is only available while the FCode desktop app is running."
      : error instanceof Error
        ? error.message
        : String(error);
  return { content: [{ type: "text", text: message }], isError: true };
}

function run(handler: () => Promise<CallToolResult>): Promise<CallToolResult> {
  return handler().catch((error: unknown) => errorResult(error));
}

function describePage(info: { url: string; title: string; readyState?: string }): string {
  const title = info.title.trim().length > 0 ? info.title : "(untitled)";
  const readyState = info.readyState && info.readyState !== "complete" ? " (still loading)" : "";
  return `${title} — ${info.url}${readyState}`;
}

export function isBrowserUseAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return readBrowserUsePipePathFromEnv(env) !== null;
}

// Returns null outside the desktop app (no pipe configured), which keeps
// web-only server deployments free of dead browser tools.
export function maybeCreateClaudeBrowserMcpServer(input: {
  sessionId: string;
  env?: NodeJS.ProcessEnv;
}): McpSdkServerConfigWithInstance | null {
  const pipePath = readBrowserUsePipePathFromEnv(input.env ?? process.env);
  if (!pipePath) {
    return null;
  }
  const session = new BrowserUseSession(getSharedBrowserUseClient(pipePath), input.sessionId);
  return createClaudeBrowserMcpServer(session);
}

export function createClaudeBrowserMcpServer(
  session: BrowserUseSession,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: FCODE_BROWSER_MCP_SERVER_NAME,
    version: "1.0.0",
    instructions: BROWSER_MCP_INSTRUCTIONS,
    tools: [
      tool(
        "browser_navigate",
        "Open a URL in the FCode in-app browser panel and wait for the page to load.",
        { url: z.string().describe("Absolute URL to open, e.g. https://example.com") },
        async (args) =>
          run(async () => {
            const info = await session.navigate(args.url);
            return textResult(`Opened ${describePage(info)}`);
          }),
      ),
      tool(
        "browser_screenshot",
        "Capture a screenshot of the visible in-app browser viewport. Coordinates in the image are CSS pixels that browser_click and browser_scroll accept directly.",
        {},
        async () =>
          run(async () => {
            const shot = await session.screenshot();
            return {
              content: [
                { type: "image", data: shot.base64Png, mimeType: "image/png" },
                {
                  type: "text",
                  text: `Viewport screenshot (${shot.width}x${shot.height} CSS px).`,
                },
              ],
            };
          }),
      ),
      tool(
        "browser_click",
        "Click at viewport coordinates in the in-app browser (CSS pixels, matching the latest browser_screenshot).",
        {
          x: z.number().describe("X coordinate in CSS pixels from the viewport's left edge"),
          y: z.number().describe("Y coordinate in CSS pixels from the viewport's top edge"),
          button: z
            .enum(["left", "middle", "right"])
            .optional()
            .describe("Mouse button (default left)"),
          click_count: z
            .number()
            .int()
            .min(1)
            .max(3)
            .optional()
            .describe("1=single, 2=double click"),
        },
        async (args) =>
          run(async () => {
            await session.click({
              x: args.x,
              y: args.y,
              ...(args.button ? { button: args.button } : {}),
              ...(args.click_count ? { clickCount: args.click_count } : {}),
            });
            return textResult(`Clicked at (${args.x}, ${args.y}).`);
          }),
      ),
      tool(
        "browser_type",
        "Type text into the currently focused element of the in-app browser (click an input first to focus it).",
        { text: z.string().describe("Text to insert at the current focus") },
        async (args) =>
          run(async () => {
            await session.typeText(args.text);
            return textResult(`Typed ${args.text.length} characters.`);
          }),
      ),
      tool(
        "browser_press_key",
        "Press a keyboard key in the in-app browser, e.g. Enter to submit a form.",
        {
          key: z
            .string()
            .describe(
              "Key name (Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right, Home, End, PageUp, PageDown) or a single character",
            ),
          modifiers: z
            .array(z.enum(["alt", "ctrl", "meta", "shift"]))
            .optional()
            .describe("Held modifier keys"),
        },
        async (args) =>
          run(async () => {
            await session.pressKey(args.key, args.modifiers ?? []);
            return textResult(`Pressed ${args.key}.`);
          }),
      ),
      tool(
        "browser_scroll",
        "Scroll the in-app browser page by a pixel delta (positive delta_y scrolls down).",
        {
          delta_y: z.number().describe("Vertical scroll amount in pixels; positive scrolls down"),
          delta_x: z.number().optional().describe("Horizontal scroll amount in pixels"),
          x: z
            .number()
            .optional()
            .describe("Cursor X for the scroll (defaults to viewport center)"),
          y: z
            .number()
            .optional()
            .describe("Cursor Y for the scroll (defaults to viewport center)"),
        },
        async (args) =>
          run(async () => {
            await session.scroll({
              deltaY: args.delta_y,
              ...(args.delta_x !== undefined ? { deltaX: args.delta_x } : {}),
              ...(args.x !== undefined ? { x: args.x } : {}),
              ...(args.y !== undefined ? { y: args.y } : {}),
            });
            return textResult(`Scrolled by (${args.delta_x ?? 0}, ${args.delta_y}).`);
          }),
      ),
      tool(
        "browser_read_page",
        "Read the visible text content of the current in-app browser page (faster and cheaper than a screenshot for text-heavy pages).",
        {
          max_chars: z
            .number()
            .int()
            .min(100)
            .max(60_000)
            .optional()
            .describe(
              `Maximum characters to return (default ${BROWSER_USE_PAGE_TEXT_DEFAULT_LIMIT})`,
            ),
        },
        async (args) =>
          run(async () => {
            const page = await session.readPage(args.max_chars);
            const header = describePage(page);
            const truncatedNote = page.truncated
              ? "\n\n[Text truncated — raise max_chars or use browser_evaluate for targeted extraction.]"
              : "";
            return textResult(`${header}\n\n${page.text}${truncatedNote}`);
          }),
      ),
      tool(
        "browser_evaluate",
        "Evaluate a JavaScript expression in the in-app browser page and return its JSON-serialized result.",
        {
          expression: z
            .string()
            .describe("JavaScript expression evaluated in the page; promises are awaited"),
        },
        async (args) => run(async () => textResult(await session.evaluate(args.expression))),
      ),
      tool(
        "browser_page_state",
        "Get the current page as an indexed map of interactive elements (e.g. `[4]<a role=button>Sign in />`). Use the [index] numbers with browser_click_element / browser_input_text / browser_select_option. Prefer this over screenshots for element interaction.",
        {},
        async () =>
          run(async () => {
            const state = await session.getPageState();
            return textResult(`${state.header}\n${state.content}\n${state.footer}`);
          }),
      ),
      tool(
        "browser_click_element",
        "Click an interactive element by its [index] from browser_page_state. Re-fetch browser_page_state after the page changes — indices go stale.",
        { index: z.number().int().min(0).describe("Element index from browser_page_state") },
        async (args) => run(async () => textResult(await session.clickElementByIndex(args.index))),
      ),
      tool(
        "browser_input_text",
        "Type text into an input/textarea element by its [index] from browser_page_state (focuses the field and replaces its content).",
        {
          index: z.number().int().min(0).describe("Element index from browser_page_state"),
          text: z.string().describe("Text to enter into the field"),
        },
        async (args) =>
          run(async () => textResult(await session.inputTextByIndex(args.index, args.text))),
      ),
      tool(
        "browser_select_option",
        "Select a dropdown option by the select element's [index] from browser_page_state and the visible option text.",
        {
          index: z.number().int().min(0).describe("Select element index from browser_page_state"),
          option_text: z.string().describe("Visible text of the option to select"),
        },
        async (args) =>
          run(async () =>
            textResult(await session.selectOptionByIndex(args.index, args.option_text)),
          ),
      ),
      tool(
        "browser_read_console",
        "Read console output (logs, warnings, errors, uncaught exceptions) from the current in-app browser page since the last read (capture starts when the page runtime is installed, e.g. right after browser_navigate). Ideal for debugging a local dev server preview.",
        {},
        async () =>
          run(async () => {
            const entries = await session.readConsole();
            if (entries.length === 0) {
              return textResult("No console output since the last read.");
            }
            return textResult(entries.map((entry) => `[${entry.level}] ${entry.text}`).join("\n"));
          }),
      ),
      tool("browser_tabs", "List open tabs in the in-app browser panel.", {}, async () =>
        run(async () => {
          const tabs = await session.listTabs();
          if (tabs.length === 0) {
            return textResult(
              "No browser tabs are open. browser_navigate or browser_new_tab will open the panel.",
            );
          }
          const lines = tabs.map(
            (tab) => `${tab.active ? "* " : "  "}[${tab.id}] ${tab.title} — ${tab.url}`,
          );
          return textResult(lines.join("\n"));
        }),
      ),
      tool(
        "browser_new_tab",
        "Open a new tab in the in-app browser panel and switch this session to it.",
        { url: z.string().optional().describe("URL to open in the new tab") },
        async (args) =>
          run(async () => {
            const created = await session.newTab();
            if (args.url) {
              const info = await session.navigate(args.url);
              return textResult(`Opened new tab [${created.id}]: ${describePage(info)}`);
            }
            return textResult(`Opened new tab [${created.id}].`);
          }),
      ),
      tool(
        "browser_select_tab",
        "Switch this session to another open tab (see browser_tabs for ids).",
        { tab_id: z.number().int().describe("Tab id from browser_tabs") },
        async (args) =>
          run(async () => {
            await session.selectTab(args.tab_id);
            return textResult(`Selected tab [${args.tab_id}].`);
          }),
      ),
      tool("browser_go_back", "Navigate back in the in-app browser tab's history.", {}, async () =>
        run(async () => {
          const info = await session.goHistory("back");
          return textResult(`Went back to ${describePage(info)}`);
        }),
      ),
      tool(
        "browser_go_forward",
        "Navigate forward in the in-app browser tab's history.",
        {},
        async () =>
          run(async () => {
            const info = await session.goHistory("forward");
            return textResult(`Went forward to ${describePage(info)}`);
          }),
      ),
      tool(
        "browser_wait",
        "Wait for the page to settle (e.g. after clicking a button that triggers loading).",
        {
          seconds: z
            .number()
            .min(0.1)
            .max(BROWSER_WAIT_MAX_SECONDS)
            .describe(`Seconds to wait (max ${BROWSER_WAIT_MAX_SECONDS})`),
        },
        async (args) =>
          run(async () => {
            await new Promise((resolve) => setTimeout(resolve, args.seconds * 1_000));
            return textResult(`Waited ${args.seconds}s.`);
          }),
      ),
    ],
  });
}
