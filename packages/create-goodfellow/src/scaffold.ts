import { spawnSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  type Backend,
  BUNDLED_GITIGNORE,
  CONTENT_REPOSITORY_DIR,
  GOODFELLOW_REGISTRY,
  type Host,
  planSite,
  type SeparateContent,
  type SetupRegistry,
  type SiteFiles,
  sitePackageName,
} from "@goodfellow-cms/core";
import { setUpContentRepository } from "@goodfellow-cms/core/node";

export {
  type Backend,
  BLOCK_CHOICES,
  type BlockChoice,
  BUNDLED_GITIGNORE,
  CONTENT_BUILDS,
  CONTENT_REPOSITORY_DIR,
  type ContentBuild,
  configureBackend,
  contentBuildsFor,
  HOSTS,
  type Host,
  hostsFor,
  parseRepo,
  type SeparateContent,
  sitePackageJson,
  TEMPLATES,
  type TemplateName,
  withoutRepositoryNotes,
} from "@goodfellow-cms/core";

/** A problem the person creating the site can fix, described in plain words. */
export class ScaffoldError extends Error {
  override name = "ScaffoldError";
}

/** Never copied, wherever they are: installed packages and build caches. */
const SKIPPED = new Set(["node_modules", ".turbo"]);

/** Never copied from the template's own folder: build output, and files only the Goodfellow repository uses. */
const SKIPPED_AT_ROOT = new Set(["dist", "out", ".next", "next-env.d.ts", "turbo.json"]);

/**
 * Copies a template's files, leaving out installed packages and build output.
 * `bundling` renames `.gitignore` files for publishing; otherwise they're renamed back.
 */
export async function copyTemplate(from: string, to: string, { bundling = false } = {}): Promise<void> {
  await cp(from, to, {
    recursive: true,
    filter: (source) => {
      const path = relative(from, source).split(sep);
      return !path.some((part) => SKIPPED.has(part)) && !SKIPPED_AT_ROOT.has(path[0] ?? "");
    },
  });
  const [find, replace] = bundling ? [".gitignore", BUNDLED_GITIGNORE] : [BUNDLED_GITIGNORE, ".gitignore"];
  for (const file of await readdir(to, { recursive: true })) {
    if (basename(file) === find) await rename(join(to, file), join(to, file.slice(0, -find.length) + replace));
  }
}

/** A valid npm package name from a folder name, such as `My Parish` → `my-parish`. */
export function packageName(folder: string): string {
  return sitePackageName(basename(resolve(folder)));
}

/** Reads a built registry from disk, as the admin panel would read it from its address. */
function localRegistry(dir: string): SetupRegistry {
  const base = "https://registry.invalid/r/";
  return {
    registries: { [GOODFELLOW_REGISTRY]: `${base}{name}.json` },
    fetchJson: async (url) => JSON.parse(await readFile(join(dir, url.slice(base.length)), "utf8")),
  };
}

/** Reads a template's files, leaving out installed packages and build output, as `copyTemplate()` does. */
export async function readTemplate(dir: string): Promise<SiteFiles> {
  const files: SiteFiles = new Map();
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = relative(dir, join(entry.parentPath, entry.name)).split(sep);
    if (path.some((part) => SKIPPED.has(part)) || SKIPPED_AT_ROOT.has(path[0] ?? "")) continue;
    files.set(path.join("/"), new Uint8Array(await readFile(join(dir, ...path))));
  }
  return files;
}

export interface ScaffoldOptions {
  /** The template's folder. */
  template: string;
  /** The new site's folder. It must be empty or not exist yet. */
  target: string;
  /** Versions of Goodfellow's packages, by name, to replace the template's workspace links. */
  versions: Record<string, string>;
  backend?: Backend;
  /** Keeps only this host's setup file. All are kept if it isn't set. */
  host?: Host;
  /** The built block registry to install recommended blocks from. Without it, the site has the built-in blocks only. */
  registryDir?: string;
  /**
   * Keeps the content in a repository of its own, in the site's
   * `content-repository/` folder, which `content/` and `public/media/` link to.
   * `backend` is then the code's repository.
   */
  content?: SeparateContent;
}

