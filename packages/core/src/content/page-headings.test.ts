import { describe, expect, it } from "vitest";
import { headingAnchors } from "./page-headings.js";

describe("headingAnchors", () => {
  it("gives each heading a link name of its own, from what an editor gave it or its text", () => {
    expect(
      headingAnchors(
        [
          { block: "a", text: "Mass times", level: 2 },
          { block: "b", text: "Mass times", level: 3 },
          { block: "c", text: "Getting here", level: 2, anchor: "directions" },
          { block: "d", text: "¡¿?!", level: 2 },
        ],
        ["directions"],
      ),
    ).toEqual([
      { block: "a", anchor: "mass-times", text: "Mass times", level: 2 },
      { block: "b", anchor: "mass-times-2", text: "Mass times", level: 3 },
      { block: "c", anchor: "directions-2", text: "Getting here", level: 2 },
      { block: "d", anchor: "section", text: "¡¿?!", level: 2 },
    ]);
  });
});
