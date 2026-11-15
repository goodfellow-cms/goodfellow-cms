// `create-goodfellow --server cloudflare`: a full-stack site, made from the company example, whose editors sign in
// with the site's own accounts, on a Cloudflare Worker with a D1 database, its code and content in repositories of
// their own on GitHub.
import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { stdin } from "node:process";
import { SERVER_HOSTS, workerName } from "@goodfellow-cms/core";
import { type Runner, runIn, setUpCloudflare, yes } from "./cloudflare-setup.js";
import { gitLines } from "./git-lines.js";
import {
  CONTENT_REPOSITORY_DIR,
  type CommitResult,
  commitAll,
  type GitResult,
  initGitRepository,
  installPackages,
  packageName,
  parseRepo,
  ScaffoldError,
  scaffoldServer,
} from "./scaffold.js";

export interface ServerSiteChoices {
  /** `--server`'s value. */
  server: string;
  folder?: string | undefined;
  /** The code's GitHub repository (`--github`). */
  github?: string | undefined;
  /** The content's (`--content`). */
  content?: string | undefined;
  /** The site's address (`--url`). */
  url?: string | undefined;
  /** Another host was named (`--gitlab`, `--bitbucket`), which full-stack sites can't use yet. */
  otherHost?: string | undefined;
  install: boolean;
  git: boolean;
  /** Whether to ask questions: in a terminal, without `--yes`. */
  interactive: boolean;
}

export interface ServerSiteIo {
  ask: (question: string) => Promise<string>;
  say: (text: string) => void;
  /** create-goodfellow's bundled templates. */
  templatesDir: string;
  versions: Record<string, string>;
  /** Runs programs in the new site's folder; tests give their own. */
  runner?: (target: string) => Runner;
  install?: (target: string) => boolean;
  /** Whether this runs in CI, where nobody can sign in or type a secret: `CI` by default. */
  ci?: boolean;
}

/** The site's address as someone typed it, or a problem with it. */
export function siteAddress(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ScaffoldError(`${input.trim()} isn't an address. Type it as https://www.example.org.`);
  }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new ScaffoldError("The site's address is https:// and a domain, such as https://www.example.org.");
  }
  return url.origin;
}

async function askUntil<T>(io: ServerSiteIo, question: string, read: (answer: string) => T): Promise<T> {
  for (;;) {
    try {
      return read(await io.ask(question));
    } catch (error) {
      if (!(error instanceof ScaffoldError)) throw error;
      io.say(`${error.message}\n`);
    }
  }
}

