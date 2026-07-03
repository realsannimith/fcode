// FILE: browserUsePipeClient.ts
// Purpose: JSON-RPC client for the desktop in-app browser's browser-use pipe, so server-side
//   provider integrations (e.g. Claude MCP tools) can drive the native browser like Codex does.
// Layer: Server browser-use bridge
// Depends on: Node net primitives and the shared browser-use pipe frame codec

import * as Net from "node:net";

import {
  decodeBrowserUsePipeFrames,
  encodeBrowserUsePipeFrame,
} from "@t3tools/shared/browserUsePipe";

const BROWSER_USE_REQUEST_TIMEOUT_MS = 30_000;
const BROWSER_USE_CONNECT_TIMEOUT_MS = 5_000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface BrowserUseRpcResponse {
  id?: string | number;
  result?: unknown;
  error?: { code?: number; message?: string };
}

export class BrowserUsePipeUnavailableError extends Error {
  constructor(pipePath: string, cause?: unknown) {
    super(`The in-app browser pipe is not reachable at ${pipePath}.`);
    this.name = "BrowserUsePipeUnavailableError";
    this.cause = cause;
  }
}

export interface BrowserUsePipeClientOptions {
  requestTimeoutMs?: number;
  connectTimeoutMs?: number;
}

// One client per pipe path; connects lazily and transparently reconnects after
// socket loss so long-lived provider sessions survive desktop browser restarts.
export class BrowserUsePipeClient {
  private socket: Net.Socket | null = null;
  private connecting: Promise<Net.Socket> | null = null;
  private pendingBuffer: Buffer = Buffer.alloc(0);
  private readonly pendingById = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private disposed = false;
  private readonly requestTimeoutMs: number;
  private readonly connectTimeoutMs: number;

  constructor(
    private readonly pipePath: string,
    options: BrowserUsePipeClientOptions = {},
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? BROWSER_USE_REQUEST_TIMEOUT_MS;
    this.connectTimeoutMs = options.connectTimeoutMs ?? BROWSER_USE_CONNECT_TIMEOUT_MS;
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (this.disposed) {
      throw new Error("Browser-use pipe client is disposed.");
    }
    const socket = await this.ensureConnected();
    const id = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingById.delete(id);
        reject(new Error(`Browser-use request timed out: ${method}`));
      }, this.requestTimeoutMs);
      timer.unref();
      this.pendingById.set(id, { resolve, reject, timer });
      socket.write(
        encodeBrowserUsePipeFrame({
          jsonrpc: "2.0",
          id,
          method,
          ...(params !== undefined ? { params } : {}),
        }),
        (error) => {
          if (error) {
            this.settlePending(id, undefined, error);
          }
        },
      );
    });
  }

  dispose(): void {
    this.disposed = true;
    this.teardownSocket(new Error("Browser-use pipe client is disposed."));
  }

  private async ensureConnected(): Promise<Net.Socket> {
    if (this.socket && !this.socket.destroyed) {
      return this.socket;
    }
    this.connecting ??= this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private connect(): Promise<Net.Socket> {
    return new Promise<Net.Socket>((resolve, reject) => {
      const socket = Net.createConnection(this.pipePath);
      const failConnect = (cause: unknown) => {
        socket.destroy();
        reject(new BrowserUsePipeUnavailableError(this.pipePath, cause));
      };
      const connectTimer = setTimeout(() => {
        failConnect(new Error("Connection timed out."));
      }, this.connectTimeoutMs);
      connectTimer.unref();

      socket.once("error", (error) => {
        clearTimeout(connectTimer);
        failConnect(error);
      });
      socket.once("connect", () => {
        clearTimeout(connectTimer);
        socket.removeAllListeners("error");
        this.adoptSocket(socket);
        resolve(socket);
      });
    });
  }

  private adoptSocket(socket: Net.Socket): void {
    this.socket = socket;
    this.pendingBuffer = Buffer.alloc(0);
    socket.on("data", (chunk) => this.handleData(chunk));
    const onLost = (cause?: unknown) => {
      if (this.socket === socket) {
        this.teardownSocket(
          new Error(
            `Browser-use pipe connection lost${cause instanceof Error ? `: ${cause.message}` : "."}`,
          ),
        );
      }
    };
    socket.on("error", onLost);
    socket.on("close", () => onLost());
  }

  private teardownSocket(error: Error): void {
    const socket = this.socket;
    this.socket = null;
    this.pendingBuffer = Buffer.alloc(0);
    if (socket && !socket.destroyed) {
      socket.destroy();
    }
    // Map iteration tolerates deleting the current entry, which is all
    // settlePending removes.
    for (const id of this.pendingById.keys()) {
      this.settlePending(id, undefined, error);
    }
  }

  private handleData(chunk: Buffer): void {
    const decoded = decodeBrowserUsePipeFrames(Buffer.concat([this.pendingBuffer, chunk]));
    if (!decoded) {
      this.teardownSocket(new Error("Browser-use pipe sent an oversized frame."));
      return;
    }
    this.pendingBuffer = decoded.remaining;
    for (const message of decoded.messages) {
      this.handleMessage(message);
    }
  }

  private handleMessage(rawMessage: string): void {
    let response: BrowserUseRpcResponse;
    try {
      response = JSON.parse(rawMessage) as BrowserUseRpcResponse;
    } catch {
      return;
    }
    // Notifications (e.g. onCDPEvent broadcasts) carry no id. Browser tools
    // poll page state instead of consuming the event stream — the stream binds
    // to a specific webContents and silently dies when the desktop suspends
    // and recreates tab runtimes — so notification frames are dropped here.
    if (typeof response.id !== "number") {
      return;
    }
    if (response.error) {
      this.settlePending(
        response.id,
        undefined,
        new Error(response.error.message ?? "Browser-use request failed."),
      );
      return;
    }
    this.settlePending(response.id, response.result);
  }

  private settlePending(id: number, result: unknown, error?: Error): void {
    const pending = this.pendingById.get(id);
    if (!pending) {
      return;
    }
    this.pendingById.delete(id);
    clearTimeout(pending.timer);
    if (error) {
      pending.reject(error);
    } else {
      pending.resolve(result);
    }
  }
}
