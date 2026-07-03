// FILE: browserUseSession.ts
// Purpose: High-level browser automation operations (navigate, screenshot, click, type, read)
//   for one provider session, built on the browser-use pipe's executeCdp primitive.
// Layer: Server browser-use bridge
// Depends on: BrowserUsePipeClient

import type { BrowserUsePipeClient } from "./browserUsePipeClient.ts";
import {
  FCODE_PAGE_CONTROLLER_INJECTION_SOURCE,
  FCODE_PAGE_CONTROLLER_INJECTION_VERSION,
} from "./pageControllerInjection.gen.ts";

const BROWSER_USE_NAVIGATE_READY_TIMEOUT_MS = 12_000;
const BROWSER_USE_NAVIGATE_READY_POLL_MS = 250;
const BROWSER_USE_PAGE_TEXT_HARD_LIMIT = 60_000;
export const BROWSER_USE_PAGE_TEXT_DEFAULT_LIMIT = 20_000;

interface BrowserUsePipeTab {
  id: number;
  title: string;
  active: boolean;
  url: string;
}

export interface BrowserUseScreenshot {
  base64Png: string;
  width: number;
  height: number;
}

export interface BrowserUsePageContent {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
}

export interface BrowserUsePageInfo {
  url: string;
  title: string;
  readyState: string;
}

export interface BrowserUseConsoleEntry {
  level: string;
  text: string;
}

// Indexed page snapshot from the injected page-controller runtime: `content`
// lists interactive elements as `[index]<tag attrs>text />` lines whose indices
// feed the click/input/select-by-index actions.
export interface BrowserUsePageState {
  url: string;
  title: string;
  header: string;
  content: string;
  footer: string;
}

// Named keys the press-key tool accepts, mapped onto CDP key event fields.
const KEY_DEFINITIONS: Record<
  string,
  { key: string; code: string; windowsVirtualKeyCode: number; text?: string }
> = {
  enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
  home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
  end: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 },
};

const KEY_MODIFIER_BITS: Record<string, number> = {
  alt: 1,
  ctrl: 2,
  control: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  shift: 8,
};

export function resolveKeyModifiers(modifiers: readonly string[]): number {
  let mask = 0;
  for (const modifier of modifiers) {
    const bit = KEY_MODIFIER_BITS[modifier.toLowerCase()];
    if (bit === undefined) {
      throw new Error(`Unknown key modifier: ${modifier}`);
    }
    mask |= bit;
  }
  return mask;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function isStaleTabError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /Unknown tab|No browser tab selected/i.test(error.message);
}

// One session per provider thread. The pipe server keys tab selection by
// session_id, so every FCode thread drives its own tab without clobbering
// concurrent Codex sessions on the same pipe.
export class BrowserUseSession {
  private attachedTabId: number | null = null;
  private registeredNewDocumentRuntime = false;

  constructor(
    private readonly client: BrowserUsePipeClient,
    private readonly sessionId: string,
  ) {}

  async listTabs(): Promise<BrowserUsePipeTab[]> {
    const result = await this.client.request("getTabs", { session_id: this.sessionId });
    return Array.isArray(result) ? (result as BrowserUsePipeTab[]) : [];
  }

  async selectTab(tabId: number): Promise<void> {
    await this.client.request("attach", { session_id: this.sessionId, tabId });
    if (this.attachedTabId !== tabId) {
      // The new-document injection is registered per tab (webContents), so a
      // freshly adopted tab needs its own registration.
      this.registeredNewDocumentRuntime = false;
    }
    this.attachedTabId = tabId;
  }

  async newTab(): Promise<BrowserUsePipeTab> {
    const created = (await this.client.request("createTab", {
      session_id: this.sessionId,
    })) as BrowserUsePipeTab;
    await this.selectTab(created.id);
    return created;
  }

  // Reuses the session's tab when it is still alive, otherwise adopts the
  // active panel tab, and only creates a fresh tab when the panel has none.
  private async ensureAttachedTab(): Promise<void> {
    const tabs = await this.listTabs();
    if (this.attachedTabId !== null && tabs.some((tab) => tab.id === this.attachedTabId)) {
      return;
    }
    const target = tabs.find((tab) => tab.active) ?? tabs[0];
    if (target) {
      await this.selectTab(target.id);
      return;
    }
    await this.newTab();
  }

