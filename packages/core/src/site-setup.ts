/**
 * Creating a new site from a template, as `create-goodfellow` does on a
 * computer and the documentation site's setup page does in the browser: the
 * same choices, worked out the same way, with no disk access.
 */

import {
  adminOrigin,
  vercelHeaders,
  withAdminConfig,
  withVercelAdminAddress,
  withVercelHeaders,
} from "./admin-domain.js";
import { BITBUCKET_PIPELINES, bitbucketPipelines } from "./bitbucket-setup.js";
import { cloudflareSetupFiles } from "./cloudflare-setup.js";
import { CONTENT_REPOSITORY_DIR, INSTALLED_PLUGINS_FILE } from "./content/paths.js";
import { CONTENT_FOLDERS } from "./content/store.js";
import {
  CODE_GITIGNORE,
  codeReadmeSection,
  contentReadme,
  type SeparateContent,
  SINGLE_REPOSITORY_SETUP_FILES,
  separateSetupFiles,
} from "./content-repository-setup.js";
import { CONFIG_FILE, type PluginPackage, planPluginInstall } from "./plugin-packages.js";
import {
  availableBlocks,
  EMPTY_RECORD,
  type FetchJson,
  type InstalledRecord,
  planInstall,
  type RegistrySources,
} from "./registry.js";
import { gitlabTaskJob } from "./task-setup.js";
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
  host: "github" | "gitlab" | "bitbucket";
  /**
   * `owner/name` on GitHub, the project's path on GitLab, such as
   * `group/subgroup/site`, or `workspace/repository` on Bitbucket.
   */
  repo: string;
}

/** The workflow that runs plugins' tasks on GitHub, which every GitHub site has, whoever builds it. */
export const GITHUB_TASK_WORKFLOW = ".github/workflows/plugin-task.yml";

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
    note: "Works with GitHub, GitLab and Bitbucket. The free plan is for non-commercial sites only.",
  },
  // Its setup files are written for the site by cloudflareSetupFiles(), in place of the other hosts'.
  "cloudflare-pages": {
    label: "Cloudflare Pages",
    files: [],
    note: "Works with GitHub and GitLab, including private repositories. No rule against business sites that we know of.",
  },
} as const;

export type Host = keyof typeof HOSTS;

/**
 * The hosts that can serve a site stored with `backend`: GitHub Pages only
 * builds GitHub repositories, and so on. Bitbucket's own static websites have
 * one address for each workspace and no custom domains, and Cloudflare Pages
 * doesn't build from Bitbucket, so its sites are built by Vercel.
 */
export function hostsFor(backend: Backend["host"] | undefined): Host[] {
  if (backend === "github") return ["github-pages", "cloudflare-pages", "vercel"];
  if (backend === "gitlab") return ["gitlab-pages", "cloudflare-pages", "vercel"];
  if (backend === "bitbucket") return ["vercel"];
  return ["github-pages", "gitlab-pages", "cloudflare-pages", "vercel"];
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

/** npm leaves `.npmrc` files out of published packages too, so templates are bundled with `_npmrc`. */
export const BUNDLED_NPMRC = "_npmrc";

/** Files templates are bundled with under another name, by the name they're bundled with. */
export const BUNDLED_NAMES: Readonly<Record<string, string>> = {
  [BUNDLED_GITIGNORE]: ".gitignore",
  [BUNDLED_NPMRC]: ".npmrc",
};

/** A valid npm package name from a site's name, such as `My Parish` → `my-parish`. */
export function sitePackageName(name: string): string {
  const dashed = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  const cleaned = trimChars(trimChars(dashed, "._-", { end: false }), "-", { start: false });
  return cleaned.slice(0, 214) || "my-site";
}

/** Each host's addresses, which a repository's address starts with. */
const REPO_PREFIXES: Record<Backend["host"], RegExp> = {
  github: /^(?:https?:\/\/)?(?:www\.)?github\.com\//i,
  gitlab: /^(?:https?:\/\/)?gitlab\.com\//i,
  bitbucket: /^(?:https?:\/\/)?(?:[^@/]+@)?bitbucket\.org\//i,
};

/** What each host's repository paths look like: Bitbucket's workspace and repository names are lowercase. */
const REPO_PATTERNS: Record<Backend["host"], RegExp> = {
  github: /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/,
  gitlab: /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)+$/,
  bitbucket: /^[a-z0-9][a-z0-9_-]*\/[a-z0-9_.-]+$/,
};

/**
 * Reads a repository from what someone typed: `owner/name`, or its address on
 * GitHub, GitLab or Bitbucket. Returns `undefined` if it isn't one.
 */
