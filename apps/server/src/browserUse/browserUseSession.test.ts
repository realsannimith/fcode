// FILE: browserUseSession.test.ts
// Purpose: Guards the CDP command mapping and tab lifecycle of the browser-use session layer.
// Layer: Server test
// Depends on: Vitest and a scripted fake pipe client

import { describe, expect, it } from "vitest";

import type { BrowserUsePipeClient } from "./browserUsePipeClient.ts";
import { BrowserUseSession, resolveKeyModifiers } from "./browserUseSession.ts";
import { FCODE_PAGE_CONTROLLER_INJECTION_VERSION } from "./pageControllerInjection.gen.ts";

interface RecordedRequest {
  method: string;
  params: Record<string, unknown>;
}

type PipeResponder = (method: string, params: Record<string, unknown>) => unknown;

// Scripted stand-in for the pipe client: records every request and answers via
// the provided responder, so tests assert on exact wire traffic.
function makeFakeClient(respond: PipeResponder): {
  client: BrowserUsePipeClient;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const client = {
    request: (method: string, params?: unknown) => {
      const recorded = { method, params: (params ?? {}) as Record<string, unknown> };
      requests.push(recorded);
      try {
        return Promise.resolve(respond(method, recorded.params));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  } as unknown as BrowserUsePipeClient;
  return { client, requests };
}

function cdpCalls(requests: RecordedRequest[]): Array<{ method: string; params: unknown }> {
  return requests
    .filter((request) => request.method === "executeCdp")
    .map((request) => ({
      method: request.params.method as string,
      params: request.params.commandParams,
    }));
}

const DEFAULT_TABS = [{ id: 1, title: "Tab", active: true, url: "https://example.com" }];

function makeSession(overrides: Partial<Record<string, PipeResponder>> = {}) {
  const { client, requests } = makeFakeClient((method, params) => {
    const override = overrides[method];
    if (override) {
      return override(method, params);
    }
    switch (method) {
      case "getTabs":
        return DEFAULT_TABS;
      case "attach":
        return {};
      case "createTab":
        return { id: 2, title: "New tab", active: true, url: "about:blank" };
      case "executeCdp": {
        const cdpMethod = params.method as string;
        if (cdpMethod === "Runtime.evaluate") {
          return {
            result: {
              value: { url: "https://example.com", title: "Example", readyState: "complete" },
            },
          };
        }
        if (cdpMethod === "Page.getLayoutMetrics") {
          return {
            cssVisualViewport: { pageX: 0, pageY: 120, clientWidth: 900, clientHeight: 600 },
          };
        }
        if (cdpMethod === "Page.captureScreenshot") {
          return { data: "cGln" };
        }
        return {};
      }
      default:
        throw new Error(`Unexpected pipe method: ${method}`);
    }
  });
  return { session: new BrowserUseSession(client, "claude-thread-1"), requests };
}

describe("BrowserUseSession", () => {
  it("attaches to the active tab before the first CDP command", async () => {
    const { session, requests } = makeSession();

    await session.navigate("https://example.com/docs");

    expect(requests[0]).toEqual({ method: "getTabs", params: { session_id: "claude-thread-1" } });
    expect(requests[1]).toEqual({
      method: "attach",
      params: { session_id: "claude-thread-1", tabId: 1 },
    });
    expect(cdpCalls(requests)[0]).toEqual({
      method: "Page.navigate",
      params: { url: "https://example.com/docs" },
    });
  });

  it("creates a tab when the browser panel has none open", async () => {
    const { session, requests } = makeSession({ getTabs: () => [] });

    await session.getPageInfo();

    expect(requests.map((request) => request.method)).toEqual([
      "getTabs",
      "createTab",
      "attach",
      "executeCdp",
    ]);
  });

  it("recovers from a stale tab by re-attaching and retrying once", async () => {
    let failuresLeft = 1;
    const { session, requests } = makeSession({
      executeCdp: (_method, params) => {
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          throw new Error("Unknown tab: 4");
        }
        if (params.method === "Runtime.evaluate") {
          return {
            result: {
              value: { url: "https://example.com", title: "Example", readyState: "complete" },
            },
          };
        }
        return {};
      },
    });
    // Seed the session with an attached tab, then invalidate it.
    await session.selectTab(4);

    await session.getPageInfo();

    const methods = requests.map((request) => request.method);
    expect(methods).toEqual(["attach", "executeCdp", "getTabs", "attach", "executeCdp"]);
  });

  it("captures screenshots clipped to the CSS viewport at scale 1", async () => {
    const { session, requests } = makeSession();

    const shot = await session.screenshot();

    expect(shot).toEqual({ base64Png: "cGln", width: 900, height: 600 });
    const capture = cdpCalls(requests).find((call) => call.method === "Page.captureScreenshot");
    expect(capture?.params).toEqual({
      format: "png",
      clip: { x: 0, y: 120, width: 900, height: 600, scale: 1 },
    });
  });

  it("dispatches move, press, and release events for a click", async () => {
    const { session, requests } = makeSession();

    await session.click({ x: 10, y: 20 });

    const mouseEvents = cdpCalls(requests)
      .filter((call) => call.method === "Input.dispatchMouseEvent")
      .map((call) => call.params as Record<string, unknown>);
    expect(mouseEvents.map((event) => event.type)).toEqual([
      "mouseMoved",
      "mousePressed",
      "mouseReleased",
    ]);
    expect(mouseEvents[1]).toMatchObject({ x: 10, y: 20, button: "left", clickCount: 1 });
  });

  it("maps named keys onto CDP key events and falls back to insertText for characters", async () => {
    const { session, requests } = makeSession();

    await session.pressKey("Enter");
    await session.pressKey("a");

    const calls = cdpCalls(requests);
    const keyEvents = calls
      .filter((call) => call.method === "Input.dispatchKeyEvent")
      .map((call) => call.params as Record<string, unknown>);
    expect(keyEvents[0]).toMatchObject({ type: "keyDown", key: "Enter", text: "\r" });
    expect(keyEvents[1]).toMatchObject({ type: "keyUp", key: "Enter" });
    expect(calls.find((call) => call.method === "Input.insertText")?.params).toEqual({
      text: "a",
    });
  });

  it("rejects unknown named keys with the supported list", async () => {
    const { session } = makeSession();

    await expect(session.pressKey("SuperKey")).rejects.toThrow(/Unknown key: SuperKey/);
  });

  it("truncates page text to the requested limit and flags it", async () => {
    const { session } = makeSession({
      executeCdp: (_method, params) => {
        if (params.method === "Runtime.evaluate") {
          return {
            result: {
              value: { url: "https://example.com", title: "Example", text: "abcdefghij" },
            },
          };
        }
        return {};
      },
    });

    const page = await session.readPage(100);

    // The in-page script already sliced to limit+1; anything longer than the
    // limit signals truncation.
    expect(page.truncated).toBe(false);
    expect(page.text).toBe("abcdefghij");
  });

  it("drains the in-page console buffer through the injected runtime", async () => {
    const entries = [{ level: "error", text: "boom" }];
    const { session, requests } = makeSession({
      executeCdp: (_method, params) => {
        if (params.method !== "Runtime.evaluate") {
          return {};
        }
        const expression = (params.commandParams as { expression: string }).expression;
        if (expression === "window.__fcodeBrowserUse ? window.__fcodeBrowserUse.version : null") {
          return { result: { value: null } };
        }
        if (expression === "window.__fcodeBrowserUse.drainConsole()") {
          return { result: { value: entries } };
        }
        return { result: {} };
      },
    });

    await expect(session.readConsole()).resolves.toEqual(entries);
    // The read installed the page runtime for the current and future documents.
    const cdpMethods = cdpCalls(requests).map((call) => call.method);
    expect(cdpMethods).toContain("Page.addScriptToEvaluateOnNewDocument");
  });

  it("injects the page-controller runtime once, then fetches indexed page state", async () => {
    let runtimeVersion: number | null = null;
    const pageState = {
      url: "https://example.com",
      title: "Example",
      header: "Current Page: [Example](https://example.com)",
      content: "[0]<button>Submit /> ",
      footer: "[End of page]",
    };
    const { session, requests } = makeSession({
      executeCdp: (_method, params) => {
        if (params.method !== "Runtime.evaluate") {
          return {};
        }
        const expression = (params.commandParams as { expression: string }).expression;
        if (expression === "window.__fcodeBrowserUse ? window.__fcodeBrowserUse.version : null") {
          return { result: { value: runtimeVersion } };
        }
        if (expression === "window.__fcodeBrowserUse.getBrowserState()") {
          return { result: { value: pageState } };
        }
        // Any other evaluate is the injection bundle itself (which also
        // contains strings like "getBrowserState", hence exact matches above).
        runtimeVersion = FCODE_PAGE_CONTROLLER_INJECTION_VERSION;
        return { result: {} };
      },
    });

    await expect(session.getPageState()).resolves.toEqual(pageState);
    await expect(session.getPageState()).resolves.toEqual(pageState);

    const evaluates = cdpCalls(requests).filter((call) => call.method === "Runtime.evaluate");
    const injections = evaluates.filter((call) =>
      (call.params as { expression: string }).expression.includes("PageController"),
    );
    // Version probe answered current on the second round-trip, so the
    // heavyweight bundle is only injected into the document once.
    expect(injections.length).toBe(1);
    // The on-new-document registration is also made exactly once per session,
    // not stacked on every call.
    const newDocRegistrations = cdpCalls(requests).filter(
      (call) => call.method === "Page.addScriptToEvaluateOnNewDocument",
    );
    expect(newDocRegistrations.length).toBe(1);
  });

  it("runs indexed element actions and surfaces failures as errors", async () => {
    const { session, requests } = makeSession({
      executeCdp: (_method, params) => {
        if (params.method !== "Runtime.evaluate") {
          return {};
        }
        const expression = (params.commandParams as { expression?: string }).expression ?? "";
        if (expression.includes("window.__fcodeBrowserUse ? window.__fcodeBrowserUse.version")) {
          return { result: { value: FCODE_PAGE_CONTROLLER_INJECTION_VERSION } };
        }
        if (expression.startsWith("window.__fcodeBrowserUse.clickElement(3)")) {
          return { result: { value: { success: true, message: "Clicked element 3" } } };
        }
        if (expression.startsWith("window.__fcodeBrowserUse.inputText(2,")) {
          return { result: { value: { success: false, message: "Element 2 is not editable" } } };
        }
        return { result: {} };
      },
    });

    await expect(session.clickElementByIndex(3)).resolves.toBe("Clicked element 3");
    await expect(session.inputTextByIndex(2, "hello")).rejects.toThrow("Element 2 is not editable");
    const inputCall = cdpCalls(requests)
      .map((call) => (call.params as { expression?: string }).expression)
      .find((expression) => expression?.startsWith("window.__fcodeBrowserUse.inputText("));
    expect(inputCall).toContain('"hello"');
  });

  it("surfaces page JavaScript exceptions as errors", async () => {
    const { session } = makeSession({
      executeCdp: (_method, params) => {
        if (params.method === "Runtime.evaluate") {
          return {
            exceptionDetails: {
              text: "Uncaught",
              exception: { description: "ReferenceError: nope is not defined" },
            },
          };
        }
        return {};
      },
    });

    await expect(session.evaluate("nope")).rejects.toThrow("ReferenceError: nope is not defined");
  });
});

describe("resolveKeyModifiers", () => {
  it("builds the CDP modifier bitmask", () => {
    expect(resolveKeyModifiers(["alt", "ctrl", "meta", "shift"])).toBe(15);
    expect(resolveKeyModifiers(["cmd"])).toBe(4);
    expect(() => resolveKeyModifiers(["hyper"])).toThrow(/Unknown key modifier/);
  });
});
