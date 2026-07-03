// FILE: pageControllerInjectionEntry.ts
// Purpose: Entry point bundled into the in-page browser-use runtime. Exposes
//   @page-agent/page-controller's indexed-element API on a window global that
//   BrowserUseSession drives via CDP Runtime.evaluate.
// Layer: Build-time asset source (see buildPageControllerInjection.mjs)
// Depends on: @page-agent/page-controller

import { PageController } from "@page-agent/page-controller";

interface FCodeConsoleEntry {
  level: string;
  text: string;
}

interface FCodeBrowserUseRuntime {
  version: number;
  getBrowserState: () => Promise<unknown>;
  clickElement: (index: number) => Promise<unknown>;
  inputText: (index: number, text: string) => Promise<unknown>;
  selectOption: (index: number, optionText: string) => Promise<unknown>;
  scroll: (options: {
    down: boolean;
    numPages: number;
    pixels?: number;
    index?: number;
  }) => Promise<unknown>;
  drainConsole: () => FCodeConsoleEntry[];
  // Renders the agent cursor at viewport coordinates; `click` adds a ripple.
  showCursor: (x: number, y: number, click: boolean) => void;
}

declare global {
  interface Window {
    __fcodeBrowserUse?: FCodeBrowserUseRuntime;
  }
}

// Keep in sync with FCODE_PAGE_CONTROLLER_INJECTION_VERSION written by
// buildPageControllerInjection.mjs.
const FCODE_BROWSER_USE_RUNTIME_VERSION = 3;
// FCode's Claude brand accent (the `--claude` clay in the web app's theme). The
// agent cursor uses it so automation reads as "FCode is acting" on any page.
const FCODE_CURSOR_ACCENT = "#d97757";
const FCODE_CURSOR_ACCENT_DARK = "#b45f42";
const FCODE_CURSOR_FADE_MS = 1_500;
const CONSOLE_BUFFER_LIMIT = 200;
const CONSOLE_TEXT_LIMIT = 2_000;
const HOOKED_CONSOLE_LEVELS = ["log", "info", "warn", "error", "debug"] as const;

function formatConsoleArgument(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// Console capture lives in the page (not on the CDP event stream) so it keeps
// working when the tab's native runtime is suspended and recreated between
// agent commands.
function installConsoleCapture(): FCodeBrowserUseRuntime["drainConsole"] {
  const buffer: FCodeConsoleEntry[] = [];
  const push = (level: string, text: string) => {
    buffer.push({ level, text: text.slice(0, CONSOLE_TEXT_LIMIT) });
    if (buffer.length > CONSOLE_BUFFER_LIMIT) {
      buffer.splice(0, buffer.length - CONSOLE_BUFFER_LIMIT);
    }
  };

  for (const level of HOOKED_CONSOLE_LEVELS) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      push(level, args.map((argument) => formatConsoleArgument(argument)).join(" "));
      original(...args);
    };
  }
  window.addEventListener("error", (event) => {
    push(
      "error",
      event.error instanceof Error ? (event.error.stack ?? event.message) : event.message,
    );
  });
  window.addEventListener("unhandledrejection", (event) => {
    push("error", `Unhandled promise rejection: ${formatConsoleArgument(event.reason)}`);
  });

  return () => buffer.splice(0);
}

// A passive, on-brand cursor overlay that shows where the agent is acting. It
// never captures input (pointer-events: none) so the user can keep interacting —
// unlike page-agent's SimulatorMask, which blocks the page during automation.
function installAgentCursor(): FCodeBrowserUseRuntime["showCursor"] {
  const prefersDark =
    typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  const accent = prefersDark ? FCODE_CURSOR_ACCENT_DARK : FCODE_CURSOR_ACCENT;

  const root = document.createElement("div");
  root.setAttribute("data-fcode-agent-cursor", "true");
  // Ignored by the page-controller DOM scan so it never becomes a click target.
  root.setAttribute("data-page-agent-ignore", "true");
  root.setAttribute("data-browser-use-ignore", "true");
  Object.assign(root.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "26px",
    height: "26px",
    pointerEvents: "none",
    zIndex: "2147483647",
    opacity: "0",
    transform: "translate(-4px, -2px)",
    transition: `opacity 200ms ease, left 120ms ease-out, top 120ms ease-out`,
    willChange: "left, top, opacity",
  });
  // Arrow pointer tinted with the brand accent + a soft glow.
  root.innerHTML = `
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
         style="filter: drop-shadow(0 1px 3px rgba(0,0,0,0.35));">
      <path d="M5 3l14 7-6 1.5L10 18z" fill="${accent}" stroke="white" stroke-width="1.4"
            stroke-linejoin="round"/>
    </svg>
    <span data-ripple style="position:absolute;left:2px;top:2px;width:6px;height:6px;
      border:2px solid ${accent};border-radius:50%;opacity:0;transform:scale(0);"></span>`;

  const attach = () => {
    if (document.body && !root.isConnected) {
      document.body.appendChild(root);
    }
  };
  attach();
  if (!root.isConnected) {
    document.addEventListener("DOMContentLoaded", attach, { once: true });
  }

  const ripple = root.querySelector("[data-ripple]") as HTMLElement | null;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;

  return (x: number, y: number, click: boolean) => {
    attach();
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
    root.style.opacity = "1";
    if (click && ripple) {
      ripple.style.transition = "none";
      ripple.style.transform = "scale(0)";
      ripple.style.opacity = "1";
      // Force reflow so the animation restarts on repeated clicks.
      void ripple.offsetWidth;
      ripple.style.transition = "transform 400ms ease-out, opacity 400ms ease-out";
      ripple.style.transform = "scale(3.2)";
      ripple.style.opacity = "0";
    }
    if (fadeTimer) {
      clearTimeout(fadeTimer);
    }
    fadeTimer = setTimeout(() => {
      root.style.opacity = "0";
    }, FCODE_CURSOR_FADE_MS);
  };
}

if (window.__fcodeBrowserUse?.version !== FCODE_BROWSER_USE_RUNTIME_VERSION) {
  const controller = new PageController({ enableMask: false });
  const drainConsole = installConsoleCapture();
  const showCursor = installAgentCursor();
  // Surface the cursor at an indexed element's on-screen center before clicking
  // it. page-controller keeps element refs only in its private `selectorMap`, so
  // this reads that field defensively — the cursor is decorative and silently
  // no-ops if the library ever renames it.
  const cursorForIndex = (index: number) => {
    try {
      const selectorMap = (
        controller as unknown as {
          selectorMap?: Map<number, { ref?: Element }>;
        }
      ).selectorMap;
      const ref = selectorMap?.get(index)?.ref;
      const rect = ref?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        showCursor(rect.left + rect.width / 2, rect.top + rect.height / 2, true);
      }
    } catch {
      // Never let the decorative cursor block the actual action.
    }
  };
  const clickElementWithCursor = (index: number) => {
    cursorForIndex(index);
    return controller.clickElement(index);
  };
  const inputTextWithCursor = (index: number, text: string) => {
    cursorForIndex(index);
    return controller.inputText(index, text);
  };
  window.__fcodeBrowserUse = {
    version: FCODE_BROWSER_USE_RUNTIME_VERSION,
    getBrowserState: () => controller.getBrowserState(),
    clickElement: (index) => clickElementWithCursor(index),
    inputText: (index, text) => inputTextWithCursor(index, text),
    selectOption: (index, optionText) => controller.selectOption(index, optionText),
    scroll: (options) => controller.scroll(options),
    drainConsole,
    showCursor,
  };
}
