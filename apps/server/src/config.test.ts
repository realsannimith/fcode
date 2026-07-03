// FILE: config.test.ts
// Purpose: Verifies pure server configuration path derivation helpers.

import { describe, expect, it } from "vitest";

import { resolveDefaultChatWorkspaceRoot } from "./config";

describe("resolveDefaultChatWorkspaceRoot", () => {
  it("places the managed chat workspace under Documents/FCode on macOS and Linux", () => {
    expect(
      resolveDefaultChatWorkspaceRoot({
        homeDir: "/Users/tester",
        platform: "darwin",
      }),
    ).toBe("/Users/tester/Documents/FCode");
    expect(
      resolveDefaultChatWorkspaceRoot({
        homeDir: "/home/tester",
        platform: "linux",
      }),
    ).toBe("/home/tester/Documents/FCode");
  });

  it("uses Windows separators when deriving the managed chat workspace on Windows", () => {
    expect(
      resolveDefaultChatWorkspaceRoot({
        homeDir: "C:\\Users\\tester",
        platform: "win32",
      }),
    ).toBe("C:\\Users\\tester\\Documents\\FCode");
  });

  it("defaults to the current process platform when no platform is supplied", () => {
    const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    try {
      expect(resolveDefaultChatWorkspaceRoot({ homeDir: "C:\\Users\\tester" })).toBe(
        "C:\\Users\\tester\\Documents\\FCode",
      );
    } finally {
      Object.defineProperty(process, "platform", originalPlatformDescriptor!);
    }
  });
});
