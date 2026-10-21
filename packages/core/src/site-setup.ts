/**
 * Creating a new site from a template, as `create-goodfellow` does on a
 * computer and the documentation site's setup page does in the browser: the
 * same choices, worked out the same way, with no disk access.
 */

import { CONTENT_REPOSITORY_DIR } from "./content/paths.js";
import { CONTENT_FOLDERS } from "./content/store.js";
import {
  CODE_GITIGNORE,
  codeReadmeSection,
  contentReadme,
  type SeparateContent,
  SINGLE_REPOSITORY_SETUP_FILES,
  separateSetupFiles,
} from "./content-repository-setup.js";
import {
  availableBlocks,
  EMPTY_RECORD,
  type FetchJson,
  type InstalledRecord,
  planInstall,
  type RegistrySources,
} from "./registry.js";
import { trimChars } from "./trim.js";

/** The sites a new site can start from. The keys are what `--template` takes. */
export const TEMPLATES = {
  starter: { label: "Starter", description: "A simple site with a few pages and a news section" },
  parish: {
    label: "Parish example",
    description: "A made-up parish with Mass times, events, news, bulletins and staff, and blocks of its own",
  },
  next: {
    label: "Starter for Next.js",
    description: "The starter as a Next.js site, for developers who want their own Next.js pages beside it",
  },
} as const;

export type TemplateName = keyof typeof TEMPLATES;

/** Where the site's repository is stored, which the admin panel publishes to. */
export interface Backend {
  host: "github" | "gitlab";
  /** `owner/name` on GitHub, or the project's path on GitLab, such as `group/subgroup/site`. */
  repo: string;
}

/** Where the built site is served from. Each has its own setup file in the template. */
export const HOSTS = {
  "github-pages": {
    label: "GitHub Pages",
    files: [".github/workflows/deploy.yml", ".github/workflows/scheduled.yml"],
    note: "Free for public repositories. Not allowed for online businesses or shops.",
  },
  "gitlab-pages": {
    label: "GitLab Pages",
    files: [".gitlab-ci.yml"],
    note: "Free, including for private projects. No rule against business sites that we know of.",
  },
  vercel: {
    label: "Vercel",
    files: ["vercel.ts"],
    note: "Works with GitHub and GitLab. The free plan is for non-commercial sites only.",
  },
} as const;

export type Host = keyof typeof HOSTS;

/** The hosts that can serve a site stored with `backend`: GitHub Pages only builds GitHub repositories, and so on. */
export function hostsFor(backend: Backend["host"] | undefined): Host[] {
  if (backend === "github") return ["github-pages", "vercel"];
  if (backend === "gitlab") return ["gitlab-pages", "vercel"];
  return ["github-pages", "gitlab-pages", "vercel"];
}

/** Which blocks a new site starts with, besides the built-in ones. */
export const BLOCK_CHOICES = {
  recommended: {
    label: "Recommended",
    description: "Adds the recommended blocks, such as Hero, Cards and FAQ. Others can be added in the admin panel.",
  },
  "built-in": {
    label: "Built-in blocks only",
    description: "Starts with Goodfellow's own blocks. More can be added in the admin panel.",
  },
} as const;

export type BlockChoice = keyof typeof BLOCK_CHOICES;

/**
 * npm leaves `.gitignore` files out of published packages, so templates are
 * bundled with `_gitignore` instead, and it's renamed back in the new site.
 */
export const BUNDLED_GITIGNORE = "_gitignore";

/** A valid npm package name from a site's name, such as `My Parish` → `my-parish`. */
export function sitePackageName(name: string): string {
  const dashed = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  const cleaned = trimChars(trimChars(dashed, "._-", { end: false }), "-", { start: false });
  return cleaned.slice(0, 214) || "my-site";
}

/**
 * Reads a repository from what someone typed: `owner/name`, or its address on
 * GitHub or GitLab. Returns `undefined` if it isn't one.
 */
export function parseRepo(host: Backend["host"], input: string): string | undefined {
  let path = trimChars(input.trim().replace(/\.git$/, ""), "/", { start: false });
  const prefix = host === "github" ? /^(?:https?:\/\/)?(?:www\.)?github\.com\//i : /^(?:https?:\/\/)?gitlab\.com\//i;
  path = path.replace(prefix, "");
  const pattern =
    host === "github" ? /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/ : /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)+$/;
  return pattern.test(path) ? path : undefined;
}

