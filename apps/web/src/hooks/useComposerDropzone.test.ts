// FILE: useComposerDropzone.test.ts
// Purpose: Covers file capability decisions for shared composer paste/drop handling.
// Layer: Web hook tests

import { describe, expect, it } from "vitest";

import {
  COMPOSER_DROP_IGNORE_ATTRIBUTE,
  isComposerDropzoneInternalDragTransition,
  isInsideIgnoredComposerDropRegion,
  shouldPreventDefaultForUnhandledFileDrop,
  shouldResetComposerDropzoneAfterUnhandledFileDrop,
  shouldHandleComposerDropzoneFiles,
  splitComposerDropzoneFiles,
} from "./useComposerDropzone";

describe("useComposerDropzone file capability helpers", () => {
  it("splits image files from generic files", () => {
    const image = new File(["image"], "image.png", { type: "image/png" });
    const generic = new File(["text"], "notes.txt", { type: "text/plain" });

    expect(splitComposerDropzoneFiles([image, generic])).toEqual({
      imageFiles: [image],
      genericFiles: [generic],
    });
  });

  it("lets unsupported generic-only files fall through when requested", () => {
    const generic = new File(["text"], "notes.txt", { type: "text/plain" });
    const files = splitComposerDropzoneFiles([generic]);

    expect(shouldHandleComposerDropzoneFiles(files, "fallthrough")).toBe(false);
  });

  it("handles generic-only files when the consumer rejects them visibly", () => {
    const generic = new File(["text"], "notes.txt", { type: "text/plain" });
    const files = splitComposerDropzoneFiles([generic]);

    expect(shouldHandleComposerDropzoneFiles(files, "reject")).toBe(true);
  });

  it("resets drag state for unusable file drops", () => {
    const files = splitComposerDropzoneFiles([]);

    expect(shouldResetComposerDropzoneAfterUnhandledFileDrop(files, "accept")).toBe(true);
  });

  it("prevents default for claimed unusable file drops", () => {
    const files = splitComposerDropzoneFiles([]);

    expect(shouldPreventDefaultForUnhandledFileDrop(files, "accept")).toBe(true);
    expect(shouldPreventDefaultForUnhandledFileDrop(files, "reject")).toBe(true);
    expect(shouldPreventDefaultForUnhandledFileDrop(files, "fallthrough")).toBe(false);
  });

  it("identifies child drag transitions as internal to the dropzone", () => {
    const child = {};
    const outside = {};
    const currentTarget = {
      contains: (target: unknown) => target === child,
    };

    expect(isComposerDropzoneInternalDragTransition(currentTarget, child)).toBe(true);
    expect(isComposerDropzoneInternalDragTransition(currentTarget, outside)).toBe(false);
    expect(isComposerDropzoneInternalDragTransition(currentTarget, null)).toBe(false);
  });

  it("treats transitions into opted-out regions as leaving the dropzone", () => {
    const ignoredChild = {
      closest: (selector: string) =>
        selector === `[${COMPOSER_DROP_IGNORE_ATTRIBUTE}]` ? {} : null,
    };
    const plainChild = {
      closest: () => null,
    };
    const currentTarget = {
      contains: () => true,
    };

    expect(isInsideIgnoredComposerDropRegion(ignoredChild)).toBe(true);
    expect(isInsideIgnoredComposerDropRegion(plainChild)).toBe(false);
    expect(isInsideIgnoredComposerDropRegion(null)).toBe(false);

    expect(isComposerDropzoneInternalDragTransition(currentTarget, ignoredChild)).toBe(false);
    expect(isComposerDropzoneInternalDragTransition(currentTarget, plainChild)).toBe(true);
  });
});
