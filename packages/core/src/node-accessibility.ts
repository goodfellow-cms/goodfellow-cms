/**
 * Automated accessibility checks of built pages, for `goodfellow build` and
 * `goodfellow-next finish`: the site checks that need rendered pages
 * (`renderedProblems()`), and axe-core's rules, run in happy-dom. Automated
 * checks find only some problems, so they never show that a site is fully
 * accessible.
 *
 * Node only, and an entry of its own, so nothing else loads axe-core.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Window } from "happy-dom";
import {
  FOOTER_FILE,
  formatSiteProblem,
  HEADER_FILE,
  problemKey,
  renderedProblems,
  type SiteProblem,
} from "./index.js";

/** A built page: its address, the content file its own content comes from, and its HTML. */
export interface BuiltPage {
  path: string;
  file: string;
  html: string;
}

/**
 * axe-core's rules that these checks leave out: ones the site checks make in
 * words editors understand (alt text, heading levels and links' text, and the
 * theme's contrast), and ones that need a browser's layout, which happy-dom
 * doesn't have.
 */
const LEFT_OUT = ["color-contrast", "color-contrast-enhanced", "heading-order", "image-alt", "link-name"];

/** What axe-core's rules mean, in plain words, for the ones sites are likeliest to break. Others use axe's own. */
const PLAIN_WORDS: Record<string, string> = {
  "aria-allowed-attr": "An element has an ARIA attribute it can't have, which can confuse screen readers.",
  "aria-hidden-focus": "Something hidden from screen readers can still be reached with the keyboard.",
  "aria-required-attr": "An element with an ARIA role is missing an attribute that role needs.",
  "aria-valid-attr-value": "An ARIA attribute has a value it can't have.",
  "button-name": "A button has no text, so people who can't see it don't know what it does.",
  "document-title": "The page has no title for browser tabs and screen readers.",
  "duplicate-id-aria":
    "Two elements share an id that labels or describes something, so screen readers may read the wrong one.",
  "empty-heading": "A heading has no text.",
  "empty-table-header": "A table has a column or row heading with no text.",
  "frame-title": "An embedded frame, such as a video or map, has no title saying what it is.",
  "html-has-lang": "The page doesn't say what language it's in, so screen readers may read it with the wrong voice.",
  "html-lang-valid": "The page's language isn't one browsers know.",
  label: "A form field has no label saying what to enter.",
  "landmark-complementary-is-top-level":
    "Something marked as an aside is inside another part of the page, where asides don't belong.",
  "landmark-no-duplicate-banner":
    "The page has more than one header, so screen readers can't tell which is the page's.",
  "landmark-no-duplicate-contentinfo":
    "The page has more than one footer, so screen readers can't tell which is the page's.",
  "landmark-unique": "Two parts of the page have the same name, so screen readers can't tell them apart.",
  list: "A list has something other than list items in it.",
  listitem: "A list item isn't in a list.",
  "meta-viewport": "The page stops people zooming in.",
  "nested-interactive": "A link or button has another one inside it, which keyboards and screen readers can't use.",
  region: "Some of the page's content isn't in its header, main content or footer, so screen readers may skip it.",
  "role-img-alt": "Something shown as an image has no description.",
  "scrollable-region-focusable": "A part of the page that scrolls can't be scrolled with the keyboard.",
  "select-name": "A drop-down list has no label saying what to choose.",
  "svg-img-alt": "A drawing (SVG) shown as an image has no description.",
  "td-headers-attr": "A table cell refers to headings the table doesn't have.",
  "th-has-data-cells": "A table heading has no cells under it.",
  "video-caption": "A video has no captions.",
};

let axeSource: string | undefined;

async function loadAxe(): Promise<string> {
  axeSource ??= await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
  return axeSource;
}

interface AxeResults {
  violations: Array<{ id: string; help: string; nodes: Array<{ target: unknown[] }> }>;
}

