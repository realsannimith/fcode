---
name: verify
description: Verify FCode changes by running the app and observing behavior. Use after nontrivial changes to server/web/contracts code, before considering work done.
---

# Verifying FCode changes

## Hard rules (from the user)

- NEVER run, build, or test the app in a plain Chrome/web browser. FCode is the native Electron app only.
- "Native" always means the DEV app (`FCode (Dev).app`). NEVER kill, restart, or touch the production FCode app the user has open. Clean up only the exact PIDs/ports you started — never `pkill Electron` or other broad matches.

## Launch recipe (isolated dev instance)

```bash
S=<scratch dir>   # temp home + fixtures live here, never ~/.fcode
env PATH="<optional shim dir>:$PWD/node_modules/.bin:$PATH" \
    SHELL="<fakeshell if using a PATH shim — see below>" \
    FCODE_HOME="$S/fcode-home" \
    T3CODE_PORT_OFFSET=91 \
    node scripts/dev-runner.ts dev:desktop > "$S/electron.log" 2>&1 &
```

- `dev:desktop` boots Vite (web) + the Electron shell; the shell embeds the server in desktop mode on a RANDOM port with auth enabled — read `"$FCODE_HOME/dev/server-runtime.json"` for `{pid, port}`.
- Offset ports: server `3773+offset`, web `5733+offset`. Pick an unused offset; the user's own instances may occupy others.
- `node_modules/.bin` must be on PATH (dev-runner spawns `turbo` directly).
- FCODE_HOME env is honored (equivalent to `--home-dir`). Always isolate; `~/.fcode` is the user's real state.

## Headless server-side verification (allowed, not Chrome)

The server can be driven directly over Effect RPC WebSocket at `ws://[::1]:<serverPort>/ws` (JSON serialization). Boot a `dev` (web-mode) instance for this — its server has auth disabled. Minimal client:

```ts
import { WS_METHODS, WsRpcGroup } from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";
const protocol = RpcClient.layerProtocolSocket().pipe(
  Layer.provide(
    Layer.mergeAll(
      Socket.layerWebSocket(URL).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
      RpcSerialization.layerJson,
    ),
  ),
);
// inside Effect.scoped: const client = yield* RpcClient.make(WsRpcGroup); client[WS_METHODS.xxx](input)
```

Run it with `bun` from the repo root (workspace imports resolve). Effect here is effect-smol: no `Effect.timeoutFail`; use `Effect.race` with `Effect.sleep`.

## Gotcha: server PATH hydration overrides shims

`fixPath()` (apps/server/src/os-jank.ts, called at startup) probes the LOGIN SHELL (`$SHELL -ilc ...`) and PREPENDS that PATH to `process.env.PATH`. Any PATH shim you prepend at launch (e.g. a fake `gh`) gets outranked by `/opt/homebrew/bin`. Workaround: set `SHELL` to a fake shell that echoes the inherited PATH:

```bash
#!/bin/bash
exec /bin/sh -c "${@: -1}"
```

## Faking GitHub for PR features

- `gh` shim on PATH answering `gh pr view <ref> --json ...` (single JSON object; fields: number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository) and `gh pr list ...` (`[]`).
- Fixture: local bare repo as `origin`; expose PR heads as `refs/pull/<n>/head` in the bare repo (`git update-ref`) — same-repo PR materialization fetches exactly that ref.
- Keep the working clone checked out on a branch that is NOT the PR head (fetch refuses to update the checked-out branch).

## UI verification

Manual, through the FCode (Dev) window. Pre-create the project/fixture via the RPC or by clicking; the isolated home's `state.sqlite` is shared between a `dev` (web-mode) session and a later `dev:desktop` session on the same FCODE_HOME, so state prepared headlessly appears in the native app.
