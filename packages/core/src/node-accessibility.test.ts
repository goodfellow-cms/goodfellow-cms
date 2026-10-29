import { describe, expect, it } from "vitest";
import { checkBuiltPages } from "./node-accessibility.js";

const page = (path: string, file: string, main: string) => ({
  path,
  file,
  html: `<!doctype html><html lang="en"><head><title>Parish</title></head><body><div><header class="gf-header"><a href="/"><img src="/media/logo.svg" alt=""></a></header><main class="gf-main">${main}</main><footer class="gf-footer"><p>Parish</p></footer></div></body></html>`,
});

describe("checkBuiltPages", () => {
  it("lists what built pages have wrong, explained, and the header's problems once", async () => {
    const problems = await checkBuiltPages([
      page(
        "/",
        "content/pages/index.json",
        "<h1>Home</h1><table><tr><th></th><th>Sunday</th></tr><tr><td>Mass</td><td>10:00</td></tr></table>",
      ),
      page("/about", "content/pages/about.json", "<h1>About</h1><h3>History</h3>"),
    ]);
    expect(problems.map((problem) => [problem.kind, problem.file, "path" in problem && problem.path])).toEqual([
      ["no-alt", "content/layout/header.json", "/"],
      ["empty-link", "content/layout/header.json", "/"],
      ["accessibility", "content/pages/index.json", "/"],
      ["skipped-heading", "content/pages/about.json", "/about"],
    ]);
    // axe-core's rule, in plain words. Its own link-name and image-alt rules are left to the site checks.
    expect(problems[2]).toMatchObject({
      rule: "empty-table-header",
      help: "A table has a column or row heading with no text.",
      count: 1,
    });
  }, 30_000);

  it("checks a page as each size of screen shows it, where blocks are hidden on some", async () => {
    const nav = (className: string) => `<nav aria-label="main" class="${className}"><a href="/a">A</a></nav>`;
    const rules = async (main: string) =>
      (await checkBuiltPages([page("/", "content/pages/index.json", main)])).flatMap((problem) =>
        problem.kind === "accessibility" ? [problem.rule] : [],
      );
    // Two menus with the same name are a problem where both show,
    expect(await rules(`<h1>Home</h1>${nav("")}${nav("")}`)).toContain("landmark-unique");
    // but not when one shows on computers and the other below them.
    expect(await rules(`<h1>Home</h1>${nav("flex max-lg:hidden")}${nav("lg:hidden")}`)).toEqual([]);
    expect(await rules(`<h1>Home</h1>${nav("hidden lg:flex")}${nav("lg:hidden")}`)).toEqual([]);
    // What only phones show is still checked.
    expect(await rules(`<h1>Home</h1><input class="sm:hidden" type="text">`)).toContain("label");
  }, 60_000);
});
