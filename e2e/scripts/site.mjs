import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** The starter template, which every test starts from. */
export const starter = join(here, "../../templates/starter");

/** A copy of the starter that tests edit freely. Inside e2e/ so it resolves this package's dependencies. */
export const site = join(here, "../.site");

/** Folders that installing blocks from the admin panel's Blocks screen writes to. */
const INSTALLED_CODE = ["components", "lib", "hooks"];

/**
 * Resets a site's editable files to those of `from`: content, media and installed blocks. Returns
 * whether it reset blocks' code, which a running dev server takes a moment to notice.
 */
/** Removes what `target` has that `from` doesn't, folder by folder. */
function removeExtras(target, from) {
  for (const name of readdirSync(target)) {
    const path = join(target, name);
    const source = join(from, name);
    if (!existsSync(source) || statSync(source).isDirectory() !== statSync(path).isDirectory()) {
      rmSync(path, { recursive: true, force: true });
    } else if (statSync(path).isDirectory()) {
      removeExtras(path, source);
    }
  }
}

function resetEditable(root, from) {
  // Code is only reset when a test added blocks (or the site is new), so other tests don't make the dev
  // server reload modules.
  const hadBlocks = existsSync(join(root, "blocks/installed/installed.json"));
  const resetCode = hadBlocks || !existsSync(join(root, "blocks/installed/index.ts"));
  for (const dir of ["content", "public", ...(resetCode ? ["blocks/installed", ...INSTALLED_CODE] : [])]) {
    const target = join(root, dir);
    const source = join(from, dir);
    if (!existsSync(source)) {
      // Empties folders rather than removing them: a dev server's watcher can miss later changes in a
      // folder that was removed and made again.
      if (existsSync(target)) {
        for (const name of readdirSync(target)) rmSync(join(target, name), { recursive: true, force: true });
      }
      continue;
    }
    // Copies the files back before removing the rest, so a file the site always has, such as
    // content/styles/custom.css, which the Next.js starter's CSS imports, is never missing while a dev
    // server compiles. Some sites have files of their own there, such as the Next.js starter's lib/site.ts.
    if (existsSync(target)) removeExtras(target, source);
    cpSync(source, target, { recursive: true, force: true });
  }
  return hadBlocks;
}

/** Resets the test site's editable files to the starter's. Returns whether it reset blocks' code. */
export function resetContent() {
  return resetEditable(site, starter);
}

/** Blocks with Client Components, which every test site has besides the starter's. */
const testBlocks = join(here, "../fixtures/blocks");
/** Plugins, which the `goodfellow dev` test site has (`plugins.spec.ts`, `media-storage.spec.ts`, `editor-plugins.spec.ts`). */
const testPlugins = join(here, "../fixtures/plugins");

/** A test site's config: the starter's blocks, the test blocks, and optionally a backend. */
function testConfig({
  from = "./blocks",
  importLine = "",
  backend = "",
  demo = false,
  admin = "",
  broker = "",
  plugins = false,
} = {}) {
  return [
    'import { blocks, categories } from "@goodfellow-cms/blocks";',
    'import { defineConfig } from "@goodfellow-cms/core";',
    ...(importLine ? [importLine] : []),
    ...(plugins
      ? [
          'import { greeter } from "./plugins/greeter";',
          'import { keeper } from "./plugins/keeper";',
          'import { outline } from "./plugins/outline";',
        ]
      : []),
    `import { Counter, Disclosure } from ${JSON.stringify(`${from}/counter`)};`,
    `import { installedBlocks, installedCategories } from ${JSON.stringify(`${from}/installed`)};`,
    "",
    "export default defineConfig({",
    ...(admin ? [`  admin: { url: ${JSON.stringify(admin)}, checked: true },`] : []),
    ...(broker ? [`  broker: { url: ${JSON.stringify(broker)} },`] : []),
    "  blocks: { ...blocks, ...installedBlocks, Counter, Disclosure },",
    "  categories: { ...categories, ...installedCategories },",
    ...(backend ? [`  backend: ${backend},`] : []),
    ...(demo ? ["  demo: true,"] : []),
    ...(plugins ? ["  plugins: [greeter, keeper, outline],"] : []),
    "});",
    "",
  ].join("\n");
}

