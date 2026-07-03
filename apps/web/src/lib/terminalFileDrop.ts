// FILE: terminalFileDrop.ts
// Purpose: Resolve OS paths for files dropped onto a terminal pane and build the PTY paste payload.
// Layer: Web terminal support lib
// Exports: canResolveDroppedFilePaths, resolveDroppedFilePaths, terminalPasteTextForPaths

import { quotePosixShellArgument } from "./shellQuote";

// Only the Electron shell can map a DOM `File` back to its on-disk path
// (webUtils.getPathForFile via the desktop bridge). In the plain web target the
// terminal must let file drags fall through to the chat composer instead.
function bridgeGetPathForFile(): ((file: File) => string) | undefined {
  if (typeof window === "undefined") return undefined;
  return window.desktopBridge?.getPathForFile;
}

export function canResolveDroppedFilePaths(): boolean {
  return bridgeGetPathForFile() !== undefined;
}

export function resolveDroppedFilePaths(
  files: Iterable<File>,
  getPathForFile: ((file: File) => string) | undefined = bridgeGetPathForFile(),
): string[] {
  if (!getPathForFile) return [];
  const paths: string[] = [];
  for (const file of files) {
    let path = "";
    try {
      path = getPathForFile(file);
    } catch {
      // A file with no filesystem backing (e.g. an image dragged from a web page).
    }
    if (path.length > 0) {
      paths.push(path);
    }
  }
  return paths;
}

// Trailing space matches native terminal drop behavior: the pasted path lands
// ready for the next argument (or Enter) instead of gluing onto typed text.
export function terminalPasteTextForPaths(paths: readonly string[]): string {
  if (paths.length === 0) return "";
  return `${paths.map(quotePosixShellArgument).join(" ")} `;
}