async function isEmptyFolder(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length === 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

/** What `initGitRepository()` did: made a repository, or why it didn't. */
export type GitResult = { created: true; remote?: string } | { created: false; reason: "no-git" | "inside-repository" };

/** Where a backend's repository is pushed to, over HTTPS. */
export function remoteUrl(backend: Backend): string {
  const host = backend.host === "github" ? "github.com" : "gitlab.com";
  return `https://${host}/${backend.repo}.git`;
}

/**
 * Makes the new site a git repository on the branch `main`, which the deploy
 * setups build from, with `origin` set when the site's repository is known.
 * A folder inside another repository, such as a monorepo, is left as it is.
 */
export function initGitRepository(target: string, backend?: Backend): GitResult {
  const git = (...args: string[]) => spawnSync("git", args, { cwd: target, encoding: "utf8" });
  const inside = git("rev-parse", "--is-inside-work-tree");
  if (inside.error) return { created: false, reason: "no-git" };
  if (inside.status === 0) return { created: false, reason: "inside-repository" };
  // `-b` needs git 2.28 or later; older ones start on their default branch, which is then renamed.
  if (git("init", "-q", "-b", "main").status !== 0) {
    if (git("init", "-q").status !== 0) return { created: false, reason: "no-git" };
    git("symbolic-ref", "HEAD", "refs/heads/main");
  }
  if (!backend) return { created: true };
  const remote = remoteUrl(backend);
  git("remote", "add", "origin", remote);
  return { created: true, remote };
}

/**
 * Runs `npm install` in the new site, showing its output. Its `package-lock.json`
 * goes in the first commit, since the deploy setups install with `npm ci`.
 */
export function installPackages(target: string): boolean {
  // npm is a .cmd file on Windows, which Node only starts through a shell.
  const result =
    process.platform === "win32"
      ? spawnSync("npm install", { cwd: target, stdio: "inherit", shell: true })
      : spawnSync("npm", ["install"], { cwd: target, stdio: "inherit" });
  return result.status === 0;
}

/** How the first commit went: made, or not because git doesn't know who's committing yet, or failed. */
export type CommitResult = "committed" | "no-identity" | "failed";

/** Commits everything in the new site, which `.gitignore` doesn't leave out. */
export function commitAll(target: string, message: string): CommitResult {
  const git = (...args: string[]) => spawnSync("git", args, { cwd: target, encoding: "utf8" });
  if (git("add", "-A").status !== 0) return "failed";
  const commit = git("commit", "-q", "-m", message);
  if (commit.status === 0) return "committed";
  return /user\.(name|email)|tell me who you are|identity/i.test(commit.stderr) ? "no-identity" : "failed";
}

/** Creates a new site in `target` from a template. */
export async function scaffold({
  template,
  target,
  versions,
  backend,
  host,
  registryDir,
  content,
}: ScaffoldOptions): Promise<void> {
  if (!(await isEmptyFolder(target))) {
    throw new ScaffoldError(`The folder ${target} already has files in it. Choose a new folder for the site.`);
  }
  const files = await planSite({
    template: await readTemplate(template),
    name: packageName(target),
    versions,
    backend,
    host,
    registry: registryDir ? localRegistry(registryDir) : undefined,
    content,
  });
  await mkdir(target, { recursive: true });
  for (const [path, file] of files) {
    await mkdir(dirname(join(target, path)), { recursive: true });
    await writeFile(join(target, path), file);
  }
  // So `npm run dev` reads and saves the content repository's own files.
  if (content) await setUpContentRepository(target);
}

/** The content repository's folder, inside the site's. */
export function contentRepositoryDir(target: string): string {
  return join(target, CONTENT_REPOSITORY_DIR);
}
