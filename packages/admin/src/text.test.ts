import { describe, expect, it } from "vitest";
import { adminTextSources } from "./admin-text-sources.js";
import { labels } from "./languages/es-labels.js";
import { BUILT_IN_LABELS, goodfellowAdminTextSources, languageStatus } from "./text.js";

describe("the admin panel's English for language packs", () => {
  it("lists every string with Goodfellow's own blocks' labels", () => {
    expect([...BUILT_IN_LABELS].sort()).toEqual(Object.keys(labels).sort());
    expect(goodfellowAdminTextSources()).toEqual(adminTextSources(BUILT_IN_LABELS));
  });

  it("counts an empty language as missing everything", () => {
    const sources = goodfellowAdminTextSources();
    const status = languageStatus({ version: 1, name: "Français", strings: {}, puck: {}, labels: {} }, sources);
    expect(status.missing).toBe(sources.length);
  });
});
