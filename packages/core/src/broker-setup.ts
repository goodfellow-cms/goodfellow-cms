/**
 * A token broker's own repository: the released `@goodfellow-cms/broker`
 * page, its `broker.json` naming the site, and what puts it online on an
 * address of its own. `planBroker()` works out the files with no disk or
 * network access, so the admin panel's Security tab, `goodfellow broker add`,
 * `create-goodfellow` and the setup page make the same repositories.
 */
import { type BrokerAddress, brokerOrigin } from "./broker.js";
import type { FileChange } from "./content/store.js";
import type { HostSource } from "./git.js";

/** Where a broker is put online. GitHub Pages and GitLab Pages publish it from its repository. */
export type BrokerHost = "github-pages" | "gitlab-pages" | "cloudflare-pages" | "vercel";

/** The folder of a broker's repository that's served: the released page, with `broker.json`. */
export const BROKER_SITE_DIR = "site";

/** The list of a release's files, which the broker's build writes beside them. */
export const BROKER_FILES_LIST = "files.json";

/** Where a release of the broker's page is, file by file: jsDelivr, which serves npm packages to browsers. */
export function brokerReleaseUrl(version: string): string {
  return `https://cdn.jsdelivr.net/npm/@goodfellow-cms/broker@${version}/${BROKER_SITE_DIR}/`;
}

/** What reading a release needs of `fetch`. */
export type BrokerFetch = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** A release's files, by their path in its `site/` folder. */
export type BrokerRelease = Map<string, Uint8Array>;

/**
 * Reads a release of the broker's page: its `files.json`, then each file it
 * lists. `base` is `brokerReleaseUrl()`, or the built page elsewhere.
 */
export async function fetchBrokerRelease(base: string, fetcher: BrokerFetch): Promise<BrokerRelease> {
  const root = base.endsWith("/") ? base : `${base}/`;
  const listed = await fetcher(`${root}${BROKER_FILES_LIST}`);
  if (!listed.ok) throw new Error(`The token broker's files couldn't be read from ${root} (${listed.status}).`);
  const { files } = (await listed.json()) as { files?: unknown };
  if (!Array.isArray(files) || !files.every((file) => typeof file === "string" && isReleasePath(file))) {
    throw new Error(`${root}${BROKER_FILES_LIST} doesn't list the token broker's files.`);
  }
  const release: BrokerRelease = new Map();
  await Promise.all(
    files.map(async (path: string) => {
      const response = await fetcher(`${root}${path}`);
      if (!response.ok) throw new Error(`${root}${path} couldn't be read (${response.status}).`);
      release.set(path, new Uint8Array(await response.arrayBuffer()));
    }),
  );
  return release;
}

/** A path inside the release's folder, never outside it. */
function isReleasePath(path: string): boolean {
  return /^[\w.-]+(\/[\w.-]+)*$/.test(path) && !path.split("/").some((part) => part === ".." || part === ".");
}

export interface BrokerPlan {
  /** The released page, from `fetchBrokerRelease()`. */
  release: BrokerRelease;
  /** The site the broker signs in to, as its config's backend makes it (`GitHost.source`). */
  site: HostSource;
  host: BrokerHost;
  /** The broker's own domain, such as `signin.example.org`, which GitHub Pages needs. */
  domain?: string;
  /** The site's name, for the README. */
  name?: string;
}

