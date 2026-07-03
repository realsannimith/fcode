// FILE: terminalFileDrop.test.ts
// Purpose: Covers path resolution and paste payload building for terminal file drops.
// Layer: Web terminal support lib tests

import { describe, expect, it } from "vitest";

import { resolveDroppedFilePaths, terminalPasteTextForPaths } from "./terminalFileDrop";

describe("resolveDroppedFilePaths", () => {
  const screenshot = new File(["png"], "Screenshot.png", { type: "image/png" });
  const pageImage = new File(["png"], "web-image.png", { type: "image/png" });

  it("maps files to their bridge-resolved paths", () => {
    const paths = resolveDroppedFilePaths([screenshot], () => "/tmp/Screenshot.png");

    expect(paths).toEqual(["/tmp/Screenshot.png"]);
  });

  it("skips files the bridge cannot resolve", () => {
    const paths = resolveDroppedFilePaths([screenshot, pageImage], (file) =>
      file === screenshot ? "/tmp/Screenshot.png" : "",
    );

    expect(paths).toEqual(["/tmp/Screenshot.png"]);
  });

  it("skips files whose resolution throws", () => {
    const paths = resolveDroppedFilePaths([screenshot], () => {
      throw new Error("no path");
    });

    expect(paths).toEqual([]);
  });

  it("returns nothing without a bridge resolver", () => {
    expect(resolveDroppedFilePaths([screenshot], undefined)).toEqual([]);
  });
});

describe("terminalPasteTextForPaths", () => {
  it("returns an empty payload for no paths", () => {
    expect(terminalPasteTextForPaths([])).toBe("");
  });

  it("keeps safe paths readable and appends a trailing space", () => {
    expect(terminalPasteTextForPaths(["/tmp/shot.png"])).toBe("/tmp/shot.png ");
  });

  it("shell-quotes paths with spaces and joins multiple paths", () => {
    expect(terminalPasteTextForPaths(["/tmp/Screen Shot.png", "/tmp/b.png"])).toBe(
      "'/tmp/Screen Shot.png' /tmp/b.png ",
    );
  });
});
