// FILE: storageKeyMigration.ts
// Purpose: Migrates legacy browser storage keys to the FCode namespace.
// Layer: Web bootstrap utility
// Exports: migrateFCodeLocalStorageKeys

// Canonical storage keys (namespace prefix stripped) that must survive an app rename.
const STORAGE_KEYS = [
  "renderer-state:v8",
  "composer-drafts:v1",
  "split-view-state:v1",
  "sidebar-ui:v1",
  "single-chat-panel-state:v1",
  "terminal-state:v1",
  "latest-project:v1",
  "app-settings:v1",
  "pinned-threads:v1",
  "browser-state:v1",
  "workspace-pages:v2",
  "theme",
  "last-editor",
  "last-invoked-script-by-project",
  "right-dock-state:v1",
  "repo-diff-scope:v1",
  "feature-flags",
  "whats-new:v1",
  "dismissed-provider-health-banners",
  "show-debug-feature-flags-menu",
  "cursor-favourite-models:v1",
  "kilo-favourite-models:v1",
  "opencode-favourite-models:v1",
  "pi-favourite-models:v1",
  "browser-perf",
] as const;

// Past app namespaces, newest first, so the freshest legacy value wins when more than one exists.
const LEGACY_NAMESPACES = ["ctcode", "kcode", "synara", "dpcode", "t3code"] as const;

export function migrateFCodeLocalStorageKeys(): void {
  // Prefer globalThis.localStorage so this works identically in browsers (where
  // globalThis === window) and in node-based unit tests that stub the global.
  let storage: Storage | null = null;
  try {
    storage = globalThis.localStorage ?? null;
  } catch {
    return;
  }
  if (!storage) {
    return;
  }

  try {
    for (const key of STORAGE_KEYS) {
      const nextKey = `fcode:${key}`;
      if (storage.getItem(nextKey) !== null) {
        continue;
      }
      for (const namespace of LEGACY_NAMESPACES) {
        const legacyValue = storage.getItem(`${namespace}:${key}`);
        if (legacyValue !== null) {
          storage.setItem(nextKey, legacyValue);
          break;
        }
      }
    }
  } catch {
    // Storage can be unavailable in private/sandboxed contexts; the app should still boot.
  }
}

// Run during bootstrap before stores hydrate from localStorage.
migrateFCodeLocalStorageKeys();