/** The template's `package.json`, named for the new site and with workspace links replaced by published versions. */
export function sitePackageJson(source: string, name: string, versions: Record<string, string>): string {
  const pkg = JSON.parse(source) as Record<string, unknown> & { version?: string };
  const result: Record<string, unknown> = { ...pkg, name };
  for (const key of ["dependencies", "devDependencies"] as const) {
    const deps = pkg[key] as Record<string, string> | undefined;
    if (!deps) continue;
    result[key] = Object.fromEntries(
      Object.entries(deps).map(([dep, range]) => {
        if (!range.startsWith("workspace:")) return [dep, range];
        const version = versions[dep];
        if (!version) throw new Error(`No version of ${dep} to use in the new site.`);
        return [dep, `^${version}`];
      }),
    );
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}

/**
 * Turns on one of the commented-out `backend` lines in a template's
 * `goodfellow.config.tsx`, for a repository that holds only the site's content
 * where `contentOnly`, with its code in `code`.
 */
export function configureBackend(
  config: string,
  backend: Backend,
  { contentOnly = false, code }: { contentOnly?: boolean; code?: string } = {},
): string {
  const importLine = `// import { ${backend.host} } from "@goodfellow-cms/${backend.host}";`;
  const backendLine = new RegExp(`^([ \\t]*)// backend: ${backend.host}\\(.*$`, "m");
  if (!config.includes(importLine) || !backendLine.test(config)) {
    throw new Error(`The template's goodfellow.config.tsx has no ${backend.host} line to turn on.`);
  }
  const only = `${contentOnly ? ", contentOnly: true" : ""}${code ? `, code: ${JSON.stringify(code)}` : ""}`;
  const call =
    backend.host === "github"
      ? `github({ repo: ${JSON.stringify(backend.repo)}${only} })`
      : `gitlab({ project: ${JSON.stringify(backend.repo)}${only} })`;
  return config.replace(importLine, importLine.slice(3)).replace(backendLine, `$1backend: ${call},`);
}

/** Marks notes in a site's README for people reading it in the Goodfellow repository, which new sites don't need. */
const NOTE_START = "<!-- goodfellow-repository -->";
const NOTE_END = "<!-- /goodfellow-repository -->";

/** A site's README without the notes for people reading it in the Goodfellow repository. */
export function withoutRepositoryNotes(readme: string): string {
  let result = "";
  let from = 0;
  for (;;) {
    const start = readme.indexOf(NOTE_START, from);
    const end = start === -1 ? -1 : readme.indexOf(NOTE_END, start + NOTE_START.length);
    if (end === -1) return result + readme.slice(from);
    result += readme.slice(from, start);
    from = end + NOTE_END.length;
    while (readme.charAt(from) === "\n") from++;
  }
}

/** A file of a site: text, or bytes for files that may not be, such as images. */
export type SiteFile = string | Uint8Array;

/** A site's files by path, such as `content/pages/index.json`. */
export type SiteFiles = Map<string, SiteFile>;

/** A site file as text, for the few files that are changed. */
export function siteFileText(file: SiteFile): string {
  return typeof file === "string" ? file : new TextDecoder().decode(file);
}

/** The block registry to install the recommended blocks from. */
export interface SetupRegistry {
  registries: RegistrySources;
  fetchJson: FetchJson;
}

/**
 * Installs the registry's recommended blocks into a new site's files, as the
 * admin panel's Blocks screen would, so the site can add and remove them there
 * later. Returns their names.
 */
export async function installRecommendedBlocks(files: SiteFiles, { registries, fetchJson }: SetupRegistry) {
  const recommended = (await availableBlocks(registries, fetchJson)).filter((block) => block.recommended);
  let record: InstalledRecord = EMPTY_RECORD;
  for (const block of recommended) {
    const plan = await planInstall({
      ref: block.ref,
      registries,
      fetchJson,
      readFile: async (path) => {
        const file = files.get(path);
        return file === undefined ? undefined : siteFileText(file);
      },
      record,
      blocks: [],
    });
    for (const change of plan.changes) {
      if ("content" in change) files.set(change.path, change.content);
      else if ("bytes" in change) files.set(change.path, change.bytes);
      else files.delete(change.path);
    }
    record = plan.record;
  }
  return recommended.map((block) => block.title);
}

export interface SitePlan {
  /** The template's files, with `_gitignore` for `.gitignore` as bundled templates have them. */
  template: SiteFiles;
  /** The new site's npm package name. */
  name: string;
  /** Versions of Goodfellow's packages, by name, to replace the template's workspace links. */
  versions: Record<string, string>;
  backend?: Backend;
  /** Keeps only this host's setup file. All are kept if it isn't set. */
  host?: Host;
  /** The block registry to install recommended blocks from. Without it, the site has the built-in blocks only. */
  registry?: SetupRegistry;
  /**
   * Keeps the content in a repository of its own: `backend` is then the code's
   * repository, and the content's files, with its setup files, are under
   * `content-repository/`, a folder the code ignores.
   */
  content?: SeparateContent;
}

/** Works out a new site's files from a template and the choices made for it. */
export async function planSite({
  template,
  name,
  versions,
  backend,
  host,
  registry,
  content,
}: SitePlan): Promise<SiteFiles> {
  if (content && (!backend || !host)) {
    throw new Error("Keeping the content in a repository of its own needs both repositories and a host.");
  }
  const files: SiteFiles = new Map();
  for (const [path, file] of template) {
    const parts = path.split("/");
    if (parts.at(-1) === BUNDLED_GITIGNORE) parts[parts.length - 1] = ".gitignore";
    files.set(parts.join("/"), file);
  }

  const pkg = files.get("package.json");
  if (pkg === undefined) throw new Error("The template has no package.json.");
  files.set("package.json", sitePackageJson(siteFileText(pkg), name, versions));

  const readme = files.get("README.md");
  if (readme !== undefined) files.set("README.md", withoutRepositoryNotes(siteFileText(readme)));

  if (registry) await installRecommendedBlocks(files, registry);

  if (backend) {
    const config = files.get("goodfellow.config.tsx");
    if (config === undefined) throw new Error("The template has no goodfellow.config.tsx.");
    const edited = content
      ? configureBackend(
          siteFileText(config),
          { host: backend.host, repo: content.repo },
          { contentOnly: true, code: backend.repo },
        )
      : configureBackend(siteFileText(config), backend);
    files.set("goodfellow.config.tsx", edited);
  }

  if (content && backend && host)
    separateContent(files, name, { ...content, git: backend.host, code: backend.repo, host });
  else if (host) {
    for (const [other, { files: setupFiles }] of Object.entries(HOSTS)) {
      if (other !== host) for (const file of setupFiles) files.delete(file);
    }
  }
  return files;
}

/**
 * Moves a new site's content into `content-repository/`, its own repository,
 * and gives each repository its setup files and README.
 */
function separateContent(
  files: SiteFiles,
  name: string,
  { repo, build, git, code, host }: SeparateContent & { git: Backend["host"]; code: string; host: Host },
): void {
  const setup = { git, host, build, code, content: repo, next: files.has("next.config.ts") };
  const vercel = files.get("vercel.ts");
  const generated = separateSetupFiles(setup, vercel === undefined ? undefined : siteFileText(vercel));
  for (const path of [...files.keys()]) {
    if (CONTENT_FOLDERS.some((folder) => path.startsWith(`${folder}/`))) {
      files.set(`${CONTENT_REPOSITORY_DIR}/${path}`, files.get(path) as SiteFile);
      files.delete(path);
    }
  }
  for (const file of SINGLE_REPOSITORY_SETUP_FILES) files.delete(file);
  for (const [path, text] of generated.code) files.set(path, text);
  for (const [path, text] of generated.content) files.set(`${CONTENT_REPOSITORY_DIR}/${path}`, text);

  const gitignore = files.get(".gitignore");
  files.set(".gitignore", `${gitignore === undefined ? "" : siteFileText(gitignore).trimEnd()}\n${CODE_GITIGNORE}`);
  const readme = files.get("README.md");
  const section = codeReadmeSection(setup);
  if (readme !== undefined) {
    const text = siteFileText(readme);
    // Before the first section, where people setting the site up start reading.
    const at = text.indexOf("\n## ");
    files.set(
      "README.md",
      at === -1 ? `${text.trimEnd()}\n\n${section}` : `${text.slice(0, at + 1)}${section}\n${text.slice(at + 1)}`,
    );
  }
  files.set(`${CONTENT_REPOSITORY_DIR}/README.md`, contentReadme(setup, name));
}
