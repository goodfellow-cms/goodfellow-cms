import { describe, expect, it } from "vitest";
import { appliedClasses } from "./applied-classes.js";

describe("blocks' classes in an app", () => {
  it("applies breakpoints' classes from their width, and max- ones below it", () => {
    const hidden = "flex max-sm:hidden sm:max-lg:hidden lg:hidden";
    expect(appliedClasses(hidden, 360, false)).toEqual(["flex", "hidden"]);
    expect(appliedClasses(hidden, 800, false)).toEqual(["flex", "hidden"]);
    expect(appliedClasses(hidden, 1200, false)).toEqual(["flex", "hidden"]);
    expect(appliedClasses("max-lg:hidden", 1024, false)).toEqual([]);
    expect(appliedClasses("sm:max-lg:hidden", 600, false)).toEqual([]);
    expect(appliedClasses("p-2 md:p-4 hover:p-8", 800, false)).toEqual(["p-2", "p-4"]);
  });
});