/** The files a broker's repository holds, all in its first commit. */
export function planBroker({ release, site, host, domain, name }: BrokerPlan): FileChange[] {
  const files: FileChange[] = [];
  for (const [path, bytes] of release) {
    if (path === BROKER_FILES_LIST || path === "broker.example.json") continue;
    files.push({ path: `${BROKER_SITE_DIR}/${path}`, bytes });
  }
  files.push({ path: `${BROKER_SITE_DIR}/broker.json`, content: `${JSON.stringify({ sites: [site] }, null, 2)}\n` });
  if (host === "github-pages") {
    files.push({ path: ".github/workflows/deploy.yml", content: githubPagesWorkflow() });
    if (domain) files.push({ path: `${BROKER_SITE_DIR}/CNAME`, content: `${domain}\n` });
  }
  if (host === "gitlab-pages") files.push({ path: ".gitlab-ci.yml", content: GITLAB_PIPELINE });
  files.push({ path: "README.md", content: brokerReadme({ host, domain, name }) });
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * A new site's backend as its config makes it (`GitHost.source`), for its
 * broker's `broker.json`: `planSite()` writes `github({ repo })`,
 * `gitlab({ project })` or `bitbucket({ repo })`.
 */
export function newSiteSource(
  backend: { host: "github" | "gitlab" | "bitbucket"; repo: string },
  /** For a site whose content is kept in a repository of its own: `backend` is then the content's. */
  separate?: { code: string },
): HostSource {
  const only = separate ? { contentOnly: true, code: separate.code } : {};
  if (backend.host === "gitlab") {
    return { package: "@goodfellow-cms/gitlab", export: "gitlab", options: { project: backend.repo, ...only } };
  }
  return {
    package: `@goodfellow-cms/${backend.host}`,
    export: backend.host,
    options: { repo: backend.repo, ...only },
  };
}

/**
 * Where a broker for a site kept on this git host can go, the usual place
 * first. Bitbucket's sites, brokers included, are put online by Vercel.
 */
export function brokerHostsFor(git: "github" | "gitlab" | "bitbucket"): BrokerHost[] {
  if (git === "bitbucket") return ["vercel"];
  return git === "github"
    ? ["github-pages", "cloudflare-pages", "vercel"]
    : ["gitlab-pages", "cloudflare-pages", "vercel"];
}

/** The broker's address, where it's known before it's online: its own domain. */
export function plannedBrokerAddress(domain: string | undefined): BrokerAddress | undefined {
  if (!domain) return undefined;
  const origin = brokerOrigin({ url: `https://${domain}` });
  return origin ? { url: origin } : undefined;
}

function githubPagesWorkflow(): string {
  return `# Publishes the token broker's page, in site/, with GitHub Pages whenever it
# changes. It runs no code of its own: the page is Goodfellow's released files.
# In the repository's Settings → Pages, set "Source" to "GitHub Actions".
# The broker needs an address of its own: give it a domain there, never a
# github.io address, which every Pages site in the same account shares.
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions: {}

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false
      - uses: actions/upload-pages-artifact@v4
        with:
          path: ${BROKER_SITE_DIR}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
`;
}

const GITLAB_PIPELINE = `# Publishes the token broker's page, in site/, with GitLab Pages whenever it
# changes. It runs no code of its own: the page is Goodfellow's released files.
# The broker needs an address of its own: keep "Use unique domain" on under
# Deploy → Pages, as it is for new projects, or give it a domain there; never
# a gitlab.io address every project in the group shares.
pages:
  image: alpine:3.22
  script:
    - echo "The token broker's page is in ${BROKER_SITE_DIR}/."
  pages:
    publish: ${BROKER_SITE_DIR}
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
`;

const HOST_STEPS: Record<BrokerHost, string> = {
  "github-pages":
    "GitHub Pages publishes it with `.github/workflows/deploy.yml`. Give it a domain of its own in the repository's Settings → Pages, never a `github.io` address, which every Pages site in the same account shares.",
  "gitlab-pages":
    "GitLab Pages publishes it with `.gitlab-ci.yml`, at the project's unique domain (Deploy → Pages, on for new projects), or a domain of its own. Never turn the unique domain off without a domain, since `gitlab.io` addresses are shared by every project in the group.",
  "cloudflare-pages": `Cloudflare Pages publishes it: create a Pages project from this repository with no framework preset, no build command and \`${BROKER_SITE_DIR}\` as the output directory. Its \`_headers\` file stops other pages from framing it.`,
  vercel: `Vercel publishes it: import this repository as a project with \`${BROKER_SITE_DIR}\` as its root directory and no build command. Its \`vercel.json\` stops other pages from framing it.`,
};

function brokerReadme({ host, domain, name }: Pick<BrokerPlan, "host" | "domain" | "name">): string {
  return `# ${name ? `${name}: sign-in page` : "Token broker"}

This is the token broker for ${name ?? "a Goodfellow site"}: a page on an address of its own where editors sign in. It keeps their sign-in and AI keys where the site's pages can't reach them, and shows the site's admin panel in a frame.

The page in \`${BROKER_SITE_DIR}/\` is Goodfellow's released \`@goodfellow-cms/broker\`, with \`${BROKER_SITE_DIR}/broker.json\` naming the site. Nothing here runs code of its own.

## Putting it online

${HOST_STEPS[host]}${domain ? `\n\nIts address is \`https://${domain}\`: point the domain at the host as its settings say.` : ""}

Once it's online, open the site's admin panel, go to **Site Settings → Security**, type the broker's address and choose **Sign in there from now on**. Editors sign in here once the site has rebuilt.

## Updating it

Copy the \`${BROKER_SITE_DIR}/\` folder of the \`@goodfellow-cms/broker\` release that matches the site's Goodfellow version over this one, keeping \`broker.json\`. See the token broker page in Goodfellow's documentation.
`;
}
