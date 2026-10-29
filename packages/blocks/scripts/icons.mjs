// Writes src/icons.ts, the built-in blocks' icons, from Lucide's icon data in lucide-react.
// Run with `pnpm --filter @goodfellow-cms/blocks update-icons` after changing a block's icon or
// lucide-react's version, and commit the result.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Each built-in block's Lucide icon, by its name on lucide.dev. */
const ICONS = {
  Section: "panels-top-left",
  Grid: "layout-grid",
  Flex: "columns-3",
  Space: "unfold-vertical",
  Separator: "separator-horizontal",
  MediaText: "layout-panel-left",
  Details: "list-collapse",
  Heading: "heading",
  Text: "pilcrow",
  Button: "mouse-pointer-click",
  Pullquote: "quote",
  Table: "table",
  Preformatted: "type-outline",
  Verse: "scroll-text",
  Code: "code-xml",
  Form: "clipboard-list",
  Newsletter: "mail-plus",
  ContactDetails: "contact",
  Image: "image",
  Gallery: "images",
  Video: "video",
  Embed: "message-square-quote",
  Audio: "audio-lines",
  File: "file-down",
  Document: "file-text",
  ShareButtons: "share-2",
  Donate: "hand-heart",
  Menu: "menu",
  SiteBrand: "flag",
  Search: "text-search",
  DarkModeSwitch: "sun-moon",
  LanguageSwitch: "languages",
  CollectionNav: "list-tree",
  PageList: "list",
  Breadcrumbs: "footprints",
  CollectionList: "layout-list",
  CollectionLoop: "repeat",
  Calendar: "calendar-days",
  EntryField: "text-cursor-input",
  AddToCalendar: "calendar-plus",
  EntryPager: "arrow-left-right",
  OnThisPage: "table-of-contents",
};

const require = createRequire(import.meta.url);
const root = dirname(require.resolve("lucide-react/package.json"));
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const license = await readFile(join(root, "LICENSE"), "utf8");
// Feather's icons are under its own license, which this file would then have to carry too.
const feather = license.match(/derived from the Feather project:\s*\n\s*\n(.*)\n/)?.[1]?.split(/,\s*/) ?? [];

const lines = [];
for (const [block, name] of Object.entries(ICONS)) {
  if (feather.includes(name)) throw new Error(`${name} comes from Feather; choose another icon for ${block}.`);
  const source = await readFile(join(root, "dist/esm/icons", `${name}.mjs`), "utf8");
  const node = source.match(/node: (\[[\s\S]*?\n {2}\])[,\n]/)?.[1];
  if (!node) throw new Error(`lucide-react's ${name} has no icon data where it's expected.`);
  // The data is a JavaScript literal with bare keys, read as JSON rather than run.
  const data = JSON.parse(node.replace(/([{,]\s*)(\w+):/g, '$1"$2":'));
  if (data.length === 0) throw new Error(`lucide-react's ${name} has no shapes.`);
  const shapes = data.map(([shape, attributes]) => {
    const kept = Object.entries(attributes).filter(([key]) => key !== "key");
    return `[${JSON.stringify(shape)}, { ${kept.map(([key, value]) => `${key}: ${JSON.stringify(String(value))}`).join(", ")} }]`;
  });
  lines.push(`  ${block}: [${shapes.join(", ")}],`);
}

const notice = license.split("\n---")[0].trim().split("\n");
await writeFile(
  fileURLToPath(new URL("../src/icons.ts", import.meta.url)),
  [
    `// Made by scripts/icons.mjs from lucide-react ${version}'s icon data. Don't edit it by hand.`,
    "//",
    ...notice.map((line) => `// ${line}`.trimEnd()),
    'import type { BlockIcon } from "@goodfellow-cms/core";',
    "",
    "/** Each built-in block's icon in the block list, Lucide's (lucide.dev). */",
    "export const BLOCK_ICONS: Readonly<Record<string, BlockIcon>> = {",
    ...lines,
    "};",
    "",
  ].join("\n"),
);
