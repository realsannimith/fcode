// FILE: processControl.ts
// Purpose: Cross-platform termination for provider CLI child processes.

import { type ChildProcessWithoutNullStreams, spawnSync } from "node:child_process";

export function killChildProcess(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    try {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch {
      // Fall back to direct kill below.
    }
  }

  child.kill("SIGTERM");
}
