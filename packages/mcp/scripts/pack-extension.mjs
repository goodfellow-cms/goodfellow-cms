// Packs the Claude Desktop extension, goodfellow.mcpb: the local server
// (src/stdio.ts) bundled into one file with everything it uses, Playwright's
// core for screenshots with the computer's own Chrome or Edge, and the
// manifest, whose settings Claude Desktop asks for when it's installed.
// The docs workflow publishes it on the documentation site.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { build } from "tsdown";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "extension");
const { version, description } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

rmSync(out, { recursive: true, force: true });
await build({
  config: false,
  cwd: root,
  entry: { index: "src/stdio.ts" },
  outDir: join(out, "server"),
  format: "esm",
  platform: "node",
  dts: false,
  fixedExtension: false,
  // Everything but Playwright, which finds its own files on disk.
  deps: { alwaysBundle: [/^(?!playwright-core)/], neverBundle: ["playwright-core"] },
  logLevel: "warn",
});
const require = createRequire(join(root, "package.json"));
const playwright = dirname(require.resolve("playwright-core/package.json"));
mkdirSync(join(out, "server/node_modules"), { recursive: true });
cpSync(playwright, join(out, "server/node_modules/playwright-core"), { recursive: true, dereference: true });

const tools = [
  ["get_site", "An overview of a site: its pages, collections, menus and blocks."],
  ["get_page", "A page's settings and blocks."],
  ["save_page", "Creates or changes a page, in a draft."],
  ["get_collection", "A collection's fields and items."],
  ["save_item", "Creates or changes a collection's item, in a draft."],
  ["update_settings", "Changes the site's settings, in a draft."],
  ["screenshot", "A picture of a page, live or with a draft's changes."],
  ["publish", "Publishes a draft."],
  ["submit_for_review", "Asks for a draft to be checked before it goes live."],
];
// Claude Desktop fills in the `${…}` placeholders.
const manifest = {
  manifest_version: "0.3",
  name: "goodfellow",
  display_name: "Goodfellow",
  version,
  description,
  author: { name: "Goodfellow", url: "https://goodfellow-cms.github.io/goodfellow-cms/" },
  homepage: "https://goodfellow-cms.github.io/goodfellow-cms/",
  documentation: "https://goodfellow-cms.github.io/goodfellow-cms/docs/claude",
  support: "https://github.com/goodfellow-cms/goodfellow-cms/issues",
  license: "MIT",
  server: {
    type: "node",
    entry_point: "server/index.js",
    mcp_config: {
      command: "node",
      args: [`\${__dirname}/server/index.js`],
      env: {
        GOODFELLOW_SITE: `\${user_config.site}`,
        GOODFELLOW_TOKEN: `\${user_config.token}`,
        GITLAB_URL: `\${user_config.gitlab_url}`,
      },
    },
  },
  user_config: {
    site: {
      type: "string",
      title: "Site",
      description: "The site's repository, such as github:your-name/your-site or gitlab:your-group/your-site.",
      required: true,
    },
    token: {
      type: "string",
      title: "Token",
      description: "A GitHub or GitLab token that can edit the site. It stays on this computer.",
      sensitive: true,
      required: true,
    },
    gitlab_url: {
      type: "string",
      title: "GitLab address",
      description: "Only for a GitLab of your own, such as https://gitlab.example.org.",
      required: false,
      default: "",
    },
  },
  tools: tools.map(([name, text]) => ({ name, description: text })),
  compatibility: { platforms: ["darwin", "win32", "linux"], runtimes: { node: ">=22.0.0" } },
};
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

// A .mcpb file is a zip with manifest.json at its top, so it's zipped here
// rather than with Anthropic's mcpb tool, whose signing brings in packages
// with security advisories. The fields Claude Desktop needs are checked first.
const missing = [
  ["manifest_version", manifest.manifest_version],
  ["name", manifest.name],
  ["version", manifest.version],
  ["description", manifest.description],
  ["author.name", manifest.author?.name],
  ["server.type", manifest.server?.type],
  ["server.entry_point", manifest.server?.entry_point],
  ["server.mcp_config.command", manifest.server?.mcp_config?.command],
].filter(([, value]) => !value);
if (missing.length) throw new Error(`The extension's manifest needs ${missing.map(([name]) => name).join(", ")}.`);
if (!existsSync(join(out, manifest.server.entry_point)))
  throw new Error(`${manifest.server.entry_point} wasn't built.`);

const files = {};
for (const entry of readdirSync(out, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const path = join(entry.parentPath, entry.name);
  files[
    path
      .slice(out.length + 1)
      .split("\\")
      .join("/")
  ] = readFileSync(path);
}
writeFileSync(join(root, "goodfellow.mcpb"), zipSync(files, { level: 9 }));
console.log("Packed goodfellow.mcpb.");
