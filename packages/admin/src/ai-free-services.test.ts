import { describe, expect, it } from "vitest";
import { FREE_SERVICES, freeCards } from "./ai-panel.js";

describe("freeCards", () => {
  it("offers the free services the site allows, chat apps first, but not the one already chosen", () => {
    expect(freeCards([...FREE_SERVICES, "anthropic", "openai"], "anthropic")).toEqual([
      "manual",
      "ovhcloud",
      "gemini",
      "groq",
      "mistral",
      "openrouter",
    ]);
    expect(freeCards(["anthropic", "gemini", "manual"], "gemini")).toEqual(["manual"]);
    expect(freeCards(["anthropic", "openai"], "anthropic")).toEqual([]);
  });
});