/** A page with the test blocks, for tests to add to a site's content. */
export const islandsPage = {
  version: 1,
  data: {
    content: [
      { type: "Counter", props: { id: "Counter-1", className: "", label: "Clicked" } },
      { type: "Disclosure", props: { id: "Disclosure-1", className: "", title: "More", open: false } },
      { type: "Disclosure", props: { id: "Disclosure-2", className: "", title: "Shown", open: true } },
    ],
    root: { props: { className: "", description: "", image: "", title: "Islands" } },
  },
};

/** Creates the test site from the starter. */
export function createSite() {
  rmSync(site, { recursive: true, force: true });
  mkdirSync(site, { recursive: true });
  cpSync(join(starter, "src"), join(site, "src"), { recursive: true });
  cpSync(testBlocks, join(site, "blocks"), { recursive: true });
  cpSync(testPlugins, join(site, "plugins"), { recursive: true });
  writeFileSync(join(site, "goodfellow.config.tsx"), testConfig({ plugins: true }));
  resetContent();
}

/** Backends for the built test sites. Each site is a production build of the starter, served like a static host. */
export const builtSites = {
  github: {
    port: 4401,
    importLine: 'import { github } from "@goodfellow-cms/github";',
    // The sign-in worker is used only off this computer, where sign-in-worker.spec.ts serves the site.
    backend: 'github({ repo: "parish/site", signIn: "https://sign-in.parish.example" })',
  },
  gitlab: {
    port: 4402,
    importLine: 'import { gitlab } from "@goodfellow-cms/gitlab";',
    backend: 'gitlab({ project: "parish/site", clientId: "test-client" })',
  },
  bitbucket: {
    port: 4414,
    importLine: 'import { bitbucket } from "@goodfellow-cms/bitbucket";',
    backend: 'bitbucket({ repo: "parish/site", clientId: "test-consumer" })',
  },
  // A demo, which anyone can try without signing in.
  demo: { port: 4405, demo: true },
  // Its content in a repository of its own, in content-repository/, which content/ and public/media/ link to.
  content: {
    port: 4410,
    importLine: 'import { github } from "@goodfellow-cms/github";',
    backend: 'github({ repo: "parish/site-content", contentOnly: true, code: "parish/site" })',
    separate: true,
  },
  // An admin address of its own, with test pages that try every way of running a script there before the guard.
  // Editors sign in at a token broker, which shows the admin panel in its frame.
  broker: {
    port: 4412,
    importLine: 'import { github } from "@goodfellow-cms/github";',
    backend: 'github({ repo: "parish/site" })',
    broker: true,
  },
  admin: {
    port: 4411,
    importLine: 'import { github } from "@goodfellow-cms/github";',
    backend: 'github({ repo: "parish/site" })',
    admin: true,
  },
};

/**
 * The admin address test site's two addresses: the admin panel's, and the Site address. Both are this computer,
 * served by one server, but browsers keep them apart, as they would two domains.
 */
export const ADMIN_ADDRESSES = { admin: "http://localhost:4411", site: "http://127.0.0.1:4411" };

/**
 * The token broker test site's addresses: the site, built with a config naming the broker, and the broker, served
 * from the built @goodfellow-cms/broker with a broker.json naming the site's repository on the fake GitHub.
 */
export const BROKER_ADDRESSES = { site: "http://localhost:4412", broker: "http://127.0.0.1:4413" };

