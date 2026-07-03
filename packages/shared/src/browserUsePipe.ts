// FILE: browserUsePipe.ts
// Purpose: Shared browser-use pipe protocol primitives (frame codec + pipe path discovery)
//   so the desktop pipe server and server-side pipe clients speak one wire format.
// Layer: Shared runtime utility
// Depends on: Node Buffer/os primitives

import * as OS from "node:os";

export const BROWSER_USE_PIPE_HEADER_BYTES = 4;
export const BROWSER_USE_PIPE_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

export const FCODE_BROWSER_USE_PIPE_ENV = "FCODE_BROWSER_USE_PIPE_PATH";
export const DPCODE_BROWSER_USE_PIPE_ENV = "DPCODE_BROWSER_USE_PIPE_PATH";
export const T3CODE_BROWSER_USE_PIPE_ENV = "T3CODE_BROWSER_USE_PIPE_PATH";

// Reads the explicitly configured pipe path, if any. Callers layer their own
// platform default on top (the desktop generates a per-process socket, while
// Codex subprocess env falls back to Codex's fixed default path).
export function readBrowserUsePipePathFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  return (
    env[FCODE_BROWSER_USE_PIPE_ENV]?.trim() ||
    env[DPCODE_BROWSER_USE_PIPE_ENV]?.trim() ||
    env[T3CODE_BROWSER_USE_PIPE_ENV]?.trim() ||
    null
  );
}

// Where Codex's official control-in-app-browser plugin looks for browser pipes
// (hardcoded in the plugin — it reads no environment variable). On unix it
// readdir-scans this directory and dials every socket inside; on Windows it
// enumerates \\.\pipe\ names with this prefix. The desktop must place its pipe
// under this root — NOT under os.tmpdir(), which is /var/folders/... on macOS —
// or Codex sessions cannot discover the in-app browser.
export function codexBrowserUsePipeScanRoot(platform: NodeJS.Platform): string {
  return platform === "win32" ? String.raw`\\.\pipe\codex-browser-use` : "/tmp/codex-browser-use";
}

// The pipe protocol frames each JSON-RPC message with a 4-byte native-endian
// length header (matching the Codex browser-use transport).
export function encodeBrowserUsePipeFrame(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(BROWSER_USE_PIPE_HEADER_BYTES);
  if (OS.endianness() === "LE") {
    header.writeUInt32LE(payload.length, 0);
  } else {
    header.writeUInt32BE(payload.length, 0);
  }
  return Buffer.concat([header, payload]);
}

export interface DecodedBrowserUsePipeFrames {
  messages: string[];
  remaining: Buffer;
}

// Returns null when a frame declares an oversized payload, which callers must
// treat as a protocol violation and drop the connection.
export function decodeBrowserUsePipeFrames(buffer: Buffer): DecodedBrowserUsePipeFrames | null {
  let offset = 0;
  const messages: string[] = [];
  while (buffer.length - offset >= BROWSER_USE_PIPE_HEADER_BYTES) {
    const messageLength =
      OS.endianness() === "LE" ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
    if (messageLength > BROWSER_USE_PIPE_MAX_MESSAGE_BYTES) {
      return null;
    }
    const frameLength = BROWSER_USE_PIPE_HEADER_BYTES + messageLength;
    if (buffer.length - offset < frameLength) {
      break;
    }
    messages.push(
      buffer
        .subarray(offset + BROWSER_USE_PIPE_HEADER_BYTES, offset + frameLength)
        .toString("utf8"),
    );
    offset += frameLength;
  }
  return {
    messages,
    remaining: buffer.subarray(offset),
  };
}
