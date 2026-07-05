import { describe, expect, it } from "vitest";

import type { ServerConfigShape } from "../../config.ts";
import { resolveGeminiSessionCwd } from "./GeminiAdapter.ts";

const makeServerConfig = (cwd: string): ServerConfigShape =>
  ({
    cwd,
    homeDir: "/Users/tester",
  }) as ServerConfigShape;

describe("resolveGeminiSessionCwd", () => {
  it("uses the requested cwd when one is provided", () => {
    expect(resolveGeminiSessionCwd("/repo/project", makeServerConfig("/server/cwd"))).toBe(
      "/repo/project",
    );
  });

  it("falls back to the configured server cwd instead of process cwd", () => {
    expect(resolveGeminiSessionCwd(undefined, makeServerConfig("/repo/project"))).toBe(
      "/repo/project",
    );
  });

  it("normalizes relative requested cwd values", () => {
    expect(resolveGeminiSessionCwd("relative-project", makeServerConfig("/repo/project"))).toBe(
      `${process.cwd()}/relative-project`,
    );
  });
});
