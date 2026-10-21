import { resolve } from "node:path";
import { ContentError, type SiteProblem } from "@goodfellow-cms/core";
import { reportSiteProblems } from "@goodfellow-cms/core/accessibility";
import { describe, expect, it } from "vitest";
import { buildCause, reportBuildCause } from "./problems.js";

const root = resolve("/sites/parish");

describe("build causes", () => {
  it("names the content file that has a problem", () => {
    const error = new ContentError([{ file: "content/pages/about.json", message: "isn't valid JSON." }]);
    expect(buildCause(error, root)).toEqual({
      kind: "content",
      file: "content/pages/about.json",
      message: "content/pages/about.json: isn't valid JSON.",
    });
  });

  it("names the site's own file where code failed, but not packages' files", () => {
    const compile = Object.assign(new Error("Expected ';'"), { id: resolve(root, "blocks/hero.tsx") });
    expect(buildCause(compile, root)).toMatchObject({ kind: "code", file: "blocks/hero.tsx" });
    const thrown = new Error("Cannot read properties of undefined");
    thrown.stack = `Error: Cannot read properties of undefined\n    at render (${resolve(root, "node_modules/x/index.js")}:1:2)\n    at Hero (${resolve(root, "blocks/installed/hero/hero.tsx")}:12:5)`;
    expect(buildCause(thrown, root)).toMatchObject({ file: "blocks/installed/hero/hero.tsx" });
    expect(buildCause(new Error("Something"), root)).toEqual({ kind: "code", message: "Something" });
    const colored = new Error(
      `${String.fromCharCode(27)}[31m[PARSE_ERROR] ${String.fromCharCode(27)}[0mUnexpected token`,
    );
    expect(buildCause(colored, root).message).toBe("[PARSE_ERROR] Unexpected token");
  });

  it("prints a GitHub annotation on GitHub Actions too", () => {
    const cause = { kind: "content" as const, file: "content/pages/a,b.json", message: "Line one\nline two" };
    expect(reportBuildCause(cause, {})).toHaveLength(1);
    const [, annotation] = reportBuildCause(cause, { GITHUB_ACTIONS: "true" });
    expect(annotation).toBe(
      "::error file=content/pages/a%2Cb.json,title=A content file has a problem::Line one%0Aline two",
    );
  });
});

describe("site checks", () => {
  const problems: SiteProblem[] = [
    { kind: "missing-page", severity: "error", file: "content/pages/about.json", target: "/vist" },
    {
      kind: "low-contrast",
      severity: "warning",
      file: "content/site.json",
      text: "primaryForeground",
      background: "primary",
      ratio: 1.5,
      dark: false,
    },
  ];

  it("lists what they found, and annotates the files on GitHub Actions", () => {
    expect(reportSiteProblems([], {})).toEqual([]);
    expect(reportSiteProblems(problems, {})).toEqual([
      "Site checks found 1 error and 1 warning:",
      "  error: content/pages/about.json links to /vist, which isn't a page or item on the site.",
      "  warning: content/site.json: primaryForeground on primary has a contrast of 1.5 to 1, below 4.5 to 1.",
    ]);
    expect(reportSiteProblems(problems, { GITHUB_ACTIONS: "true" }).slice(3)).toEqual([
      "::error file=content/pages/about.json,title=A link goes nowhere::content/pages/about.json links to /vist, which isn't a page or item on the site.",
      "::warning file=content/site.json,title=Could be better::content/site.json: primaryForeground on primary has a contrast of 1.5 to 1, below 4.5 to 1.",
    ]);
  });
});