/** Whether two repositories are the same one, as GitHub reads their names, whatever their spelling. */
function sameRepo(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function githubRepo(input: string, what: string): string {
  const repo = parseRepo("github", input);
  if (!repo) throw new ScaffoldError(`${what} is a GitHub repository, such as your-name/your-site.`);
  return repo;
}

/** Makes a full-stack site, as `--server` asks, and offers to put it online on Cloudflare. */
export async function createServerSite(choices: ServerSiteChoices, io: ServerSiteIo): Promise<void> {
  if (!Object.hasOwn(SERVER_HOSTS, choices.server)) {
    throw new ScaffoldError(`--server takes ${Object.keys(SERVER_HOSTS).join(" or ")}.`);
  }
  if (choices.otherHost) {
    throw new ScaffoldError("A full-stack site keeps its code and content on GitHub for now: give --github.");
  }
  let { folder, github, content, url } = choices;
  // Nothing is asked in CI, where nobody answers, nor is wrangler offered, since nobody can sign in or type a secret.
  const asking = choices.interactive && !(io.ci ?? Boolean(process.env.CI));
  if (asking) {
    folder ??= (await io.ask("Folder for the new site (my-site): ")).trim() || "my-site";
    github ??= await askUntil(io, "\nThe GitHub repository for the site's code, such as your-name/your-site: ", (a) =>
      githubRepo(a, "The code's repository"),
    );
    const codeRepo = githubRepo(github, "--github");
    const suggested = `${codeRepo}-content`;
    content ??= await askUntil(io, `The GitHub repository for its content (${suggested}): `, (a) => {
      const repo = a.trim() === "" ? suggested : githubRepo(a, "The content's repository");
      // Asked again at once, rather than refused once every question is answered.
      if (sameRepo(repo, codeRepo))
        throw new ScaffoldError("The content needs a repository of its own, not the code's.");
      return repo;
    });
    url ??= await askUntil(
      io,
      "The site's address, such as https://www.example.org (leave empty to set it later): ",
      (a) => (a.trim() === "" ? "" : siteAddress(a)),
    );
  }
  if (!folder) {
    throw new ScaffoldError(
      "Say which folder to create the site in, such as: npm create goodfellow@latest my-site -- --server cloudflare",
    );
  }
  const code = github === undefined ? undefined : githubRepo(github, "--github");
  // As the question suggests it, when the code's is given and the content's isn't.
  const contentRepo = content === undefined ? code && `${code}-content` : githubRepo(content, "--content");
  if (code && contentRepo && sameRepo(contentRepo, code))
    throw new ScaffoldError("The content needs a repository of its own, not the code's.");
  const address = url ? siteAddress(url) : undefined;

  const target = resolve(folder);
  await scaffoldServer({
    template: join(io.templatesDir, "company"),
    target,
    versions: io.versions,
    ...(code && { code }),
    ...(contentRepo && { content: contentRepo }),
    ...(address && { siteUrl: address }),
  });

  // The content repository first: inside the code's repository, git would count it as part of it.
  const contentDir = join(target, CONTENT_REPOSITORY_DIR);
  const contentGit: GitResult | undefined = choices.git
    ? initGitRepository(contentDir, contentRepo ? { host: "github", repo: contentRepo } : undefined)
    : undefined;
  const contentCommit: CommitResult | undefined = contentGit?.created
    ? commitAll(contentDir, "Create the site's content")
    : undefined;
  const git: GitResult | undefined = choices.git
    ? initGitRepository(target, code ? { host: "github", repo: code } : undefined)
    : undefined;
  const installed = choices.install ? (io.install ?? installPackages)(target) : false;
  // Without npm install, there's no lockfile yet, which gitLines() says to commit once there is.
  const commit: CommitResult | undefined =
    git?.created && (installed || !choices.install) ? commitAll(target, "Create the site") : undefined;

  const worker = workerName(packageName(target));
  let left: string[] | undefined;
  if (asking && installed) {
    const answer = await io.ask("\nPut the site online on Cloudflare now, with wrangler? (Y/n) ");
    if (yes(answer)) {
      const wranglerFile = join(target, "wrangler.jsonc");
      const before = await readFile(wranglerFile, "utf8");
      left = await setUpCloudflare({
        target,
        worker,
        run: (io.runner ?? runIn)(target),
        ask: io.ask,
        say: io.say,
        hasAddress: address !== undefined,
      });
      // The database's and KV namespace's ids, which wrangler.jsonc now has, where the site's first commit was made.
      if (commit === "committed" && (await readFile(wranglerFile, "utf8")) !== before) {
        if (commitAll(target, "Name the site's Cloudflare database and cache") !== "committed") {
          left.push("Commit wrangler.jsonc, which now names the site's Cloudflare database and cache.");
        }
      }
    }
  }

  const where = relative(process.cwd(), target) || ".";
  const quoted = /\s/.test(where) ? JSON.stringify(where) : where;
  const contentWhere = join(where, CONTENT_REPOSITORY_DIR);
  const lines = [
    "",
    `Created a full-stack site in ${where}, with its content in ${contentWhere}, which content/ and public/media/ link to.`,
    ...(git ? gitLines(git, commit, installed) : []),
    ...(contentGit?.created
      ? [
          contentCommit === "committed"
            ? `${contentWhere} is a repository of its own, with the content in its first commit.`
            : `${contentWhere} is a repository of its own, but nothing in it is committed yet: commit it as well.`,
        ]
      : []),
    ...(code
      ? [`Push the content to ${contentRepo} first, then the code to ${code}.`]
      : ["Make its two GitHub repositories, name them as README.md's first section says, and push them."]),
    ...(!installed && choices.install ? ["npm install didn't finish, so run it again in the site's folder."] : []),
    ...(address ? [] : ["Set the site's address in wrangler.jsonc (GOODFELLOW_SITE_URL) before it's put online."]),
    "",
    left === undefined
      ? 'Then put it online as README.md\'s "Putting it online on Cloudflare" says.'
      : left.length === 0
        ? "It's online on Cloudflare."
        : 'Still to do, as README.md\'s "Putting it online on Cloudflare" says:',
    ...(left ?? []).map((step) => `  - ${step}`),
    "",
    "To deploy after each change, add the secrets .github/workflows/deploy.yml lists to the code's repository; email and payments are set up as README.md says.",
    "",
    "On this computer:",
    ...(where === "." ? [] : [`  cd ${quoted}`]),
    ...(installed ? [] : ["  npm install"]),
    "  npm run dev",
    "Then open http://localhost:4321/admin.",
  ];
  io.say(`${lines.join("\n")}\n`);
}

/** Whether to ask questions here: in a terminal, without `--yes`, as for any other site. */
export function isInteractive(answerNothing: boolean | undefined): boolean {
  return Boolean(stdin.isTTY) && !answerNothing;
}

/** The options a full-stack site can't take, which create-goodfellow takes for its other sites. */
export const NOT_FOR_SERVER = [
  "template",
  "host",
  "wordpress",
  "blocks",
  "build",
  "plugin",
  "admin",
  "broker",
  "broker-domain",
] as const;

/** What's wrong with the options given together, if anything: `--server`'s with others', or `--url` without it. */
export function serverOptionProblem(values: Record<string, unknown>): string | undefined {
  if (values.server === undefined) {
    return values.url === undefined ? undefined : "--url is only for full-stack sites, with --server.";
  }
  const given = NOT_FOR_SERVER.filter((name) => values[name] !== undefined);
  if (given.length === 0) return undefined;
  return `--server makes a site of its own kind, which can't take ${given.map((name) => `--${name}`).join(", ")}: leave ${given.length === 1 ? "it" : "them"} out.`;
}
