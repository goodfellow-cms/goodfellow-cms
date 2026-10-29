import { readdirSync, readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { BROKER_ADDRESSES, builtSites, NEXT_SERVER } from "./scripts/site.mjs";

const PORT = 4400;

type Server = {
  command: string;
  url: string;
  reuseExistingServer: false;
  timeout: number;
  env?: Record<string, string>;
};

function server(command: string, url: string, timeout: number, env?: Record<string, string>): Server {
  return { command, url, reuseExistingServer: false, timeout, ...(env && { env }) };
}

function builtSite(name: keyof typeof builtSites): Server {
  return server(
    `node scripts/start-built-site.mjs ${name}`,
    `http://localhost:${builtSites[name].port}/admin/`,
    120_000,
  );
}

/**
 * Every test server, each with what a spec says when it uses it: its address's port, or the constant naming it.
 * The `goodfellow dev` site is the tests' `baseURL`, so every run starts it.
 */
const SERVERS: { server: Server; usedBy?: RegExp }[] = [
  // The starter under `goodfellow dev`. The secret is the one the test plugin Keeper's task signs with
  // (`media-storage.spec.ts`), as a site's CI would have.
  {
    server: server(`node scripts/start-site.mjs ${PORT}`, `http://localhost:${PORT}/admin`, 60_000, {
      KEEPER_KEY: "secret",
    }),
  },
  // The Next.js template under `next dev`.
  { server: server("node scripts/start-next-site.mjs 4403", "http://localhost:4403/about/", 120_000), usedBy: /4403/ },
  // A production build of the Next.js template served from /site/, like a GitHub Pages project site.
  {
    server: server("node scripts/start-next-built-site.mjs 4404", "http://localhost:4404/site/", 240_000),
    usedBy: /4404|NEXT_BASE/,
  },
  // The Next.js template as a full-stack site, with a server and a sign-in of its own, on a fake GitHub.
  {
    server: server(
      `node scripts/start-next-server-site.mjs ${NEXT_SERVER.port}`,
      `http://localhost:${NEXT_SERVER.port}/sign-in/`,
      240_000,
    ),
    usedBy: /NEXT_SERVER/,
  },
  // The documentation site, built and served from a subfolder, with its search index.
  {
    server: server("node scripts/start-docs-site.mjs 4406", "http://localhost:4406/goodfellow-cms/", 120_000),
    usedBy: /4406/,
  },
  // The token broker, which shows the broker site's admin panel in its frame.
  {
    server: server("node scripts/start-broker.mjs", `${BROKER_ADDRESSES.broker}/`, 60_000),
    usedBy: /BROKER_ADDRESSES/,
  },
  // Production builds of the starter with each git backend, as a demo, with its content in a repository of its
  // own, with an admin address, and with a token broker, served like a static host.
  // Every registry block, built with `goodfellow build`, whose islands run with Preact.
  {
    server: server("node scripts/start-preact-site.mjs", "http://localhost:4415/registry/", 120_000),
    usedBy: /4415/,
  },
  { server: builtSite("github"), usedBy: /GITHUB_SITE|builtSites\.github|4401/ },
  { server: builtSite("gitlab"), usedBy: /GITLAB_SITE|builtSites\.gitlab|4402/ },
  { server: builtSite("bitbucket"), usedBy: /BITBUCKET_SITE|builtSites\.bitbucket|4414/ },
  { server: builtSite("demo"), usedBy: /builtSites\.demo|4405/ },
  { server: builtSite("content"), usedBy: /builtSites\.content|4410/ },
  { server: builtSite("admin"), usedBy: /ADMIN_ADDRESSES|builtSites\.admin|4411/ },
  { server: builtSite("broker"), usedBy: /BROKER_ADDRESSES|builtSites\.broker|4412/ },
];

/** A file filter as Playwright reads it, a regular expression, or the text itself where it isn't one. */
function fileFilter(text: string): RegExp {
  try {
    return new RegExp(text);
  } catch {
    return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
}

/** Options that take a value, so a value such as `--project chromium`'s isn't taken for a file. */
const VALUE_OPTIONS = new Set(["-c", "--config", "-g", "--grep", "--grep-invert", "--project", "--reporter", "-j"]);

/**
 * The servers a run needs: every one when it names no spec files (the whole suite, or a `--grep` across it),
 * and otherwise the `goodfellow dev` site and the servers the named specs use, since starting them all at once
 * takes more memory than some computers have. `E2E_ALL_SERVERS=1` starts every one regardless.
 */
function serversFor(args: string[]): Server[] {
  const all = SERVERS.map(({ server }) => server);
  if (process.env.E2E_ALL_SERVERS) return all;
  const filters: RegExp[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (VALUE_OPTIONS.has(arg)) i++;
    else if (arg !== "test" && !arg.startsWith("-")) filters.push(fileFilter(arg.replace(/(:\d+)+$/, "")));
  }
  if (!filters.length) return all;
  const specs = readdirSync(new URL("tests/", import.meta.url))
    .filter((name) => name.endsWith(".spec.ts") && filters.some((filter) => filter.test(`tests/${name}`)))
    .map((name) => readFileSync(new URL(`tests/${name}`, import.meta.url), "utf8"));
  // A filter no spec matches is something else, so start everything rather than guess.
  if (!specs.length) return all;
  return SERVERS.filter(({ usedBy }) => !usedBy || specs.some((text) => usedBy.test(text))).map(({ server }) => server);
}

/** The most servers, besides the `goodfellow dev` site, that a group of specs starts at once. */
const GROUP_SERVERS = 4;

/**
 * The spec files in groups that each start at most `GROUP_SERVERS` servers besides the `goodfellow dev` site,
 * for `scripts/test-groups.mjs` to run one after another: starting every server at once took more memory than
 * CI's runners have. Specs that use the most servers are placed first, each in the group whose servers it adds
 * fewest to, so specs that share a server mostly run where it's already started.
 */
export function specGroups(): string[][] {
  const specs = readdirSync(new URL("tests/", import.meta.url))
    .filter((name) => name.endsWith(".spec.ts"))
    .sort()
    .map((name) => {
      const text = readFileSync(new URL(`tests/${name}`, import.meta.url), "utf8");
      const used = SERVERS.flatMap(({ usedBy }, index) => (usedBy?.test(text) ? [index] : []));
      return { name, used };
    })
    .sort((a, b) => b.used.length - a.used.length);
  const groups: { servers: Set<number>; specs: string[] }[] = [];
  for (const spec of specs) {
    const fits = groups
      .map((group) => ({ group, added: spec.used.filter((index) => !group.servers.has(index)).length }))
      .filter(({ group, added }) => group.servers.size + added <= GROUP_SERVERS)
      // Fewest servers added, then the group with fewest servers, so specs needing only the dev site spread out.
      .sort((a, b) => a.added - b.added || a.group.servers.size - b.group.servers.size);
    let group = fits[0]?.group;
    if (!group) {
      group = { servers: new Set(), specs: [] };
      groups.push(group);
    }
    for (const index of spec.used) group.servers.add(index);
    group.specs.push(spec.name);
  }
  return groups.map((group) => group.specs.sort());
}

export default defineConfig({
  testDir: "tests",
  // Every test edits the same site on disk, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    // Lets environments with a preinstalled browser use it instead of `playwright install`.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  projects: [
    { name: "chromium", use: {} },
    // The admin address's guards, in every browser engine, since each loads pages its own way, and the registry's
    // blocks with Preact, which each runs its own way too.
    ...(["firefox", "webkit"] as const).map((name) => ({
      name,
      testMatch: ["admin-domain.spec.ts", "preact.spec.ts"],
      use: {
        ...devices[name === "firefox" ? "Desktop Firefox" : "Desktop Safari"],
        viewport: { width: 1440, height: 900 },
        launchOptions: {},
      },
    })),
  ],
  webServer: serversFor(process.argv.slice(2)),
});
