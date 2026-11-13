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
});
