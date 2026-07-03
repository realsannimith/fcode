// FILE: browserUsePipe.test.ts
// Purpose: Guards the shared browser-use pipe frame codec and env discovery.
// Layer: Shared test
// Depends on: Vitest and browserUsePipe exports

import { describe, expect, it } from "vitest";

import {
  BROWSER_USE_PIPE_MAX_MESSAGE_BYTES,
  decodeBrowserUsePipeFrames,
  DPCODE_BROWSER_USE_PIPE_ENV,
  encodeBrowserUsePipeFrame,
  FCODE_BROWSER_USE_PIPE_ENV,
  readBrowserUsePipePathFromEnv,
} from "./browserUsePipe";

describe("browser-use pipe frame codec", () => {
  it("round-trips a JSON message through encode/decode", () => {
    const message = { jsonrpc: "2.0", id: 7, method: "getTabs", params: { session_id: "s" } };

    const decoded = decodeBrowserUsePipeFrames(encodeBrowserUsePipeFrame(message));

    expect(decoded).not.toBeNull();
    expect(decoded?.messages.map((raw) => JSON.parse(raw))).toEqual([message]);
    expect(decoded?.remaining.length).toBe(0);
  });

  it("decodes multiple frames and keeps trailing partial bytes", () => {
    const first = encodeBrowserUsePipeFrame({ id: 1 });
    const second = encodeBrowserUsePipeFrame({ id: 2 });
    const partial = second.subarray(0, second.length - 3);

    const decoded = decodeBrowserUsePipeFrames(Buffer.concat([first, partial]));

    expect(decoded?.messages).toEqual([JSON.stringify({ id: 1 })]);
    expect(decoded?.remaining).toEqual(partial);
  });

  it("rejects oversized frames as a protocol violation", () => {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(BROWSER_USE_PIPE_MAX_MESSAGE_BYTES + 1, 0);

    expect(decodeBrowserUsePipeFrames(header)).toBeNull();
  });
});

describe("browser-use pipe env discovery", () => {
  it("prefers the FCode env var and falls back through legacy names", () => {
    expect(
      readBrowserUsePipePathFromEnv({
        [FCODE_BROWSER_USE_PIPE_ENV]: "/tmp/a.sock",
        [DPCODE_BROWSER_USE_PIPE_ENV]: "/tmp/b.sock",
      }),
    ).toBe("/tmp/a.sock");
    expect(readBrowserUsePipePathFromEnv({ [DPCODE_BROWSER_USE_PIPE_ENV]: "/tmp/b.sock" })).toBe(
      "/tmp/b.sock",
    );
  });

  it("returns null when nothing is configured", () => {
    expect(readBrowserUsePipePathFromEnv({})).toBeNull();
    expect(readBrowserUsePipePathFromEnv({ [FCODE_BROWSER_USE_PIPE_ENV]: "  " })).toBeNull();
  });
});