export function parseRepo(host: Backend["host"], input: string): string | undefined {
  let path = trimChars(input.trim().replace(/\.git$/, ""), "/", { start: false });
  path = path.replace(REPO_PREFIXES[host], "");
  // Bitbucket's own pages for a repository add parts after it, such as /src/main/.
  if (host === "bitbucket") path = path.split("/").slice(0, 2).join("/").toLowerCase();
  return REPO_PATTERNS[host].test(path) ? path : undefined;
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
    backend.host === "gitlab"
      ? `gitlab({ project: ${JSON.stringify(backend.repo)}${only} })`
      : `${backend.host}({ repo: ${JSON.stringify(backend.repo)}${only} })`;
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
  /** The template's files, with `_gitignore` for `.gitignore` and `_npmrc` for `.npmrc` as bundled templates have them. */
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
  /**
   * An admin address of its own, such as `https://admin.example.org`, which the
   * config names (`withAdminConfig()`) for the Domain screen to check once the
   * site is online. Only for hosts that serve a site at more than one address.
   */
  admin?: string;
  /**
   * Plugins to install, as the admin panel's Plugins screen would
   * (`planPluginInstall()`): each in `package.json` at its release, and
   * recorded with what it asks to do in `plugins/installed/`.
   */
  plugins?: PluginPackage[];
  /** Today, `YYYY-MM-DD`, for the plugins' record. */
  today?: string;
}

/** Hosts that serve a site at more than one address, which an admin address needs: not GitHub Pages. */
export function allowsAdminAddress(host: Host | undefined): boolean {
  return host === "gitlab-pages" || host === "cloudflare-pages" || host === "vercel";
}