  private async cdp(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const send = () =>
      this.client.request("executeCdp", {
        session_id: this.sessionId,
        method,
        ...(params ? { commandParams: params } : {}),
      });

    if (this.attachedTabId === null) {
      await this.ensureAttachedTab();
      return send();
    }

    try {
      return await send();
    } catch (error) {
      // The user may have closed the tab this session was driving; adopt a
      // live tab and retry once before surfacing the failure to the agent.
      if (!isStaleTabError(error)) {
        throw error;
      }
      this.attachedTabId = null;
      this.registeredNewDocumentRuntime = false;
      await this.ensureAttachedTab();
      return send();
    }
  }

  private async evaluateJson<T>(expression: string): Promise<T> {
    const result = asObject(
      await this.cdp("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      }),
    );
    const exceptionDetails = asObject(result.exceptionDetails);
    if (Object.keys(exceptionDetails).length > 0) {
      const exception = asObject(exceptionDetails.exception);
      const description =
        (typeof exception.description === "string" && exception.description) ||
        (typeof exceptionDetails.text === "string" && exceptionDetails.text) ||
        "JavaScript evaluation failed.";
      throw new Error(description);
    }
    return asObject(result.result).value as T;
  }

  async getPageInfo(): Promise<BrowserUsePageInfo> {
    return this.evaluateJson<BrowserUsePageInfo>(
      "({ url: location.href, title: document.title, readyState: document.readyState })",
    );
  }

  async navigate(url: string): Promise<BrowserUsePageInfo> {
    // The panel host can move threads between turns (the user switched chats,
    // so the old workspace is off-screen). Navigations are the moments the
    // user should see, so re-validate against the current host's tab list and
    // adopt its tab when ours no longer belongs to it.
    await this.ensureAttachedTab();
    const result = asObject(await this.cdp("Page.navigate", { url }));
    if (typeof result.errorText === "string" && result.errorText.length > 0) {
      throw new Error(`Navigation to ${url} failed: ${result.errorText}`);
    }
    const info = await this.waitForReady();
    // Install the page runtime right after load so console output and page
    // errors are captured from here on, not only once another tool runs.
    await this.ensurePageRuntime().catch(() => undefined);
    return info;
  }

  // Best-effort readiness: returns early on `complete`, otherwise reports the
  // last observed state instead of failing, so slow pages stay inspectable.
  private async waitForReady(): Promise<BrowserUsePageInfo> {
    const deadline = Date.now() + BROWSER_USE_NAVIGATE_READY_TIMEOUT_MS;
    let lastInfo: BrowserUsePageInfo | null = null;
    while (Date.now() < deadline) {
      try {
        lastInfo = await this.getPageInfo();
        if (lastInfo.readyState === "complete") {
          return lastInfo;
        }
      } catch {
        // Evaluation races the navigation while the old document tears down.
      }
      await new Promise((resolve) => setTimeout(resolve, BROWSER_USE_NAVIGATE_READY_POLL_MS));
    }
    return lastInfo ?? this.getPageInfo();
  }

  async goHistory(direction: "back" | "forward"): Promise<BrowserUsePageInfo> {
    const history = asObject(await this.cdp("Page.getNavigationHistory"));
    const entries = Array.isArray(history.entries) ? history.entries : [];
    const currentIndex = typeof history.currentIndex === "number" ? history.currentIndex : 0;
    const targetIndex = direction === "back" ? currentIndex - 1 : currentIndex + 1;
    const target = asObject(entries[targetIndex]);
    if (typeof target.id !== "number") {
      throw new Error(`No ${direction} history entry to navigate to.`);
    }
    await this.cdp("Page.navigateToHistoryEntry", { entryId: target.id });
    return this.waitForReady();
  }

  // Captures the visible viewport at CSS-pixel scale so screenshot coordinates
  // map 1:1 onto Input.dispatchMouseEvent coordinates, independent of the
  // display's device pixel ratio.
  async screenshot(): Promise<BrowserUseScreenshot> {
    const metrics = asObject(await this.cdp("Page.getLayoutMetrics"));
    const viewport = asObject(metrics.cssVisualViewport);
    const width = Math.floor(typeof viewport.clientWidth === "number" ? viewport.clientWidth : 0);
    const height = Math.floor(
      typeof viewport.clientHeight === "number" ? viewport.clientHeight : 0,
    );
    const capture = asObject(
      await this.cdp("Page.captureScreenshot", {
        format: "png",
        ...(width > 0 && height > 0
          ? {
              clip: {
                x: typeof viewport.pageX === "number" ? viewport.pageX : 0,
                y: typeof viewport.pageY === "number" ? viewport.pageY : 0,
                width,
                height,
                scale: 1,
              },
            }
          : {}),
      }),
    );
    if (typeof capture.data !== "string" || capture.data.length === 0) {
      throw new Error("Couldn't capture a browser screenshot.");
    }
    return { base64Png: capture.data, width, height };
  }

  async click(input: {
    x: number;
    y: number;
    button?: "left" | "middle" | "right";
    clickCount?: number;
  }): Promise<void> {
    const button = input.button ?? "left";
    const clickCount = input.clickCount ?? 1;
    // Show the on-brand agent cursor at the click point before dispatching so
    // the user can see where automation is acting.
    await this.showCursor(input.x, input.y, true);
    const base = { x: input.x, y: input.y, button, pointerType: "mouse" };
    await this.cdp("Input.dispatchMouseEvent", { ...base, type: "mouseMoved", button: "none" });
    await this.cdp("Input.dispatchMouseEvent", { ...base, type: "mousePressed", clickCount });
    await this.cdp("Input.dispatchMouseEvent", { ...base, type: "mouseReleased", clickCount });
  }

  // Best-effort: the injected runtime renders a decorative cursor overlay.
  private async showCursor(x: number, y: number, click: boolean): Promise<void> {
    await this.ensurePageRuntime().catch(() => undefined);
    await this.cdp("Runtime.evaluate", {
      expression: `window.__fcodeBrowserUse && window.__fcodeBrowserUse.showCursor(${x}, ${y}, ${click ? "true" : "false"})`,
    }).catch(() => undefined);
  }

  async typeText(text: string): Promise<void> {
    await this.cdp("Input.insertText", { text });
  }

  async pressKey(keyName: string, modifiers: readonly string[] = []): Promise<void> {
    const definition = KEY_DEFINITIONS[keyName.toLowerCase()];
    if (!definition) {
      if ([...keyName].length === 1) {
        await this.typeText(keyName);
        return;
      }
      throw new Error(
        `Unknown key: ${keyName}. Supported keys: ${Object.keys(KEY_DEFINITIONS).join(", ")}.`,
      );
    }
    const modifierMask = resolveKeyModifiers(modifiers);
    const common = {
      key: definition.key,
      code: definition.code,
      windowsVirtualKeyCode: definition.windowsVirtualKeyCode,
      nativeVirtualKeyCode: definition.windowsVirtualKeyCode,
      ...(modifierMask ? { modifiers: modifierMask } : {}),
    };
    await this.cdp("Input.dispatchKeyEvent", {
      ...common,
      type: definition.text ? "keyDown" : "rawKeyDown",
      ...(definition.text ? { text: definition.text } : {}),
    });
    await this.cdp("Input.dispatchKeyEvent", { ...common, type: "keyUp" });
  }

  async scroll(input: { x?: number; y?: number; deltaX?: number; deltaY?: number }): Promise<void> {
    let { x, y } = input;
    if (x === undefined || y === undefined) {
      const metrics = asObject(await this.cdp("Page.getLayoutMetrics"));
      const viewport = asObject(metrics.cssVisualViewport);
      const width = typeof viewport.clientWidth === "number" ? viewport.clientWidth : 0;
      const height = typeof viewport.clientHeight === "number" ? viewport.clientHeight : 0;
      x ??= Math.floor(width / 2);
      y ??= Math.floor(height / 2);
    }
    await this.cdp("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      deltaX: input.deltaX ?? 0,
      deltaY: input.deltaY ?? 0,
      pointerType: "mouse",
    });
  }

