// A full-stack site's files, for `create-goodfellow --server cloudflare`: the company example's, which signs editors in
// with the site's own accounts, keeps them in a database, and publishes through the site's own server, made the new
// site's own. With no disk or network access, so the setup page can make the same sites.

import { CONTENT_REPOSITORY_DIR } from "./content/paths.js";
import { CONTENT_FOLDERS } from "./content/store.js";
import { CODE_GITIGNORE } from "./content-repository-setup.js";
import {
  BUNDLED_NAMES,
  type SiteFile,
  type SiteFiles,
  siteFileText,
  sitePackageJson,
  sitePackageName,
  withoutRepositoryNotes,
} from "./site-setup.js";

/** Where a full-stack site can run: only Cloudflare Workers so far. */
export const SERVER_HOSTS = {
  cloudflare: { label: "Cloudflare Workers", description: "A Cloudflare Worker with a D1 database" },
} as const;

export type ServerHost = keyof typeof SERVER_HOSTS;

/** The name the company example uses for its Worker, its D1 database and, with `-cache`, its KV namespace. */
export const TEMPLATE_WORKER = "goodfellow-company";

/** The example's placeholders for the code's and the content's GitHub repositories. */
export const TEMPLATE_CODE_REPO = "your-name/your-site";
export const TEMPLATE_CONTENT_REPO = "your-name/your-site-content";

/** The example's placeholder for the site's address, in wrangler.jsonc's vars. */
export const TEMPLATE_SITE_URL = "https://www.example.com";

export interface ServerSiteOptions {
  /** The company example's files, as `readTemplate()` gives them. */
  template: SiteFiles;
  /** The site's name, such as its folder's: its package's, its Worker's, and its database's. */
  name: string;
  /** Goodfellow's packages' versions, for the workspace links. */
  versions: Record<string, string>;
  /** The code's GitHub repository, such as `your-name/your-site`, where it's known. */
  code?: string;
  /** The content's GitHub repository, such as `your-name/your-site-content`, where it's known. */
  content?: string;
  /** The site's address, such as `https://www.example.org`, where it's known. */
  siteUrl?: string;
}

/**
 * A Cloudflare Worker's name from a site's name: lowercase letters, digits, and dashes, starting and ending with a
 * letter or digit, at most 63 characters, as Cloudflare takes them, and as D1 and KV take their names too.
 */
export function workerName(name: string): string {
  const dashed = sitePackageName(name)
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-");
  return dashed.slice(0, 63).replace(/^-+|-+$/g, "") || "my-site";
}

/** Whether a template file is text that may name the example: not an image, a font, or anything with a NUL. */
function textOf(file: SiteFile): string | undefined {
  if (typeof file === "string") return file;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(file);
    return text.includes("\u0000") ? undefined : text;
  } catch {
    return undefined;
  }
}

/** The content repository's workflow, which asks the code's Deploy workflow to build the site after each publish. */
export function deploySiteWorkflow(code: string): string {
  return `# Asks the code repository to build the site and put it online after each publish, so new photos and other
# files reach the site's own files. Pages show a publish without it, but a photo a page shows is missing until then.
# It needs one secret (Settings → Secrets and variables → Actions): GOODFELLOW_DEPLOY_TOKEN, a fine-grained token for
# the code repository with only Actions: Read and write, which can start its workflows but never change its code.
name: Put the site online
on:
  push:
    branches: [main]
permissions: {}
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: gh workflow run deploy.yml --repo ${code}
        env:
          GH_TOKEN: \${{ secrets.GOODFELLOW_DEPLOY_TOKEN }}
`;
}

/** The content repository's README. */
export function serverContentReadme(name: string, code: string): string {
  return `# ${name}: content

The pages, collections, settings, and media of ${name}, which its editors change in the admin panel at \`/admin\`. The
site's server publishes their changes here, with a token that can change this repository only; the site's code is in
[${code}](https://github.com/${code}).

\`.github/workflows/deploy-site.yml\` asks the code repository to build the site after each publish, so new photos reach
the site's own files. It needs the secret \`GOODFELLOW_DEPLOY_TOKEN\`, as the file says.
`;
}

/**
 * The site's own test settings, in place of the example's, which takes the workspace's (`vitest.shared.ts`, which a
 * site doesn't have): the same longer limits, since a test's first render or server can take a while to start.
 */
export const SITE_VITEST_CONFIG = `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
`;

