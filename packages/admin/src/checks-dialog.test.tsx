import type { SiteContent, SiteProblem } from "@goodfellow-cms/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChecksDialog } from "./checks-dialog.js";
import { defaultStrings } from "./strings.js";

const content = { collections: [], pages: [], entries: [] } as unknown as SiteContent;
const problem = (kind: SiteProblem["kind"]) =>
  ({ kind, file: "content/pages/about.json", target: "/gone" }) as SiteProblem;

describe("ChecksDialog", () => {
  it("names only the sources that couldn't be read, never other problems as if they were also there", () => {
    const html = renderToStaticMarkup(
      <ChecksDialog
        checks={{ blocking: [problem("missing-page")], warnings: [problem("no-title")], unread: ["jobs"], content }}
        content={content}
        onDecide={() => {}}
      />,
    );
    expect(html).toContain("jobs");
    expect(html).not.toContain(defaultStrings["checks.alsoWarnings"]);
  });

  it("words an unreadable file in the admin panel's language, with the loader's own reason behind Details", () => {
    const unreadable: SiteProblem = {
      kind: "unreadable",
      severity: "error",
      file: "content/pages/new.json",
      message: "Expected object, received string",
    };
    const html = renderToStaticMarkup(
      <ChecksDialog checks={{ blocking: [unreadable], warnings: [], content }} content={content} onDecide={() => {}} />,
    );
    expect(html).toContain("content/pages/new.json");
    expect(html).toContain("Undo your change to it");
    expect(html.indexOf("Expected object")).toBeGreaterThan(html.indexOf("<details"));
    expect(html).toMatch(/<details[^>]*><summary>Details<\/summary><pre>Expected object, received string<\/pre>/);
  });
});