  async readPage(maxChars = BROWSER_USE_PAGE_TEXT_DEFAULT_LIMIT): Promise<BrowserUsePageContent> {
    const limit = Math.max(1, Math.min(maxChars, BROWSER_USE_PAGE_TEXT_HARD_LIMIT));
    const content = await this.evaluateJson<{ url: string; title: string; text: string }>(
      `(() => {
        const text = document.body ? document.body.innerText : "";
        return {
          url: location.href,
          title: document.title,
          text: text.slice(0, ${limit + 1}),
        };
      })()`,
    );
    const truncated = content.text.length > limit;
    return {
      url: content.url,
      title: content.title,
      text: truncated ? content.text.slice(0, limit) : content.text,
      truncated,
    };
  }

  async evaluate(expression: string): Promise<string> {
    const value = await this.evaluateJson<unknown>(expression);
    if (value === undefined) {
      return "undefined";
    }
    try {
      return JSON.stringify(value, null, 2) ?? "undefined";
    } catch {
      return String(value);
    }
  }

  // Injects the vendored page-controller runtime (idempotent per document) so
  // indexed page state, element actions, and console capture are available in
  // the page.
  private async ensurePageRuntime(): Promise<void> {
    const version = await this.evaluateJson<number | null>(
      "window.__fcodeBrowserUse ? window.__fcodeBrowserUse.version : null",
    );
    // Register for future documents once per session so console capture starts
    // at page load after navigations — re-registering on every call would stack
    // duplicate injections. The runtime's own version guard keeps a single
    // instance per document even if the script evaluates more than once.
    if (!this.registeredNewDocumentRuntime) {
      const registered = await this.cdp("Page.addScriptToEvaluateOnNewDocument", {
        source: FCODE_PAGE_CONTROLLER_INJECTION_SOURCE,
      })
        .then(() => true)
        .catch(() => false);
      this.registeredNewDocumentRuntime = registered;
    }
    if (version === FCODE_PAGE_CONTROLLER_INJECTION_VERSION) {
      return;
    }
    await this.cdp("Runtime.evaluate", {
      expression: FCODE_PAGE_CONTROLLER_INJECTION_SOURCE,
      returnByValue: true,
    });
  }