/** The README's section on a new site's admin address, which the config names but nobody has checked yet. */
function adminReadmeSection(admin: string, cli: string, separate: boolean): string {
  const domain = admin.replace(/^https?:\/\//, "");
  const check = separate
    ? `Then, since the config is kept apart from the content the admin panel publishes, run \`npx ${cli} admin check\` here: it checks that the site's pages at ${domain} leave it before running anything, and marks the address checked in \`goodfellow.config.tsx\`. Publish that, and once the site has rebuilt, the admin panel opens only at ${admin}.`
    : `Then open the admin panel at ${admin}/admin/: Site Settings → Domain checks the address from there, and starts using it.`;
  return `## Admin address

\`goodfellow.config.tsx\` names ${admin} as the admin panel's address of its own, so the site's pages can't reach editors' sign-in. Once the site is online, connect ${domain} to it at its host: Site Settings → Domain does this on GitLab Pages. ${check}
`;
}

/** The README's section on a site stored on Bitbucket: what Vercel and Bitbucket Pipelines need. */
function bitbucketReadmeSection(cli: string): string {
  return `## Bitbucket and Vercel

The site is stored on Bitbucket and built by Vercel, which builds and publishes it on every change to the main branch. \`${BITBUCKET_PIPELINES}\` has Bitbucket Pipelines keep it current. To set them up, once:

1. In Vercel, import the repository from Bitbucket. \`vercel.ts\` already has the right settings. Under the project's **Settings → Git → Deploy Hooks**, create a hook for the main branch and copy its address.
2. In the repository on Bitbucket, turn on Pipelines (**Repository settings → Pipelines → Settings**), and under **Repository settings → Pipelines → Repository variables**, add the hook's address as \`VERCEL_DEPLOY_HOOK\`, with **Secured** ticked.
3. In the admin panel, open **Site Settings → Updates** and turn on updates: it adds a schedule that checks each night whether the site needs rebuilding or has fixes to install. Doing this needs the repository's Admin permission. Each check takes about a minute of Bitbucket's build minutes, of which the free plan has 50 a month.

Pages and items scheduled to be shown or hidden go live at their time: the admin panel adds a schedule under **Pipelines → Schedules** for each time, which runs the \`scheduled\` pipeline then, and removes it once it has passed. That pipeline only asks Vercel to rebuild the site, so it takes seconds of build minutes. Adding schedules needs permission to change the repository's Pipelines settings, so an owner opening the admin panel adds any that an editor couldn't.

Plugins' tasks, such as S3 storage signing uploads, run in the same pipelines (\`npx ${cli} task\`), with the secrets they need added as secured repository variables.
`;
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
  admin,
  plugins = [],
  today = new Date().toISOString().slice(0, 10),
}: SitePlan): Promise<SiteFiles> {
  if (content && (!backend || !host)) {
    throw new Error("Keeping the content in a repository of its own needs both repositories and a host.");
  }
  const adminUrl = admin === undefined ? undefined : adminOrigin({ url: admin });
  if (admin !== undefined && (!adminUrl || !allowsAdminAddress(host))) {
    throw new Error(
      "An admin address needs an https:// address of its own, and a host that serves a site at more than one address.",
    );
  }
  if (backend && host && !hostsFor(backend.host).includes(host)) {
    throw new Error(`${HOSTS[host].label} can't build a site stored on ${backend.host}.`);
  }
  const files: SiteFiles = new Map();
  for (const [path, file] of template) {
    const parts = path.split("/");
    const name = BUNDLED_NAMES[parts.at(-1) ?? ""];
    if (name) parts[parts.length - 1] = name;
    files.set(parts.join("/"), file);
  }

  const pkg = files.get("package.json");
  if (pkg === undefined) throw new Error("The template has no package.json.");
  files.set("package.json", sitePackageJson(siteFileText(pkg), name, versions));

  const readme = files.get("README.md");
  if (readme !== undefined) files.set("README.md", withoutRepositoryNotes(siteFileText(readme)));

  if (registry) await installRecommendedBlocks(files, registry);

  for (const plugin of plugins) {
    const text = (path: string) => {
      const file = files.get(path);
      return file === undefined ? undefined : siteFileText(file);
    };
    const record = text(INSTALLED_PLUGINS_FILE);
    const plan = planPluginInstall(
      {
        packageJson: text("package.json") ?? "{}",
        config: text(CONFIG_FILE) ?? "",
        ...(record !== undefined && { record }),
        // The site's blocks are known only once its config loads, which stops for a clash then.
        blocks: [],
        plugins: [],
      },
      plugin,
      { today },
    );
    for (const change of plan.changes) if ("content" in change) files.set(change.path, change.content);
  }

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
  if (adminUrl) {
    const config = files.get("goodfellow.config.tsx");
    const edited = config === undefined ? undefined : withAdminConfig(siteFileText(config), { url: adminUrl });
    if (edited === undefined) throw new Error("The template's goodfellow.config.tsx has no defineConfig({.");
    files.set("goodfellow.config.tsx", edited);
    const readme = files.get("README.md");
    if (readme !== undefined) {
      const cli = files.has("next.config.ts") ? "goodfellow-next" : "goodfellow";
      files.set("README.md", `${siteFileText(readme).trimEnd()}\n\n${adminReadmeSection(adminUrl, cli, !!content)}`);
    }
  }

  if (content && backend && host) {
    separateContent(files, name, { ...content, git: backend.host, code: backend.repo, host });
    // Vercel reads a content repository's vercel.ts before the code is cloned, so it gets the header rules written out.
    const vercel = files.get(`${CONTENT_REPOSITORY_DIR}/vercel.ts`);
    if (adminUrl && vercel !== undefined) {
      const withHeaders = withVercelHeaders(siteFileText(vercel), vercelHeaders({ admin: { url: adminUrl } }));
      const edited = withHeaders && (withVercelAdminAddress(withHeaders, { url: adminUrl }) ?? withHeaders);
      if (edited !== undefined) files.set(`${CONTENT_REPOSITORY_DIR}/vercel.ts`, edited);
    }
  } else if (host) {
    for (const [other, { files: setupFiles }] of Object.entries(HOSTS)) {
      if (other !== host) for (const file of setupFiles) files.delete(file);
    }
    if (host === "cloudflare-pages" && backend?.host !== "bitbucket") {
      for (const [path, text] of cloudflareSetupFiles({ git: backend?.host, next: files.has("next.config.ts") })) {
        files.set(path, text);
      }
    }
    // Plugins' tasks run on the git host's CI, whoever builds the site.
    const cli = files.has("next.config.ts") ? "goodfellow-next" : "goodfellow";
    if (backend && backend.host !== "github") files.delete(GITHUB_TASK_WORKFLOW);
    if (backend?.host === "gitlab" && host === "vercel") files.set(".gitlab-ci.yml", gitlabTaskJob(cli));
    if (backend?.host === "bitbucket") {
      files.set(BITBUCKET_PIPELINES, bitbucketPipelines(cli));
      const readme = files.get("README.md");
      if (readme !== undefined)
        files.set("README.md", `${siteFileText(readme).trimEnd()}\n\n${bitbucketReadmeSection(cli)}`);
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
  // Plugins' tasks run in the starters' GitHub workflow, which a separate site's content repository can't run yet.
  if (git !== "github") files.delete(GITHUB_TASK_WORKFLOW);
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
