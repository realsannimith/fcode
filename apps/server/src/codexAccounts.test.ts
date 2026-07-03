import assert from "node:assert/strict";
import {
  mkdtempSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  CODEX_SHADOW_HOME_MARKER_FILE,
  materializeCodexAccountShadowHome,
  prepareCodexAccountHome,
  rematerializeCodexShadowHomeIfMarked,
  resolveCodexAccountHome,
  resolveCodexAccountShadowHomePath,
} from "./codexAccounts.ts";

let root: string;
let sharedHomePath: string;
let shadowHomePath: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "codex-accounts-test-"));
  sharedHomePath = path.join(root, ".codex");
  shadowHomePath = path.join(root, ".codex-accounts", "work");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const account = (
  overrides: Partial<{ id: string; label: string; shadowHomePath: string }> = {},
) => ({
  id: "work",
  label: "Work",
  shadowHomePath: "",
  ...overrides,
});

describe("resolveCodexAccountShadowHomePath", () => {
  it("derives `<sharedHome>-accounts/<id>` when no explicit path is set", () => {
    assert.equal(
      resolveCodexAccountShadowHomePath("/users/me/.codex", account()),
      path.join("/users/me", ".codex-accounts", "work"),
    );
  });

  it("prefers the explicit shadow home path", () => {
    assert.equal(
      resolveCodexAccountShadowHomePath("/users/me/.codex", account({ shadowHomePath: "/x/y" })),
      path.resolve("/x/y"),
    );
  });
});

describe("resolveCodexAccountHome", () => {
  const settings = {
    homePath: "",
    accounts: [account()],
  };

  it("selects the shared home for the primary account", () => {
    const resolved = resolveCodexAccountHome(settings, undefined, { CODEX_HOME: sharedHomePath });
    assert.ok(resolved);
    assert.equal(resolved.effectiveHomePath, path.resolve(sharedHomePath));
    assert.equal(resolved.account, undefined);
  });

  it("selects the shadow home for a configured account", () => {
    const resolved = resolveCodexAccountHome(settings, "work", { CODEX_HOME: sharedHomePath });
    assert.ok(resolved);
    assert.equal(
      resolved.effectiveHomePath,
      `${path.resolve(sharedHomePath)}-accounts${path.sep}work`,
    );
    assert.equal(resolved.account?.id, "work");
  });

  it("returns undefined for unknown accounts", () => {
    assert.equal(
      resolveCodexAccountHome(settings, "nope", { CODEX_HOME: sharedHomePath }),
      undefined,
    );
  });
});

