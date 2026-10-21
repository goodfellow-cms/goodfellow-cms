/**
 * Site checks on rendered pages: what only shows once blocks have rendered,
 * such as images without alt text, headings that skip a level and links whose
 * text doesn't say where they go. They read the page's HTML as text, so they
 * run in the browser and in Node alike, on HTML React rendered.
 *
 * Each problem is put down to the file it comes from: the page's own content
 * (`gf-main`), the header (`gf-header`) or the footer (`gf-footer`).
 */
import type { SiteProblem } from "./checks.js";
import { FOOTER_FILE, HEADER_FILE } from "./paths.js";

/** A rendered page: its body's HTML, its address, and the content file `gf-main` comes from. */
export interface RenderedPage {
  html: string;
  path: string;
  file: string;
}

/**
 * Link text that doesn't say where a link goes, in English, after trimming and
 * leaving out punctuation and arrows. Such links make sense only beside the
 * text around them, which people who list a page's links don't hear.
 */
const VAGUE_LINK_TEXT = new Set([
  "click",
  "click here",
  "continue",
  "continue reading",
  "details",
  "find out more",
  "go",
  "here",
  "learn more",
  "link",
  "more",
  "more info",
  "more information",
  "read more",
  "see more",
  "this",
  "this link",
  "this page",
]);

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

const TOKEN =
  /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

function attributes(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE)) {
    const [, name = "", double, single, bare] = match;
    found.set(name.toLowerCase(), decode(double ?? single ?? bare ?? ""));
  }
  return found;
}

/** Text as people hear it: spaces run together, without punctuation and arrows at either end. */
function spoken(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, "")
    .toLowerCase();
}

const REGIONS: Record<string, "page" | "header" | "footer"> = {
  "gf-main": "page",
  "gf-header": "header",
  "gf-footer": "footer",
};

interface Open {
  tag: string;
  hidden: boolean;
  region?: "page" | "header" | "footer";
}

interface OpenLink {
  depth: number;
  href: string;
  label?: string;
  text: string[];
}

interface OpenHeading {
  depth: number;
  level: number;
  text: string[];
}

/** What a rendered page has wrong that editors can fix, each put down to the file it comes from. */
export function renderedProblems(page: RenderedPage): SiteProblem[] {
  const problems: SiteProblem[] = [];
  const stack: Open[] = [];
  let link: OpenLink | undefined;
  let heading: OpenHeading | undefined;
  // The last heading in each region: headings are checked against the one before them in the same file.
  const lastHeading = new Map<string, number>();

  const region = () => {
    for (let index = stack.length - 1; index >= 0; index--) {
      const found = stack[index]?.region;
      if (found) return found;
    }
    return undefined;
  };
  const fileOf = (where: "page" | "header" | "footer") =>
    where === "page" ? page.file : where === "header" ? HEADER_FILE : FOOTER_FILE;
  const hidden = () => stack.at(-1)?.hidden === true;

  const closeLink = () => {
    if (!link) return;
    const where = region();
    const { href } = link;
    const name = (link.label ?? link.text.join("")).replace(/\s+/g, " ").trim();
    link = undefined;
    if (!where) return;
    const file = fileOf(where);
    const said = spoken(name);
    if (!said) problems.push({ kind: "empty-link", severity: "warning", file, path: page.path, target: href });
    else if (VAGUE_LINK_TEXT.has(said)) {
      problems.push({
        kind: "vague-link",
        severity: "warning",
        file,
        path: page.path,
        target: href,
        text: name,
      });
    }
  };

  const closeHeading = () => {
    if (!heading) return;
    const where = region();
    const { level } = heading;
    const text = heading.text.join("").replace(/\s+/g, " ").trim();
    heading = undefined;
    if (!where) return;
    const previous = lastHeading.get(where);
    lastHeading.set(where, level);
    // A page's own content may start with its title (level 1) or a section (level 2); the header and footer anywhere.
    const allowed = previous === undefined ? (where === "page" ? 2 : level) : previous + 1;
    if (level > allowed) {
      problems.push({
        kind: "skipped-heading",
        severity: "warning",
        file: fileOf(where),
        path: page.path,
        text,
        level,
        ...(previous !== undefined && { previous }),
      });
    }
  };

  for (const match of page.html.matchAll(TOKEN)) {
    const [, raw, closing, opening, source = "", text] = match;
    if (raw) continue;
    if (text !== undefined) {
      if (hidden()) continue;
      const decoded = decode(text);
      link?.text.push(decoded);
      heading?.text.push(decoded);
      continue;
    }
    if (closing) {
      const tag = closing.toLowerCase();
      // Closes the nearest element of its kind, and any left open inside it.
      const at = stack.map((open) => open.tag).lastIndexOf(tag);
      if (at === -1) continue;
      while (stack.length > at) {
        stack.pop();
        if (link && stack.length <= link.depth) closeLink();
        if (heading && stack.length <= heading.depth) closeHeading();
      }
      continue;
    }
    if (!opening) continue;
    const tag = opening.toLowerCase();
    const attrs = attributes(source);
    const isHidden =
      hidden() ||
      attrs.get("aria-hidden") === "true" ||
      attrs.has("hidden") ||
      attrs.get("role") === "presentation" ||
      attrs.get("role") === "none";

    if (tag === "img") {
      const alt = attrs.get("alt");
      if (!isHidden) {
        if (alt?.trim()) {
          link?.text.push(` ${alt} `);
          heading?.text.push(` ${alt} `);
        } else {
          const where = region();
          if (where) {
            problems.push({
              kind: "no-alt",
              severity: "warning",
              file: fileOf(where),
              path: page.path,
              target: attrs.get("src") ?? "",
            });
          }
        }
      }
      continue;
    }
    if (VOID.has(tag) || source.trimEnd().endsWith("/")) continue;

    const classes = (attrs.get("class") ?? "").split(/\s+/);
    const regionName = classes.map((name) => REGIONS[name]).find(Boolean);
    stack.push({ tag, hidden: isHidden, ...(regionName && { region: regionName }) });
    if (isHidden) continue;
    if (tag === "a" && attrs.has("href") && !link) {
      const label = attrs.get("aria-label")?.trim() || (attrs.has("aria-labelledby") ? "labelled" : undefined);
      link = { depth: stack.length - 1, href: attrs.get("href") ?? "", text: [], ...(label && { label }) };
      const title = attrs.get("title")?.trim();
      if (title) link.text.push(` ${title} `);
    }
    const level = /^h([1-6])$/.exec(tag)?.[1];
    if (level && !heading) heading = { depth: stack.length - 1, level: Number(level), text: [] };
  }
  closeLink();
  closeHeading();
  return problems;
}
