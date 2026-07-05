// FILE: buildPageControllerInjection.mjs
// Purpose: Regenerates the vendored in-page browser-use bundle from
//   @page-agent/page-controller. Run with: bun scripts/buildPageControllerInjection.mjs
// Layer: Build tooling
// Depends on: Bun.build and the pageControllerInjectionEntry entry point

import * as Path from "node:path";

const scriptDir = Path.dirname(new URL(import.meta.url).pathname);
const entry = Path.join(scriptDir, "pageControllerInjectionEntry.ts");
const outFile = Path.join(scriptDir, "..", "src", "browserUse", "pageControllerInjection.gen.ts");

const result = await Bun.build({
  entrypoints: [entry],
  format: "iife",
  target: "browser",
  minify: true,
});

if (!result.success) {
  console.error("Bundle failed:", result.logs);
  process.exit(1);
}

const artifact = result.outputs[0];
if (!artifact) {
  console.error("Bundle produced no output.");
  process.exit(1);
}
const bundleSource = await artifact.text();

const generated = `// FILE: pageControllerInjection.gen.ts
// Purpose: GENERATED in-page browser-use runtime (indexed-element page state and
//   actions from @page-agent/page-controller, MIT). Injected into in-app browser
//   tabs via CDP Runtime.evaluate.
// Layer: Generated asset — DO NOT EDIT.
// Regenerate with: bun scripts/buildPageControllerInjection.mjs

export const FCODE_PAGE_CONTROLLER_INJECTION_VERSION = 4;

// prettier-ignore
export const FCODE_PAGE_CONTROLLER_INJECTION_SOURCE: string = ${JSON.stringify(bundleSource)};
`;

await Bun.write(outFile, generated);
console.log(
  `Wrote ${Path.relative(process.cwd(), outFile)} (${(bundleSource.length / 1024).toFixed(1)} KiB bundle)`,
);