/** The file the part of a page an element is in comes from: the header, the footer, or the page's own content. */
function fileFor(document: Window["document"], target: unknown[], page: BuiltPage): string {
  const selector = target.length === 1 && typeof target[0] === "string" ? target[0] : undefined;
  const element = selector ? document.querySelector(selector) : null;
  if (element?.closest(".gf-header")) return HEADER_FILE;
  if (element?.closest(".gf-footer")) return FOOTER_FILE;
  return page.file;
}

/** axe-core's findings on one built page, by rule and file. */
async function axeProblems(page: BuiltPage): Promise<SiteProblem[]> {
  const window = new Window({
    url: "https://localhost/",
    settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true },
  });
  try {
    window.document.write(page.html);
    window.eval(await loadAxe());
    const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<AxeResults> } })
      .axe;
    const results = await axe.run(window.document, {
      resultTypes: ["violations"],
      rules: Object.fromEntries(LEFT_OUT.map((rule) => [rule, { enabled: false }])),
    });
    const found = new Map<string, SiteProblem & { kind: "accessibility" }>();
    for (const violation of results.violations) {
      for (const node of violation.nodes) {
        const file = fileFor(window.document, node.target, page);
        const key = `${violation.id} ${file}`;
        const existing = found.get(key);
        if (existing) existing.count += 1;
        else {
          found.set(key, {
            kind: "accessibility",
            severity: "warning",
            file,
            path: page.path,
            rule: violation.id,
            help: PLAIN_WORDS[violation.id] ?? `${violation.help}.`,
            count: 1,
          });
        }
      }
    }
    return [...found.values()];
  } finally {
    await window.happyDOM.close();
  }
}

/**
 * What automated checks find on built pages: the site checks that need
 * rendered pages, and axe-core's. The header's and footer's problems, on every
 * page, are listed once.
 */
export async function checkBuiltPages(pages: readonly BuiltPage[]): Promise<SiteProblem[]> {
  const found = new Map<string, SiteProblem>();
  for (const page of pages) {
    for (const problem of [...renderedProblems(page), ...(await axeProblems(page))]) {
      const key = problemKey(problem);
      if (!found.has(key)) found.set(key, problem);
    }
  }
  return [...found.values()];
}

/** GitHub Actions' workflow command escaping, for a message or a property. */
function escapeCommand(text: string, property = false): string {
  const escaped = text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  return property ? escaped.replaceAll(":", "%3A").replaceAll(",", "%2C") : escaped;
}

/** The checks of built pages, which can't show that a site is accessible, only some of what keeps it from being. */
const BUILT_PAGE_CHECKS = new Set<SiteProblem["kind"]>([
  "no-alt",
  "skipped-heading",
  "vague-link",
  "empty-link",
  "accessibility",
]);

/**
 * What the site checks found, for a build's log, such as `goodfellow build`'s and `goodfellow-next finish`'s: a count, then each
 * problem, and on GitHub Actions an annotation on its file too.
 */
export function reportSiteProblems(problems: SiteProblem[], env: NodeJS.ProcessEnv = process.env): string[] {
  if (problems.length === 0) return [];
  const count = (severity: SiteProblem["severity"], name: string) => {
    const found = problems.filter((problem) => problem.severity === severity).length;
    return found > 0 ? [`${found} ${name}${found === 1 ? "" : "s"}`] : [];
  };
  const lines = [`Site checks found ${[...count("error", "error"), ...count("warning", "warning")].join(" and ")}:`];
  for (const problem of problems) lines.push(`  ${problem.severity}: ${formatSiteProblem(problem)}`);
  if (problems.some((problem) => BUILT_PAGE_CHECKS.has(problem.kind))) {
    lines.push(
      "  Automated checks find only some accessibility problems. Try the site with a keyboard and a screen reader too.",
    );
  }
  if (env.GITHUB_ACTIONS === "true") {
    for (const problem of problems) {
      const title = problem.severity === "error" ? "A link goes nowhere" : "Could be better";
      lines.push(
        `::${problem.severity} file=${escapeCommand(problem.file, true)},title=${escapeCommand(title, true)}::${escapeCommand(formatSiteProblem(problem))}`,
      );
    }
  }
  return lines;
}
