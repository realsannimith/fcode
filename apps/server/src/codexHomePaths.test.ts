import assert from "node:assert/strict";
import { homedir } from "node:os";
import path from "node:path";
import { describe, it } from "vitest";

import {
  expandHomePath,
  resolveActiveCodexHomeWritePath,
  resolveBaseCodexHomePath,
  resolveCodexHomeAllowlistCandidates,
  resolveDpCodeCodexHomeOverlayPath,
  shouldDisableDpCodeBrowserPlugin,
} from "./codexHomePaths.ts";

describe("expandHomePath", () => {
  it("expands a bare tilde to the home directory", () => {
    assert.equal(expandHomePath("~"), homedir());
  });

  it("expands a tilde-prefixed path", () => {
    assert.equal(
      expandHomePath("~/.codex-accounts/work"),
      path.join(homedir(), ".codex-accounts", "work"),
    );
  });

  it("leaves absolute and relative paths untouched", () => {
    assert.equal(expandHomePath("/users/me/.codex"), "/users/me/.codex");
    assert.equal(expandHomePath("relative/path"), "relative/path");
  });
});

describe("resolveBaseCodexHomePath", () => {
  it("prefers the explicit home path over CODEX_HOME and the default", () => {
    assert.equal(
      resolveBaseCodexHomePath({ CODEX_HOME: "/env/codex" }, "/explicit/codex"),
      "/explicit/codex",
    );
  });

  it("falls back to CODEX_HOME when no explicit home is supplied", () => {
    assert.equal(resolveBaseCodexHomePath({ CODEX_HOME: "/env/codex" }), "/env/codex");
  });

  it("falls back to ~/.codex when nothing is provided", () => {
    const result = resolveBaseCodexHomePath({});
    assert.ok(result.endsWith(`${path.sep}.codex`));
  });

  it("expands tilde-prefixed explicit home paths", () => {
    assert.equal(
      resolveBaseCodexHomePath({}, "~/.codex-work"),
      path.join(homedir(), ".codex-work"),
    );
  });
});

describe("resolveDpCodeCodexHomeOverlayPath", () => {
  it("anchors the overlay under FCODE_HOME when set", () => {
    assert.equal(
      resolveDpCodeCodexHomeOverlayPath(
        { FCODE_HOME: "/fcode/runtime", CODEX_HOME: "/users/me/.codex" },
        "/users/me/.codex",
      ),
      path.join("/fcode/runtime", "codex-home-overlay"),
    );
  });

  it("honours the legacy DPCODE_HOME variable", () => {
    assert.equal(
      resolveDpCodeCodexHomeOverlayPath(
        { DPCODE_HOME: "/dp/runtime", CODEX_HOME: "/users/me/.codex" },
        "/users/me/.codex",
      ),
      path.join("/dp/runtime", "codex-home-overlay"),
    );
  });

  it("honours the legacy T3CODE_HOME variable", () => {
    assert.equal(
      resolveDpCodeCodexHomeOverlayPath(
        { T3CODE_HOME: "/t3/runtime", CODEX_HOME: "/users/me/.codex" },
        "/users/me/.codex",
      ),
      path.join("/t3/runtime", "codex-home-overlay"),
    );
  });

  it("derives a default overlay sibling of the source home", () => {
    assert.equal(
      resolveDpCodeCodexHomeOverlayPath({ CODEX_HOME: "/users/me/.codex" }, "/users/me/.codex"),
      path.join("/users/me", ".fcode", "runtime", "codex-home-overlay"),
    );
  });

  it("suffixes the overlay directory for non-default source homes", () => {
    const env = { FCODE_HOME: "/fcode/runtime", CODEX_HOME: "/users/me/.codex" };
    const defaultOverlay = resolveDpCodeCodexHomeOverlayPath(env, "/users/me/.codex");
    const accountOverlay = resolveDpCodeCodexHomeOverlayPath(env, "/users/me/.codex-accounts/work");
    const otherAccountOverlay = resolveDpCodeCodexHomeOverlayPath(
      env,
      "/users/me/.codex-accounts/personal",
    );

    assert.notEqual(accountOverlay, defaultOverlay);
    assert.notEqual(accountOverlay, otherAccountOverlay);
    assert.ok(path.basename(accountOverlay).startsWith("codex-home-overlay-"));
    // Stable across calls so persisted state keeps resolving to the same dir.
    assert.equal(
      accountOverlay,
      resolveDpCodeCodexHomeOverlayPath(env, "/users/me/.codex-accounts/work"),
    );
  });
});

describe("shouldDisableDpCodeBrowserPlugin", () => {
  it("disables the plugin (overlay active) by default", () => {
    assert.equal(shouldDisableDpCodeBrowserPlugin({}), true);
  });

  it("respects the explicit '0' opt-out", () => {
    assert.equal(
      shouldDisableDpCodeBrowserPlugin({ DPCODE_DISABLE_CODEX_DPCODE_BROWSER_PLUGIN: "0" }),
      false,
    );
  });
});

describe("resolveActiveCodexHomeWritePath", () => {
  it("returns the overlay home when the plugin is disabled (default)", () => {
    assert.equal(
      resolveActiveCodexHomeWritePath({
        env: { FCODE_HOME: "/fcode/runtime", CODEX_HOME: "/users/me/.codex" },
        homePath: "/users/me/.codex",
      }),
      path.join("/fcode/runtime", "codex-home-overlay"),
    );
  });

  it("returns the source home when the plugin is explicitly enabled", () => {
    assert.equal(
      resolveActiveCodexHomeWritePath({
        env: {
          DPCODE_HOME: "/dp/runtime",
          DPCODE_DISABLE_CODEX_DPCODE_BROWSER_PLUGIN: "0",
        },
        homePath: "/users/me/.codex",
      }),
      "/users/me/.codex",
    );
  });
});

describe("resolveCodexHomeAllowlistCandidates", () => {
  it("includes both source and overlay homes when distinct", () => {
    const candidates = resolveCodexHomeAllowlistCandidates({
      env: { FCODE_HOME: "/fcode/runtime", CODEX_HOME: "/users/me/.codex" },
      homePath: "/users/me/.codex",
    });
    assert.deepEqual(candidates, [
      "/users/me/.codex",
      path.join("/fcode/runtime", "codex-home-overlay"),
    ]);
  });

  it("returns just the source when overlay equals source", () => {
    const source = path.join("/users/me", "codex-home-overlay");
    const candidates = resolveCodexHomeAllowlistCandidates({
      env: { DPCODE_HOME: "/users/me", CODEX_HOME: source },
      homePath: source,
    });
    assert.deepEqual(candidates, [source]);
  });
});