  // Returns the page as an indexed map of interactive elements — the primary
  // observation for element-based interaction (page-agent's technique).
  async getPageState(): Promise<BrowserUsePageState> {
    await this.ensurePageRuntime();
    return this.evaluateJson<BrowserUsePageState>("window.__fcodeBrowserUse.getBrowserState()");
  }

  private async runPageAction(invocation: string): Promise<string> {
    await this.ensurePageRuntime();
    const result = await this.evaluateJson<{ success?: boolean; message?: string } | null>(
      invocation,
    );
    if (result?.success !== true) {
      throw new Error(result?.message ?? "The page action failed.");
    }
    return result.message ?? "Done.";
  }

  async clickElementByIndex(index: number): Promise<string> {
    return this.runPageAction(`window.__fcodeBrowserUse.clickElement(${JSON.stringify(index)})`);
  }

  async inputTextByIndex(index: number, text: string): Promise<string> {
    return this.runPageAction(
      `window.__fcodeBrowserUse.inputText(${JSON.stringify(index)}, ${JSON.stringify(text)})`,
    );
  }

  async selectOptionByIndex(index: number, optionText: string): Promise<string> {
    return this.runPageAction(
      `window.__fcodeBrowserUse.selectOption(${JSON.stringify(index)}, ${JSON.stringify(optionText)})`,
    );
  }

  // Consumes console output (log/warn/error + uncaught errors and rejections)
  // buffered by the injected page runtime since the last read (or since the
  // runtime was installed on the current document).
  async readConsole(): Promise<BrowserUseConsoleEntry[]> {
    await this.ensurePageRuntime();
    const entries = await this.evaluateJson<BrowserUseConsoleEntry[]>(
      "window.__fcodeBrowserUse.drainConsole()",
    );
    return Array.isArray(entries) ? entries : [];
  }
}