/** Creates a copy of the starter configured with a git backend or as a demo, ready for `goodfellow build`. */
export function createBuiltSite(name) {
  const { importLine, backend, demo, separate, admin, broker } = builtSites[name];
  const dir = join(here, `../.site-${name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // A site whose content is kept apart has its content and media in content-repository/ instead.
  const content = separate ? join(dir, "content-repository") : dir;
  for (const entry of ["src", "blocks", "public"]) cpSync(join(starter, entry), join(dir, entry), { recursive: true });
  cpSync(join(starter, "content"), join(content, "content"), { recursive: true });
  if (separate) {
    rmSync(join(dir, "public/media"), { recursive: true });
    cpSync(join(starter, "public/media"), join(content, "public/media"), { recursive: true });
  }
  cpSync(testBlocks, join(dir, "blocks"), { recursive: true });
  writeFileSync(join(content, "content/pages/islands.json"), `${JSON.stringify(islandsPage, null, 2)}\n`);
  // The admin panel in a language of the site's own, which its build publishes for the sign-in screen.
  if (name === "github")
    cpSync(join(here, "../fixtures/admin-text"), join(content, "content/admin-text"), { recursive: true });
  if (admin) {
    const settingsFile = join(content, "content/site.json");
    const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
    writeFileSync(settingsFile, `${JSON.stringify({ ...settings, url: `${ADMIN_ADDRESSES.site}/` }, null, 2)}\n`);
    cpSync(join(here, "../fixtures/admin-domain"), join(dir, "public/attack"), { recursive: true });
  }
  writeFileSync(
    join(dir, "goodfellow.config.tsx"),
    testConfig({
      importLine,
      backend,
      demo,
      admin: admin ? ADMIN_ADDRESSES.admin : "",
      broker: broker ? BROKER_ADDRESSES.broker : "",
    }),
  );
  return dir;
}

/** The starter's editable files, as the contents of the fake repository the built sites edit. */
export function starterFiles() {
  const files = {};
  for (const dir of ["content", "public/media"]) {
    for (const file of readdirSync(join(starter, dir), { recursive: true })) {
      const path = join(starter, dir, file);
      if (statSync(path).isFile()) files[`${dir}/${file.split("\\").join("/")}`] = readFileSync(path, "utf8");
    }
  }
  return files;
}

/** The Next.js template, and a copy of it that tests run `next dev` on. */
export const nextTemplate = join(here, "../../templates/next");
export const nextSite = join(here, "../.site-next");

/** Resets the Next.js test site's editable files to the template's. Returns whether it reset blocks' code. */
export function resetNextContent() {
  return resetEditable(nextSite, nextTemplate);
}

/** Copies the Next.js template to `dir`, using the template's installed packages. */
function copyNextTemplate(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(nextTemplate)) {
    if (["node_modules", ".next", "out", ".turbo"].includes(entry)) continue;
    cpSync(join(nextTemplate, entry), join(dir, entry), { recursive: true });
  }
  // A junction on Windows, which needs no administrator rights; a symlink elsewhere.
  symlinkSync(join(nextTemplate, "node_modules"), join(dir, "node_modules"), "junction");
  // This repository ignores the whole copy, so Tailwind doesn't follow the copy's own `.gitignore`
  // and scans everything in it, `.next/`'s binary cache included, whose bytes it can take for class
  // names that break the site's CSS. A real site's `.gitignore` keeps Tailwind out of `.next/`.
  const css = join(dir, "app/site.css");
  writeFileSync(css, `${readFileSync(css, "utf8")}@source not "../.next";\n`);
}

/** Creates the Next.js test site, with an extra block whose component runs in the browser. */
export function createNextSite() {
  copyNextTemplate(nextSite);
  cpSync(testBlocks, join(nextSite, "blocks"), { recursive: true });
  writeFileSync(join(nextSite, "goodfellow.config.tsx"), testConfig({ from: "@/blocks" }));
  resetNextContent();
}

/** A copy of the Next.js template that's built to be served from a subfolder. */
export const nextBuiltSite = join(here, "../.site-next-base");
export const NEXT_BASE = "/site/";

export function createNextBuiltSite() {
  copyNextTemplate(nextBuiltSite);
}

/** A copy of the Next.js template as a full-stack site, with a server of its own and a sign-in of its own. */
export const nextServerSite = join(here, "../.site-next-server");

/** The full-stack test site's address, its fake GitHub's, its fake AI service's, and the token its server uses. */
export const NEXT_SERVER = { port: 4407, github: 4408, ai: 4409, token: "site-token", aiKey: "sk-site-key" };

/** People the test site's own sign-in knows, by the name its sign-in page signs them in as. */
export const NEXT_SERVER_PEOPLE = {
  alice: { login: "alice", name: "Alice Editor", email: "alice@example.org", role: "editor" },
  owen: { login: "owen", name: "Owen Owner", email: "owen@example.org", role: "owner" },
  // Signed in to the site, but not allowed to edit it.
  nora: false,
};

/** Files a full-stack Next.js site adds to the template: the admin panel's API, and a sign-in of its own. */
const SERVER_FILES = {
  "next.config.ts": `import { withGoodfellow } from "@goodfellow-cms/next/config";

export default withGoodfellow({ agentRules: false }, { server: true });
`,
  "lib/session.ts": `import type { AppEditor } from "@goodfellow-cms/core";

// A made-up sign-in for tests: a cookie naming who's signed in. A real site checks its own sessions here.
export const PEOPLE: Record<string, AppEditor | false> = ${JSON.stringify(NEXT_SERVER_PEOPLE, null, 2)};

export function signedIn(request: Request): AppEditor | false | null {
  const match = /(?:^|; )test-session=([a-z]+)/.exec(request.headers.get("cookie") ?? "");
  return match?.[1] && match[1] in PEOPLE ? (PEOPLE[match[1]] ?? null) : null;
}
`,
  "app/api/goodfellow/[...path]/route.ts": `import { goodfellowApi } from "@goodfellow-cms/next/server";
import config from "@/goodfellow.config";
import { signedIn } from "@/lib/session";

export const { GET, POST } = goodfellowApi({
  config,
  authorize: signedIn,
  signIn: "/sign-in/",
  signOut: "/sign-out/",
  // OpenAI's API, at a fake's address.
  ai: { openai: { key: process.env.TEST_AI_KEY, baseUrl: \`\${process.env.TEST_AI_URL}/v1\` } },
});
`,
  "app/sign-in/route.ts": `import { PEOPLE } from "@/lib/session";

export function GET(request: Request) {
  const as = new URL(request.url).searchParams.get("as");
  if (as && as in PEOPLE) {
    return new Response(null, {
      status: 303,
      headers: { location: "/admin/", "set-cookie": \`test-session=\${as}; Path=/; HttpOnly; SameSite=Lax\` },
    });
  }
  const links = Object.keys(PEOPLE).map((name) => \`<li><a href="/sign-in/?as=\${name}">Sign in as \${name}</a></li>\`);
  return new Response(\`<!doctype html><title>Sign in</title><h1>Sign in</h1><ul>\${links.join("")}</ul>\`, {
    headers: { "content-type": "text/html" },
  });
}
`,
  "app/sign-out/route.ts": `export function GET() {
  return new Response(null, {
    status: 303,
    headers: { location: "/sign-in/", "set-cookie": "test-session=; Path=/; Max-Age=0" },
  });
}
`,
  "app/admin/page.tsx": `import { GoodfellowAdmin } from "@goodfellow-cms/next/admin";
import { site } from "@/lib/site";

export default function AdminPage() {
  return <GoodfellowAdmin site={site.admin()} server="/api/goodfellow" />;
}
`,
};

/** Creates the full-stack test site, stored on a fake GitHub that only its server reaches. */
export function createNextServerSite() {
  copyNextTemplate(nextServerSite);
  for (const [path, text] of Object.entries(SERVER_FILES)) {
    mkdirSync(dirname(join(nextServerSite, path)), { recursive: true });
    writeFileSync(join(nextServerSite, path), text);
  }
  writeFileSync(
    join(nextServerSite, "goodfellow.config.tsx"),
    testConfig({
      from: "@/blocks",
      importLine: 'import { github } from "@goodfellow-cms/github";',
      // The server's GitHub is a fake on this computer; the browser never calls it.
      backend: 'github({ repo: "parish/site", apiUrl: process.env.TEST_GITHUB_API })',
    }),
  );
  cpSync(testBlocks, join(nextServerSite, "blocks"), { recursive: true });
  writeFileSync(join(nextServerSite, "content/pages/search.json"), `${JSON.stringify(searchPage, null, 2)}\n`);
  // A collection of events, so the build has calendar files to write.
  const events = join(nextServerSite, "content/collections/events");
  mkdirSync(events, { recursive: true });
  writeFileSync(join(events, "_collection.json"), `${JSON.stringify(eventsCollection, null, 2)}\n`);
  writeFileSync(join(events, "open-house.json"), `${JSON.stringify(openHouse, null, 2)}\n`);
}

const eventsCollection = {
  version: 1,
  calendar: { when: "when" },
  entryName: "Event",
  fields: [
    { type: "text", label: "Title", name: "title", required: true },
    { type: "event", label: "Date and time", name: "when", required: true },
  ],
  name: "Events",
};

const openHouse = {
  version: 1,
  fields: { title: "Open house", when: { end: "2026-11-07T12:00", start: "2026-11-07T10:00" } },
};

/** A page with a Search block, so the full-stack test site's build has an index to search. */
const searchPage = {
  version: 1,
  data: {
    content: [
      {
        type: "Search",
        props: {
          id: "Search-1",
          className: "",
          label: "Search the site",
          noResults: "Nothing matches \u201c{query}\u201d.",
          placeholder: "Search",
          unavailable: "Search works on the published site.",
        },
      },
    ],
    root: { props: { className: "", description: "", image: "", title: "Search" } },
  },
};
