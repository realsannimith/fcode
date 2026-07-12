// FILE: browserUsePrompt.ts
// Purpose: Builds cross-provider prompt context for FCode's in-app browser skill.
// Layer: Provider prompt helper

import * as fs from "node:fs/promises";
import * as nodePath from "node:path";

import type { ProviderKind, ProviderSkillReference } from "@t3tools/contracts";
import { readBrowserUsePipePathFromEnv } from "@t3tools/shared/browserUsePipe";

import { BROWSER_USE_SKILL_NAME } from "../browserUse/browserUseSkill.ts";
import { buildInlineSkillInstructions } from "./skillPromptInjection.ts";
import { fcodeSkillsDir } from "./skillsCatalog.ts";

const MAX_BROWSER_SKILL_CONTENT_CHARS = 18_000;

const FCODE_BROWSER_ROUTING_PROMPT = [
  "FCode has a built-in in-app browser panel the user can see live.",
  "Use the `fcode-browser` skill whenever a task calls for browsing, previewing a local dev server, taking a browser screenshot, reading a page, clicking, typing, or inspecting page console output.",
  "Prefer this in-app browser over external browsers, Playwright, headless fetches, or OS-level `open` commands for interactive web tasks so the user can follow along.",
].join("\n");

// Providers that natively discover the FCode skills dir (Codex registers it via
// skills/extraRoots/set) already load the skill content themselves; they only
// need the routing nudge. Claude is excluded entirely — its adapter exposes the
// browser through a dedicated MCP server instead of this prompt.
const NATIVE_FCODE_SKILL_DISCOVERY_PROVIDERS: ReadonlySet<ProviderKind> = new Set(["codex"]);

function browserSkillPath(fcodeBaseDir: string): string {
  return nodePath.join(fcodeSkillsDir(fcodeBaseDir), BROWSER_USE_SKILL_NAME, "SKILL.md");
}

function isBrowserSkillReference(skill: ProviderSkillReference): boolean {
  return skill.name.trim().toLowerCase() === BROWSER_USE_SKILL_NAME;
}

async function readBrowserSkillBlock(input: {
  readonly fcodeBaseDir: string;
  readonly maxChars: number;
}): Promise<string> {
  const skillPath = browserSkillPath(input.fcodeBaseDir);
  let content: string;
  try {
    content = await fs.readFile(skillPath, "utf8");
  } catch {
    return `The browser skill should be available at ${skillPath}. If that file is missing, tell the user FCode has not finished publishing the browser skill yet.`;
  }

  let trimmed = content.trim();
  const contentLimit = Math.max(0, Math.min(input.maxChars, MAX_BROWSER_SKILL_CONTENT_CHARS));
  if (trimmed.length > contentLimit) {
    trimmed = `${trimmed.slice(0, contentLimit)}\n[skill content truncated]`;
  }

  return `<skill name=${JSON.stringify(BROWSER_USE_SKILL_NAME)} dir=${JSON.stringify(
    nodePath.dirname(skillPath),
  )}>\n${trimmed}\n</skill>`;
}

export async function buildProviderBrowserAndSkillPrompt(input: {
  readonly provider: ProviderKind;
  readonly fcodeBaseDir: string;
  readonly skills: ReadonlyArray<ProviderSkillReference> | undefined;
  readonly maxChars: number;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<string> {
  const selectedSkills = input.skills ?? [];
  const inlineSkillPrompt = await buildInlineSkillInstructions({
    provider: input.provider,
    skills: selectedSkills,
    maxChars: input.maxChars,
  });
  const remainingChars = Math.max(0, input.maxChars - inlineSkillPrompt.length);
  const browserPipeAvailable = Boolean(readBrowserUsePipePathFromEnv(input.env ?? process.env));
  const shouldInjectBrowserSkill =
    browserPipeAvailable &&
    remainingChars > FCODE_BROWSER_ROUTING_PROMPT.length + 256 &&
    !selectedSkills.some(isBrowserSkillReference);

  if (!shouldInjectBrowserSkill) {
    return inlineSkillPrompt;
  }

  const browserSkillPrompt = NATIVE_FCODE_SKILL_DISCOVERY_PROVIDERS.has(input.provider)
    ? FCODE_BROWSER_ROUTING_PROMPT
    : `${FCODE_BROWSER_ROUTING_PROMPT}\n\n${await readBrowserSkillBlock({
        fcodeBaseDir: input.fcodeBaseDir,
        maxChars: remainingChars - FCODE_BROWSER_ROUTING_PROMPT.length,
      })}`;

  return [browserSkillPrompt, inlineSkillPrompt]
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
}
