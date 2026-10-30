import { describe, expect, it } from "vitest";
import { movedPageRedirects } from "./changes.js";

describe("movedPageRedirects", () => {
  it("points redirects to the old address at the new one however they write it, keeping what's after it", () => {
    expect(
      movedPageRedirects(
        [
          { from: "/a", to: "/old" },
          { from: "/b", to: "/old/" },
          { from: "/c", to: "/old?ref=menu" },
          { from: "/d", to: "/old#times" },
          { from: "/e", to: "/older" },
          { from: "/f", to: "https://example.org/old" },
        ],
        "/old",
        "/new",
      ),
    ).toEqual([
      { from: "/a", to: "/new" },
      { from: "/b", to: "/new" },
      { from: "/c", to: "/new?ref=menu" },
      { from: "/d", to: "/new#times" },
      { from: "/e", to: "/older" },
      { from: "/f", to: "https://example.org/old" },
      { from: "/old", to: "/new" },
    ]);
  });
});