describe("materializeCodexAccountShadowHome", () => {
  it("symlinks shared state and keeps auth.json private", () => {
    mkdirSync(sharedHomePath, { recursive: true });
    writeFileSync(path.join(sharedHomePath, "config.toml"), 'model = "gpt-5"\n', "utf8");
    writeFileSync(path.join(sharedHomePath, "auth.json"), '{"shared":true}\n', "utf8");

    const result = materializeCodexAccountShadowHome({ sharedHomePath, shadowHomePath });
    assert.ok(result.ok);

    // Shared directories exist in the shared home and are symlinked into the shadow.
    for (const entry of ["sessions", "sqlite", "config.toml"]) {
      const linkPath = path.join(shadowHomePath, entry);
      assert.ok(lstatSync(linkPath).isSymbolicLink(), `${entry} should be a symlink`);
      assert.equal(readlinkSync(linkPath), path.join(sharedHomePath, entry));
    }

    // auth.json must NOT be symlinked — each account keeps its own login.
    assert.equal(existsSync(path.join(shadowHomePath, "auth.json")), false);
    assert.ok(existsSync(path.join(shadowHomePath, CODEX_SHADOW_HOME_MARKER_FILE)));
  });

  it("is idempotent and removes a rogue auth.json symlink", () => {
    mkdirSync(sharedHomePath, { recursive: true });
    writeFileSync(path.join(sharedHomePath, "auth.json"), "{}\n", "utf8");
    assert.ok(materializeCodexAccountShadowHome({ sharedHomePath, shadowHomePath }).ok);

    // Simulate a copied/symlinked login that would silently share the account.
    symlinkSync(path.join(sharedHomePath, "auth.json"), path.join(shadowHomePath, "auth.json"));
    const result = materializeCodexAccountShadowHome({ sharedHomePath, shadowHomePath });
    assert.ok(result.ok);
    assert.equal(existsSync(path.join(shadowHomePath, "auth.json")), false);
  });

  it("preserves a real auth.json in the shadow home", () => {
    mkdirSync(shadowHomePath, { recursive: true });
    writeFileSync(path.join(shadowHomePath, "auth.json"), '{"account":"work"}\n', "utf8");

    const result = materializeCodexAccountShadowHome({ sharedHomePath, shadowHomePath });
    assert.ok(result.ok);
    assert.ok(lstatSync(path.join(shadowHomePath, "auth.json")).isFile());
  });

  it("repoints symlinks after the shared home moves", () => {
    const oldShared = path.join(root, ".codex-old");
    mkdirSync(oldShared, { recursive: true });
    assert.ok(materializeCodexAccountShadowHome({ sharedHomePath: oldShared, shadowHomePath }).ok);

    const result = materializeCodexAccountShadowHome({ sharedHomePath, shadowHomePath });
    assert.ok(result.ok);
    assert.equal(
      readlinkSync(path.join(shadowHomePath, "sessions")),
      path.join(sharedHomePath, "sessions"),
    );
  });

  it("warns about real entries shadowing shared state without touching them", () => {
    mkdirSync(path.join(shadowHomePath, "sessions"), { recursive: true });
    const result = materializeCodexAccountShadowHome({ sharedHomePath, shadowHomePath });
    assert.ok(result.ok);
    assert.ok(result.warnings.some((warning) => warning.includes("sessions")));
    assert.equal(lstatSync(path.join(shadowHomePath, "sessions")).isSymbolicLink(), false);
  });

  it("refuses a shadow home equal to or inside the shared home", () => {
    assert.equal(
      materializeCodexAccountShadowHome({ sharedHomePath, shadowHomePath: sharedHomePath }).ok,
      false,
    );
    assert.equal(
      materializeCodexAccountShadowHome({
        sharedHomePath,
        shadowHomePath: path.join(sharedHomePath, "nested"),
      }).ok,
      false,
    );
  });
});

describe("prepareCodexAccountHome", () => {
  it("materializes the shadow home for a configured account", () => {
    const prepared = prepareCodexAccountHome(
      { homePath: sharedHomePath, accounts: [account()] },
      "work",
      {},
    );
    assert.ok(prepared.ok);
    assert.ok(
      existsSync(path.join(prepared.resolution.effectiveHomePath, CODEX_SHADOW_HOME_MARKER_FILE)),
    );
  });

  it("does not create anything for the primary account", () => {
    const prepared = prepareCodexAccountHome({ homePath: sharedHomePath, accounts: [] }, "", {});
    assert.ok(prepared.ok);
    assert.equal(prepared.resolution.effectiveHomePath, path.resolve(sharedHomePath));
    assert.equal(existsSync(sharedHomePath), false);
  });

  it("fails for unknown account ids", () => {
    const prepared = prepareCodexAccountHome(
      { homePath: sharedHomePath, accounts: [] },
      "ghost",
      {},
    );
    assert.equal(prepared.ok, false);
  });
});

describe("rematerializeCodexShadowHomeIfMarked", () => {
  it("re-syncs symlinks for marked shadow homes", () => {
    mkdirSync(sharedHomePath, { recursive: true });
    assert.ok(materializeCodexAccountShadowHome({ sharedHomePath, shadowHomePath }).ok);

    // A directory created in the shared home later must show up after re-sync.
    mkdirSync(path.join(sharedHomePath, "generated_images"));
    rematerializeCodexShadowHomeIfMarked(shadowHomePath);
    assert.ok(lstatSync(path.join(shadowHomePath, "generated_images")).isSymbolicLink());
  });

  it("ignores homes without a marker", () => {
    mkdirSync(sharedHomePath, { recursive: true });
    rematerializeCodexShadowHomeIfMarked(sharedHomePath);
    assert.equal(existsSync(path.join(sharedHomePath, CODEX_SHADOW_HOME_MARKER_FILE)), false);
  });
});
