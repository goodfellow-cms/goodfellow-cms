import { describe, expect, it } from "vitest";
import { frameRequest } from "./frames.js";

describe("frameRequest", () => {
  const player = "https://www.youtube-nocookie.com/embed/abc";

  it("stays on the frame's site, on iOS and Android alike", () => {
    expect(frameRequest(player, { url: "https://www.youtube-nocookie.com/embed/def", isTopFrame: true })).toBe("stay");
    expect(frameRequest(player, { url: "https://www.youtube-nocookie.com/embed/def" })).toBe("stay");
    // A frame inside it, which only iOS asks about.
    expect(frameRequest(player, { url: "https://ads.example.com/", isTopFrame: false })).toBe("stay");
  });

  it("opens other web pages in the browser, Android included", () => {
    expect(frameRequest(player, { url: "https://www.youtube.com/watch?v=abc" })).toBe("open");
    expect(frameRequest(player, { url: "https://www.youtube.com/watch?v=abc", isTopFrame: true })).toBe("open");
  });

  it("refuses to call, write or open other apps", () => {
    for (const url of [
      "tel:5550100",
      "mailto:a@example.org",
      "intent://scan/#Intent;scheme=zxing;end",
      "sms:5550100",
    ]) {
      expect(frameRequest(player, { url }), url).toBe("refuse");
    }
  });
});
