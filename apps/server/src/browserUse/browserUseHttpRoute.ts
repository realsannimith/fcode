// FILE: browserUseHttpRoute.ts
// Purpose: HTTP bridge that lets the cross-provider fcode-browser skill CLI drive the
//   in-app browser. Every provider CLI can shell out to HTTP; only Claude gets
//   in-process MCP tools, so this route is what makes browser-use universal.
// Layer: Server browser-use bridge
// Depends on: browser-use session registry and the Effect HTTP router

import { readBrowserUsePipePathFromEnv } from "@t3tools/shared/browserUsePipe";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ServerConfig, type ServerConfigShape } from "../config.ts";
import { getOrCreateHttpBrowserUseSession } from "./browserUseSessionRegistry.ts";
import type { BrowserUseSession } from "./browserUseSession.ts";

export const BROWSER_USE_HTTP_ROUTE_PATH = "/api/browser-use";

interface BrowserUseOpRequest {
  op?: string;
  session?: string;
  args?: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required string argument: ${key}`);
  }
  return value;
}

function requireNumber(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing required numeric argument: ${key}`);
  }
  return value;
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  return typeof args[key] === "number" && Number.isFinite(args[key]) ? args[key] : undefined;
}

// Single dispatcher for the skill CLI. Every op returns JSON-serializable data;
// the heavy lifting lives in BrowserUseSession, shared with the MCP tools.
export async function executeBrowserUseOp(
  session: BrowserUseSession,
  op: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (op) {
    case "tabs":
      return session.listTabs();
    case "new_tab":
      return session.newTab();
    case "select_tab":
      await session.selectTab(requireNumber(args, "tab_id"));
      return { selected: requireNumber(args, "tab_id") };
    case "navigate":
      return session.navigate(requireString(args, "url"));
    case "back":
      return session.goHistory("back");
    case "forward":
      return session.goHistory("forward");
    case "page_state":
      return session.getPageState();
    case "click_element":
      return { message: await session.clickElementByIndex(requireNumber(args, "index")) };
    case "input_text":
      return {
        message: await session.inputTextByIndex(
          requireNumber(args, "index"),
          requireString(args, "text"),
        ),
      };
    case "select_option":
      return {
        message: await session.selectOptionByIndex(
          requireNumber(args, "index"),
          requireString(args, "option_text"),
        ),
      };
    case "click": {
      const button = args.button;
      const clickCount = optionalNumber(args, "click_count");
      await session.click({
        x: requireNumber(args, "x"),
        y: requireNumber(args, "y"),
        ...(button === "left" || button === "middle" || button === "right" ? { button } : {}),
        ...(clickCount !== undefined ? { clickCount } : {}),
      });
      return { clicked: true };
    }
    case "type":
      await session.typeText(requireString(args, "text"));
      return { typed: true };
    case "press": {
      const modifiers = Array.isArray(args.modifiers)
        ? args.modifiers.filter((entry): entry is string => typeof entry === "string")
        : [];
      await session.pressKey(requireString(args, "key"), modifiers);
      return { pressed: true };
    }
    case "scroll": {
      const deltaX = optionalNumber(args, "delta_x");
      const deltaY = optionalNumber(args, "delta_y");
      const x = optionalNumber(args, "x");
      const y = optionalNumber(args, "y");
      await session.scroll({
        ...(deltaX !== undefined ? { deltaX } : {}),
        ...(deltaY !== undefined ? { deltaY } : {}),
        ...(x !== undefined ? { x } : {}),
        ...(y !== undefined ? { y } : {}),
      });
      return { scrolled: true };
    }
    case "read":
      return session.readPage(optionalNumber(args, "max_chars"));
    case "console":
      return session.readConsole();
    case "eval":
      return { result: await session.evaluate(requireString(args, "expression")) };
    case "screenshot":
      return session.screenshot();
    default:
      throw new Error(`Unknown browser-use op: ${op}`);
  }
}

function isTokenAuthorized(config: ServerConfigShape, url: URL): boolean {
  return !config.authToken || url.searchParams.get("token") === config.authToken;
}

export const browserUseEffectRouteLayer = HttpRouter.add(
  "POST",
  BROWSER_USE_HTTP_ROUTE_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });

    // The skill CLI authenticates with the startup token baked into its
    // runtime config, mirroring the local-image/attachments routes.
    const config = yield* ServerConfig;
    if (!isTokenAuthorized(config, url)) {
      return HttpServerResponse.jsonUnsafe({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const pipePath = readBrowserUsePipePathFromEnv();
    if (!pipePath) {
      return HttpServerResponse.jsonUnsafe(
        { ok: false, error: "The in-app browser is only available in the FCode desktop app." },
        { status: 503 },
      );
    }

    const body = asRecord(
      yield* Effect.orElseSucceed(request.json, () => null),
    ) as BrowserUseOpRequest;
    if (typeof body.op !== "string" || body.op.length === 0) {
      return HttpServerResponse.jsonUnsafe(
        { ok: false, error: "Request body must include an op." },
        { status: 400 },
      );
    }

    const sessionKey = `skill-${typeof body.session === "string" && body.session.length > 0 ? body.session : "default"}`;
    const session = getOrCreateHttpBrowserUseSession(sessionKey, pipePath);

    const result = yield* Effect.promise(() =>
      executeBrowserUseOp(session, body.op as string, asRecord(body.args))
        .then((value) => ({ ok: true as const, result: value ?? null }))
        .catch((error: unknown) => ({
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
        })),
    );
    return HttpServerResponse.jsonUnsafe(result, { status: result.ok ? 200 : 400 });
  }),
);