/** What the code's README says first about the names this site was given. */
function namesSection(worker: string, code: string, content: string): string {
  return `## This site's names

\`create-goodfellow\` made this site with these names, already in \`goodfellow.config.tsx\`, \`wrangler.jsonc\`,
\`package.json\`, and \`.github/workflows/deploy.yml\`, where the steps below say to put them:

- The code's repository, **${code}**, and the content's, **${content}**, which is in \`${CONTENT_REPOSITORY_DIR}/\`, a
  repository of its own that \`content/\` and \`public/media/\` link to, with its own README and the workflow that
  asks this repository to build after each publish (\`.github/workflows/deploy-site.yml\`). Push each to GitHub as it
  is, the content's first.
- The Worker and its D1 database, **${worker}**, and its KV namespace, **${worker}-cache**.

`;
}

/**
 * A full-stack site's files from the company example's: its Worker, database, and KV namespace named for the site,
 * its repositories and address filled in where they're known, and its content in `content-repository/`, a
 * repository of its own, as the example's Deploy workflow builds it, with a workflow that asks the code repository
 * to build after each publish.
 */
export function planServerSite({ template, name, versions, code, content, siteUrl }: ServerSiteOptions): SiteFiles {
  const worker = workerName(name);
  const codeRepo = code ?? TEMPLATE_CODE_REPO;
  const contentRepo = content ?? TEMPLATE_CONTENT_REPO;
  const files: SiteFiles = new Map();
  for (const [bundled, file] of template) {
    // Files npm leaves out of packages are bundled under other names (`_gitignore`), which they're given back here.
    const parts = bundled.split("/");
    const own = BUNDLED_NAMES[parts.at(-1) ?? ""];
    if (own) parts[parts.length - 1] = own;
    const path = parts.join("/");
    const text = textOf(file);
    if (text === undefined || CONTENT_FOLDERS.some((folder) => path.startsWith(`${folder}/`))) {
      files.set(path, file);
      continue;
    }
    // `-cache` and every other name made from the Worker's follow it.
    let changed = text.replaceAll(TEMPLATE_WORKER, worker);
    // The README's steps say where the placeholders were, which its first section says are filled in.
    if (path !== "README.md") {
      changed = changed
        .replaceAll(TEMPLATE_CONTENT_REPO, contentRepo)
        // The code's placeholder is the start of the content's, which is already replaced.
        .replace(new RegExp(`${TEMPLATE_CODE_REPO.replace("/", "\\/")}(?![\\w-])`, "g"), codeRepo);
    }
    if (path === "wrangler.jsonc" && siteUrl) changed = changed.replace(TEMPLATE_SITE_URL, siteUrl);
    files.set(path, changed === text && typeof file !== "string" ? file : changed);
  }
  const pkg = files.get("package.json");
  if (pkg === undefined) throw new Error("The template has no package.json.");
  files.set("package.json", sitePackageJson(siteFileText(pkg), sitePackageName(name), versions));
  // The content, in a repository of its own, as on a developer's computer and in the Deploy workflow.
  for (const path of [...files.keys()]) {
    if (CONTENT_FOLDERS.some((folder) => path.startsWith(`${folder}/`))) {
      files.set(`${CONTENT_REPOSITORY_DIR}/${path}`, files.get(path) as SiteFile);
      files.delete(path);
    }
  }
  if (files.has("vitest.config.ts")) files.set("vitest.config.ts", SITE_VITEST_CONFIG);
  files.set(`${CONTENT_REPOSITORY_DIR}/.github/workflows/deploy-site.yml`, deploySiteWorkflow(codeRepo));
  files.set(`${CONTENT_REPOSITORY_DIR}/README.md`, serverContentReadme(sitePackageName(name), codeRepo));
  const gitignore = files.get(".gitignore");
  files.set(".gitignore", `${gitignore === undefined ? "" : siteFileText(gitignore).trimEnd()}\n${CODE_GITIGNORE}`);
  const readme = files.get("README.md");
  if (readme !== undefined) {
    const text = withoutRepositoryNotes(siteFileText(readme));
    // Before the first section, where people setting the site up start reading.
    const at = text.indexOf("\n## ");
    const section = namesSection(worker, codeRepo, contentRepo);
    files.set(
      "README.md",
      at === -1 ? `${text.trimEnd()}\n\n${section}` : `${text.slice(0, at + 1)}${section}${text.slice(at + 1)}`,
    );
  }
  return files;
}
