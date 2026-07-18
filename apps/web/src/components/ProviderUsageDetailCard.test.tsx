import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { deriveProviderUsageDisplayRows } from "~/lib/providerUsageDisplay";

import { ProviderUsageDetailCard } from "./ProviderUsageDetailCard";

describe("ProviderUsageDetailCard", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders reference-style used quota meters with reset details", () => {
    vi.setSystemTime("2026-07-18T05:00:00.000Z");
    const rows = deriveProviderUsageDisplayRows([
      {
        provider: "codex",
        updatedAt: "2026-07-18T05:00:00.000Z",
        limits: [
          {
            window: "5h",
            usedPercent: 4,
            resetsAt: "2026-07-18T06:42:00.000Z",
            windowDurationMins: 300,
          },
        ],
      },
    ]);

    const markup = renderToStaticMarkup(
      <ProviderUsageDetailCard
        provider="codex"
        rows={rows}
        usageLines={[]}
        learnMoreHref="https://example.com/usage"
      />,
    );

    expect(markup).toContain("Plan usage limits · Codex");
    expect(markup).toContain("5-hour limit");
    expect(markup).toContain("Resets in 1h 42m");
    expect(markup).toContain('aria-label="5-hour limit used"');
    expect(markup).toContain('aria-valuenow="4"');
    expect(markup).toContain('style="width:4%"');
  });
});
