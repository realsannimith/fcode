// FILE: browserUsePipeClient.test.ts
// Purpose: Guards the browser-use pipe client's JSON-RPC framing, correlation, and failure paths.
// Layer: Server test
// Depends on: Vitest, a real Net pipe server fixture, and the pipe client

import * as FS from "node:fs";
import * as Net from "node:net";
import * as OS from "node:os";
import * as Path from "node:path";

import {
  decodeBrowserUsePipeFrames,
  encodeBrowserUsePipeFrame,
} from "@t3tools/shared/browserUsePipe";
import { afterEach, describe, expect, it } from "vitest";

import { BrowserUsePipeClient, BrowserUsePipeUnavailableError } from "./browserUsePipeClient.ts";

interface PipeRequest {
  id: number;
  method: string;
  params?: unknown;
}

type SocketRequestHandler = (request: PipeRequest, socket: Net.Socket) => void;

const servers: Net.Server[] = [];
const clients: BrowserUsePipeClient[] = [];

function tempPipePath(): string {
  return Path.join(FS.mkdtempSync(Path.join(OS.tmpdir(), "fcode-browser-use-test-")), "pipe.sock");
}

function respond(socket: Net.Socket, message: unknown): void {
  if (!socket.destroyed) {
    socket.write(encodeBrowserUsePipeFrame(message));
  }
}

async function startPipeServer(onRequest: SocketRequestHandler): Promise<string> {
  const pipePath = tempPipePath();
  const server = Net.createServer((socket) => {
    let pending: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      const decoded = decodeBrowserUsePipeFrames(Buffer.concat([pending, chunk]));
      if (!decoded) {
        socket.destroy();
        return;
      }
      pending = decoded.remaining;
      for (const raw of decoded.messages) {
        onRequest(JSON.parse(raw) as PipeRequest, socket);
      }
    });
    socket.on("error", () => {});
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(pipePath, resolve);
  });
  return pipePath;
}

function makeClient(pipePath: string): BrowserUsePipeClient {
  const client = new BrowserUsePipeClient(pipePath, {
    requestTimeoutMs: 2_000,
    connectTimeoutMs: 1_000,
  });
  clients.push(client);
  return client;
}

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.dispose();
  }
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

describe("BrowserUsePipeClient", () => {
  it("correlates concurrent requests by id", async () => {
    const pipePath = await startPipeServer((request, socket) => {
      respond(socket, {
        jsonrpc: "2.0",
        id: request.id,
        result: { echoedMethod: request.method, echoedParams: request.params ?? null },
      });
    });
    const client = makeClient(pipePath);

    const [ping, tabs] = await Promise.all([
      client.request("ping"),
      client.request("getTabs", { session_id: "s1" }),
    ]);

    expect(ping).toEqual({ echoedMethod: "ping", echoedParams: null });
    expect(tabs).toEqual({ echoedMethod: "getTabs", echoedParams: { session_id: "s1" } });
  });

  it("surfaces JSON-RPC errors as rejected promises", async () => {
    const pipePath = await startPipeServer((request, socket) => {
      respond(socket, {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: 1, message: "Unknown tab: 9" },
      });
    });

    await expect(makeClient(pipePath).request("attach", { tabId: 9 })).rejects.toThrow(
      "Unknown tab: 9",
    );
  });

  it("ignores notification frames while matching responses", async () => {
    const pipePath = await startPipeServer((request, socket) => {
      respond(socket, {
        jsonrpc: "2.0",
        method: "onCDPEvent",
        params: { method: "Page.loadEventFired" },
      });
      respond(socket, { jsonrpc: "2.0", id: request.id, result: "pong" });
    });

    await expect(makeClient(pipePath).request("ping")).resolves.toBe("pong");
  });

  it("fails fast with a pipe-unavailable error when nothing is listening", async () => {
    await expect(makeClient(tempPipePath()).request("ping")).rejects.toBeInstanceOf(
      BrowserUsePipeUnavailableError,
    );
  });

  it("rejects in-flight requests when the connection drops, then reconnects", async () => {
    let dropNext = true;
    const pipePath = await startPipeServer((request, socket) => {
      if (dropNext) {
        dropNext = false;
        socket.destroy();
        return;
      }
      respond(socket, { jsonrpc: "2.0", id: request.id, result: "pong" });
    });
    const client = makeClient(pipePath);

    await expect(client.request("ping")).rejects.toThrow(/connection lost/i);
    await expect(client.request("ping")).resolves.toBe("pong");
  });
});
