// FILE: terminalRuntimeRegistry.ts
// Purpose: Keep a stable runtime map and delegate terminal lifecycle work to terminalRuntime.ts.
// Layer: Terminal runtime infrastructure
// Depends on: terminalRuntime.ts for lifecycle, terminalRuntimeTypes.ts for stable ids and contracts.

import { SearchAddon } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";

import {
  attachRuntimeToContainer,
  createRuntimeEntry,
  detachRuntimeFromContainer,
  disposeRuntimeEntry,
  syncRuntimeConfig,
  updateRuntimeViewState,
} from "./terminalRuntime";
import type {
  TerminalRuntimeConfig,
  TerminalRuntimeEntry,
  TerminalRuntimeStatus,
  TerminalRuntimeViewState,
} from "./terminalRuntimeTypes";
import { buildTerminalRuntimeKey } from "./terminalRuntimeTypes";

export { buildTerminalRuntimeKey, type TerminalRuntimeCallbacks } from "./terminalRuntimeTypes";

// --- Registry orchestration -------------------------------------------------

class TerminalRuntimeRegistry {
  private entries = new Map<string, TerminalRuntimeEntry>();

  attach(
    config: TerminalRuntimeConfig,
    viewState: TerminalRuntimeViewState,
    container: HTMLDivElement,
  ): { terminal: Terminal; searchAddon: SearchAddon; runtimeStatus: TerminalRuntimeStatus } {
    let entry = this.entries.get(config.runtimeKey);
    if (!entry) {
      entry = createRuntimeEntry(config);
      this.entries.set(config.runtimeKey, entry);
    } else {
      syncRuntimeConfig(entry, config);
    }

    attachRuntimeToContainer(entry, viewState, container);
    return {
      terminal: entry.terminal,
      searchAddon: entry.searchAddon,
      runtimeStatus: entry.runtimeStatus,
    };
  }

  syncConfig(runtimeKey: string, config: TerminalRuntimeConfig): void {
    const entry = this.entries.get(runtimeKey);
    if (!entry) return;
    syncRuntimeConfig(entry, config);
  }

  setViewState(runtimeKey: string, viewState: TerminalRuntimeViewState): void {
    const entry = this.entries.get(runtimeKey);
    if (!entry) return;
    updateRuntimeViewState(entry, viewState);
  }

  detach(runtimeKey: string): void {
    const entry = this.entries.get(runtimeKey);
    if (!entry) return;
    detachRuntimeFromContainer(entry);
  }

  dispose(runtimeKey: string): void {
    const entry = this.entries.get(runtimeKey);
    if (!entry) return;
    disposeRuntimeEntry(entry);
    this.entries.delete(runtimeKey);
  }

  disposeTerminal(threadId: string, terminalId: string): void {
    this.dispose(buildTerminalRuntimeKey(threadId, terminalId));
  }

  disposeThread(threadId: string): void {
    for (const runtimeKey of [...this.entries.keys()]) {
      if (runtimeKey.startsWith(`${threadId}::`)) {
        this.dispose(runtimeKey);
      }
    }
  }

  focus(runtimeKey: string): void {
    this.entries.get(runtimeKey)?.terminal.focus();
  }

  // Route text through xterm's paste path so it reaches the PTY with the same
  // bracketed-paste framing as a clipboard paste (agent CLIs rely on it to
  // treat dropped file paths as one atomic input).
  paste(runtimeKey: string, text: string): void {
    if (text.length === 0) return;
    this.entries.get(runtimeKey)?.terminal.paste(text);
  }

  // Resolve once a terminal's PTY is open at its fitted container width ("ready"), or false
  // after a timeout. Callers that type a startup command (e.g. an agent CLI) wait on this so
  // the command runs only after the pane has sized itself — otherwise the agent TUI boots at a
  // stale width and garbles when the real fit lands. Polls because the runtime entry may not be
  // attached yet when the wait begins (the xterm pane mounts a tick after the layout state).
  whenReady(threadId: string, terminalId: string, timeoutMs = 8000): Promise<boolean> {
    const key = buildTerminalRuntimeKey(threadId, terminalId);
    if (this.entries.get(key)?.runtimeStatus === "ready") {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const step = 50;
      let elapsed = 0;
      const tick = () => {
        if (this.entries.get(key)?.runtimeStatus === "ready") {
          resolve(true);
          return;
        }
        elapsed += step;
        if (elapsed >= timeoutMs) {
          resolve(false);
          return;
        }
        window.setTimeout(tick, step);
      };
      window.setTimeout(tick, step);
    });
  }
}

export const terminalRuntimeRegistry = new TerminalRuntimeRegistry();
