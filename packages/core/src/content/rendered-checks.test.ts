import { describe, expect, it } from "vitest";
import type { SiteProblem } from "./checks.js";
import { renderedProblems } from "./rendered-checks.js";

const body = (header: string, main: string, footer = "") =>
  `<div><header class="gf-header">${header}</header><main class="gf-main" data-pagefind-body="">${main}</main><footer class="gf-footer">${footer}</footer></div>`;

const found = (html: string) =>
  renderedProblems({ html, path: "/about", file: "content/pages/about.json" }).map((problem) => {
    const { severity, path, ...rest } = problem as Extract<SiteProblem, { path: string }>;
    return rest;
  });

describe("renderedProblems", () => {
  it("finds images without alt text, unless they're only decoration", () => {
    expect(
      found(
        body(
          '<a href="/"><img src="/media/logo.svg" alt=""></a>',
          [
            '<img src="/media/a.jpg" alt="The choir">',
            '<img src="/media/b.jpg" alt=" ">',
            '<img src="/media/c.jpg">',
            '<img src="/media/d.jpg" alt="" aria-hidden="true">',
            '<div aria-hidden="true"><img src="/media/e.jpg"></div>',
            '<img src="/media/f.jpg" alt="" role="presentation"/>',
          ].join(""),
        ),
      ),
    ).toEqual([
      { kind: "no-alt", file: "content/layout/header.json", target: "/media/logo.svg" },
      // The logo is the link's only content, so the link has no text either.
      { kind: "empty-link", file: "content/layout/header.json", target: "/" },
      { kind: "no-alt", file: "content/pages/about.json", target: "/media/b.jpg" },
      { kind: "no-alt", file: "content/pages/about.json", target: "/media/c.jpg" },
    ]);
  });

  it("finds headings that skip a level, in each part of the page", () => {
    expect(
      found(
        body(
          "<h4>Site name</h4>",
          "<h1>About us</h1><h2>History</h2><h3>Founding</h3><h2>Today</h2><h4>Too deep <em>here</em></h4>",
          "<h4>Contact</h4><h6>Hours</h6>",
        ),
      ),
    ).toEqual([
      { kind: "skipped-heading", file: "content/pages/about.json", text: "Too deep here", level: 4, previous: 2 },
      { kind: "skipped-heading", file: "content/layout/footer.json", text: "Hours", level: 6, previous: 4 },
    ]);
    expect(found(body("", "<h3>Times</h3>"))).toEqual([
      { kind: "skipped-heading", file: "content/pages/about.json", text: "Times", level: 3 },
    ]);
  });

  it("finds links whose text doesn't say where they go, and ones with no text", () => {
    expect(
      found(
        body(
          "",
          [
            '<a href="/mass-times">Mass times</a>',
            '<a href="/news">Read more →</a>',
            '<p>For details, <a href="/contact">click <strong>here</strong></a>.</p>',
            '<a href="/news/advent" aria-label="Read more about Advent">Read more</a>',
            '<a href="/news/lent"><img src="/media/lent.jpg" alt="Lent"></a>',
            '<a href="https://example.org"><svg aria-hidden="true"></svg></a>',
            '<a href="/x" aria-hidden="true">More</a>',
          ].join(""),
        ),
      ),
    ).toEqual([
      { kind: "vague-link", file: "content/pages/about.json", target: "/news", text: "Read more →" },
      { kind: "vague-link", file: "content/pages/about.json", target: "/contact", text: "click here" },
      { kind: "empty-link", file: "content/pages/about.json", target: "https://example.org" },
    ]);
  });

  it("leaves out what's outside the page's parts, and scripts and styles", () => {
    expect(found('<img src="/a.jpg"><script>"<img src=x>"</script><style>a{}</style>')).toEqual([]);
    expect(found(body("", '<template><img src="/media/slot.jpg"></template><!-- <img src="/c.jpg"> -->'))).toEqual([
      { kind: "no-alt", file: "content/pages/about.json", target: "/media/slot.jpg" },
    ]);
  });
});
