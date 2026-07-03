import { WorkerPoolContextProvider, useWorkerPool } from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTheme } from "../hooks/useTheme";
import { resolveDiffThemeName, type DiffThemeName } from "../lib/diffRendering";

// Grammars preloaded into the workers at boot. Without this the first visible
// file waits on a per-language grammar load before it can highlight, which the
// user sees as rows of empty placeholder lines.
const PRELOADED_DIFF_LANGUAGES = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "css",
  "markdown",
];

function DiffWorkerThemeSync({ themeName }: { themeName: DiffThemeName }) {
  const workerPool = useWorkerPool();

  useEffect(() => {
    if (!workerPool) {
      return;
    }

    const current = workerPool.getDiffRenderOptions();
    if (current.theme === themeName) {
      return;
    }

    void workerPool
      .setRenderOptions({
        ...current,
        theme: themeName,
      })
      .catch(() => undefined);
  }, [themeName, workerPool]);

  return null;
}

export function DiffWorkerPoolProvider({ children }: { children?: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  const workerPoolSize = useMemo(() => {
    const cores =
      typeof navigator === "undefined" ? 4 : Math.max(1, navigator.hardwareConcurrency || 4);
    return Math.max(2, Math.min(6, Math.floor(cores / 2)));
  }, []);

  return (
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory: () => new DiffsWorker(),
        poolSize: workerPoolSize,
        totalASTLRUCacheSize: 240,
      }}
      highlighterOptions={{
        theme: diffThemeName,
        tokenizeMaxLineLength: 1_000,
        langs: PRELOADED_DIFF_LANGUAGES,
      }}
    >
      <DiffWorkerThemeSync themeName={diffThemeName} />
      {children}
    </WorkerPoolContextProvider>
  );
}

// Keeps the diff worker pool warm for the whole app session. Mounted once in
// the chat route layout. The pool is a module singleton that @pierre/diffs
// boots on first provider mount and TERMINATES when the last provider
// unmounts, so without this keeper every first open of the diff panel pays the
// full cold boot (spawn workers, load the highlighter WASM, fetch grammars)
// mid-open — rendered as a block of empty placeholder rows — and closing the
// pane throws the warm pool away again.
//
// Mounting is deferred to idle so the boot never competes with app startup.
export function DiffWorkerPoolWarmup() {
  const [shouldMountPool, setShouldMountPool] = useState(false);

  useEffect(() => {
    const warmUp = () => {
      setShouldMountPool(true);
      // Pre-fetch the lazy DiffPanel chunk too, so the first open renders the
      // panel immediately instead of a suspense fallback mid-slide.
      void import("./DiffPanel").catch(() => undefined);
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(warmUp, { timeout: 3000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(warmUp, 1000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!shouldMountPool) {
    return null;
  }
  return <DiffWorkerPoolProvider />;
}
