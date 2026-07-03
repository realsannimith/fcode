// FILE: pdfSkill.test.ts
// Purpose: Guards the materialized `pdf` skill artifact (layout, frontmatter, catalog visibility).
// Layer: Server test
// Depends on: Vitest, a temp FCode base dir, and the skills-catalog parser

import * as fs from "node:fs/promises";
import * as OS from "node:os";
import * as nodePath from "node:path";

import { describe, expect, it } from "vitest";

import { materializePdfSkill, PDF_SKILL_NAME } from "./pdfSkill.ts";
import { readSkillDescriptor } from "./skillsCatalog.ts";

async function makeTempBaseDir(): Promise<string> {
  return fs.mkdtemp(nodePath.join(OS.tmpdir(), "fcode-pdf-skill-test-"));
}

describe("materializePdfSkill", () => {
  it("writes SKILL.md into the portable skills folder", async () => {
    const baseDir = await makeTempBaseDir();

    const skillDir = await materializePdfSkill({ fcodeBaseDir: baseDir });

    expect(skillDir).toBe(nodePath.join(baseDir, "skills", PDF_SKILL_NAME));

    const skillMarkdown = await fs.readFile(nodePath.join(skillDir, "SKILL.md"), "utf8");
    expect(skillMarkdown).toContain("name: pdf");
    expect(skillMarkdown).toContain("# PDF Processing Guide");
    // Code fences embed backticks; a bad escape would corrupt the emitted file.
    expect(skillMarkdown).toContain("from pypdf import PdfReader, PdfWriter");
  });

  it("parses as a valid, model-invokable catalog skill", async () => {
    const baseDir = await makeTempBaseDir();
    const skillDir = await materializePdfSkill({ fcodeBaseDir: baseDir });

    const descriptor = await readSkillDescriptor({
      skillPath: nodePath.join(skillDir, "SKILL.md"),
      scope: "fcode",
    });

    expect(descriptor).not.toBeNull();
    expect(descriptor!.name).toBe("pdf");
    // Enabled by default so every provider agent gets it out of the box; users
    // opt out from Settings → Skills, which adds it to `skills.disabled`.
    expect(descriptor!.enabled).toBe(true);
    expect(descriptor!.description ?? "").toContain("PDF");
  });

  it("is idempotent across repeated boots", async () => {
    const baseDir = await makeTempBaseDir();

    const first = await materializePdfSkill({ fcodeBaseDir: baseDir });
    const second = await materializePdfSkill({ fcodeBaseDir: baseDir });

    expect(second).toBe(first);
    const entries = await fs.readdir(nodePath.join(baseDir, "skills"));
    expect(entries).toEqual([PDF_SKILL_NAME]);
  });
});
