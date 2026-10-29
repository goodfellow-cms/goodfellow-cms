// The starter with every block of the built registry installed, and a page with each one that runs in the browser,
// built with `goodfellow build`, whose islands then run with Preact, and served at http://localhost:4415.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { availableBlocks, EMPTY_RECORD, GOODFELLOW_REGISTRY, planInstall } from "@goodfellow-cms/core";
import { build, preview } from "goodfellow";
import { starter } from "./site.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../.site-preact");
const registry = join(here, "../../packages/registry/r");
const PORT = 4415;

rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
for (const entry of ["src", "blocks", "plugins", "content", "public", "goodfellow.config.tsx"]) {
  cpSync(join(starter, entry), join(root, entry), { recursive: true });
}

// Installed as the admin panel's Blocks screen installs them.
const base = "https://registry.invalid/r/";
const registries = { [GOODFELLOW_REGISTRY]: `${base}{name}.json` };
const fetchJson = async (url) => JSON.parse(readFileSync(join(registry, url.slice(base.length)), "utf8"));
const read = async (path) => {
  try {
    return readFileSync(join(root, path), "utf8");
  } catch {
    return undefined;
  }
};
let record = EMPTY_RECORD;
for (const block of await availableBlocks(registries, fetchJson)) {
  const plan = await planInstall({ ref: block.ref, registries, fetchJson, readFile: read, record, blocks: [] });
  for (const change of plan.changes) {
    const file = join(root, change.path);
    mkdirSync(dirname(file), { recursive: true });
    if ("content" in change) writeFileSync(file, change.content);
    else if ("bytes" in change) writeFileSync(file, change.bytes);
    else rmSync(file, { force: true });
  }
  record = plan.record;
}

const picture = "/media/placeholder.svg";
const blocks = [
  [
    "shadcn-faq",
    {
      title: "First questions",
      questions: [
        { question: "Q one", answer: "<p>Answer one.</p>" },
        { question: "Q two", answer: "<p>Answer two.</p>" },
      ],
    },
  ],
  ["shadcn-faq", { title: "Second questions", questions: [{ question: "Q three", answer: "<p>Answer three.</p>" }] }],
  [
    "shadcn-tabs",
    {
      tabs: [
        { label: "First tab", content: "<p>First panel.</p>" },
        { label: "Second tab", content: "<p>Second panel.</p>" },
      ],
    },
  ],
  [
    "shadcn-carousel",
    { loop: false, slides: [1, 2, 3].map((n) => ({ image: picture, alt: `Slide ${n}`, caption: `Caption ${n}` })) },
  ],
  [
    "slideshow-hero",
    {
      seconds: 2,
      badge: "",
      badgeAlt: "",
      links: [],
      words: { pause: "Pause", play: "Play", picture: "Show picture" },
      slides: [1, 2, 3].map((n) => ({ image: picture, alt: `Picture ${n}` })),
    },
  ],
  [
    "countdown",
    {
      heading: "Coming soon",
      date: "2099-12-25",
      time: "",
      finished: "It's here!",
      words: { days: "Days", hours: "Hours", minutes: "Minutes", seconds: "Seconds" },
    },
  ],
  [
    "comments",
    {
      heading: "Comments",
      reactions: true,
      input: "bottom",
      code: '<script src="https://giscus.app/client.js" data-repo="parish/site" data-repo-id="R_abc123" data-category="Comments" data-category-id="DIC_abc123" data-mapping="pathname" crossorigin="anonymous" async></script>',
    },
  ],
  [
    "custom-html",
    {
      sanitize: false,
      html: '<p id="scripted">Before</p><script>document.getElementById("scripted").textContent = "Script ran";</script>',
    },
  ],
];
const page = {
  version: 1,
  data: {
    content: blocks.map(([type, props], index) => ({
      type,
      props: { id: `${type}-${index}`, className: "", ...props },
    })),
    root: { props: { className: "", description: "", image: "", title: "Registry blocks" } },
  },
};
writeFileSync(join(root, "content/pages/registry.json"), `${JSON.stringify(page, null, 2)}\n`);

const result = await build({ root });
if (result.islands?.runtime !== "preact") {
  throw new Error(`The registry's blocks should run with Preact: ${JSON.stringify(result.islands)}`);
}
await preview({ root, port: PORT });
