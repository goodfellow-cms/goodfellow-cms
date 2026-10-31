// Writes the documentation for AI tools, as llmstxt.org describes: each page's
// Markdown at its address with `.md` after it (`/docs/media.md`), `llms.txt`
// listing them by section with their descriptions, and `llms-full.txt` with
// every page in one file. Addresses on the site are written out in full, since
// tools read the files without the site around them.
//
// The domain's own `llms.txt`, at https://goodfellow-cms.github.io/llms.txt,
// is in the goodfellow-cms.github.io repository and points here.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMarkdownEntry } from "@goodfellow-cms/core";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const public_ = join(root, "public");
const docsDir = join(root, "content/collections/docs");

const site = JSON.parse(readFileSync(join(root, "content/site.json"), "utf8"));
const collection = JSON.parse(readFileSync(join(docsDir, "_collection.json"), "utf8"));
const base = site.url.replace(/\/$/, "");
const sections = collection.fields.find((field) => field.name === "section").options;

/** A root-relative address as a full one, and others as they are. */
const full = (address) => (address.startsWith("/") && !address.startsWith("//") ? `${base}${address}` : address);

/** The Markdown with its links and images to the site's own addresses written out in full. */
const withFullLinks = (markdown) => markdown.replace(/\]\((\/(?!\/)[^)\s]*)/g, (_, address) => `](${full(address)}`);

const pages = readdirSync(docsDir)
  .filter((file) => file.endsWith(".md"))
  .map((file) => {
    const slug = file.slice(0, -3);
    const { fields } = parseMarkdownEntry(readFileSync(join(docsDir, file), "utf8"), "body");
    return {
      slug,
      title: String(fields.title),
      description: typeof fields.description === "string" ? fields.description : "",
      section: String(fields.section),
      order: typeof fields.order === "number" ? fields.order : Number.MAX_SAFE_INTEGER,
      body: withFullLinks(String(fields.body ?? "")).trim(),
    };
  })
  .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

const page = (item) =>
  [`# ${item.title}`, "", ...(item.description ? [`> ${item.description}`, ""] : []), item.body, ""].join("\n");

rmSync(join(public_, "docs"), { recursive: true, force: true });
mkdirSync(join(public_, "docs"), { recursive: true });
for (const item of pages) writeFileSync(join(public_, "docs", `${item.slug}.md`), page(item));

const summary = `> ${site.description}`;
const about =
  "Goodfellow CMS (Goodfellow for short) is open source under the MIT license. Its source is at https://github.com/goodfellow-cms/goodfellow-cms, and its packages are on npm under @goodfellow-cms, with the `goodfellow` command and `npm create goodfellow`.";
const index = [
  `# ${site.title}`,
  "",
  summary,
  "",
  about,
  "",
  ...sections.flatMap((section) => {
    const listed = pages.filter((item) => item.section === section.value);
    if (listed.length === 0) return [];
    return [
      `## ${section.label}`,
      "",
      ...listed.map(
        (item) => `- [${item.title}](${base}/docs/${item.slug}.md)${item.description ? `: ${item.description}` : ""}`,
      ),
      "",
    ];
  }),
  "## Optional",
  "",
  `- [Every page in one file](${base}/llms-full.txt)`,
  `- [The demo](${base}/demo/admin/): the admin panel with a made-up parish's site, saved only in the browser`,
  "",
].join("\n");
writeFileSync(join(public_, "llms.txt"), index);

const everything = [`# ${site.title}`, "", summary, "", about, "", ...pages.map((item) => page(item))].join("\n");
writeFileSync(join(public_, "llms-full.txt"), everything);

console.log(`Wrote llms.txt, llms-full.txt and ${pages.length} pages as Markdown for AI tools.`);
