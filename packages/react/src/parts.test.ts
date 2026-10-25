import { describe, expect, it } from "vitest";
import { partClasses } from "./parts-shared.js";

describe("partClasses", () => {
  it("puts the theme's classes after the block's own and before what an editor chose", () => {
    const part = partClasses({ "gf-card-title": "my-4 rounded-xl" });
    expect(part("gf-card-title", "my-6 rounded-lg", "my-8 mx-4")).toBe("gf-card-title rounded-xl my-8 mx-4");
  });

  it("names the part even without classes of its own or a theme", () => {
    expect(partClasses(undefined)("gf-heading")).toBe("gf-heading");
    expect(partClasses({})("gf-heading", ["text-balance", false, "text-4xl"], undefined, "")).toBe(
      "gf-heading text-balance text-4xl",
    );
  });

  it("gives each part only its own classes", () => {
    const part = partClasses({ "gf-heading": "text-primary" });
    expect(part("gf-text", "text-foreground")).toBe("gf-text text-foreground");
  });
});
