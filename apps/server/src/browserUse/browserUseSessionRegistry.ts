// FILE: browserUseSessionRegistry.ts
// Purpose: Process-wide browser-use pipe client and session registry shared by the
//   Claude MCP server and the cross-provider HTTP bridge.
// Layer: Server browser-use bridge
// Depends on: BrowserUsePipeClient and BrowserUseSession

import { BrowserUsePipeClient } from "./browserUsePipeClient.ts";
import { BrowserUseSession } from "./browserUseSession.ts";

const HTTP_SESSION_CACHE_LIMIT = 50;

// One pipe connection per process is enough: requests are id-correlated and
// per-session tab selection happens on the pipe server keyed by session_id.
let sharedClient: BrowserUsePipeClient | null = null;
let sharedClientPipePath: string | null = null;

export function getSharedBrowserUseClient(pipePath: string): BrowserUsePipeClient {
  if (!sharedClient || sharedClientPipePath !== pipePath) {
    sharedClient?.dispose();
    sharedClient = new BrowserUsePipeClient(pipePath);
    sharedClientPipePath = pipePath;
  }
  return sharedClient;
}

// HTTP bridge callers (the fcode-browser skill CLI) are stateless processes, so
// their sessions live here between invocations; oldest sessions are evicted
// once the cache fills to keep console buffers bounded.
const httpSessions = new Map<string, { pipePath: string; session: BrowserUseSession }>();

export function getOrCreateHttpBrowserUseSession(
  sessionId: string,
  pipePath: string,
): BrowserUseSession {
  const existing = httpSessions.get(sessionId);
  if (existing && existing.pipePath === pipePath) {
    // Refresh LRU position.
    httpSessions.delete(sessionId);
    httpSessions.set(sessionId, existing);
    return existing.session;
  }

  const session = new BrowserUseSession(getSharedBrowserUseClient(pipePath), sessionId);
  httpSessions.set(sessionId, { pipePath, session });
  while (httpSessions.size > HTTP_SESSION_CACHE_LIMIT) {
    const oldestKey = httpSessions.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    httpSessions.delete(oldestKey);
  }
  return session;
}

export function clearBrowserUseRegistryForTests(): void {
  httpSessions.clear();
  sharedClient?.dispose();
  sharedClient = null;
  sharedClientPipePath = null;
}
