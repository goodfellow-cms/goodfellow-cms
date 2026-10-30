/**
 * A fake of npm's registry and jsDelivr for themes and plugins, so tests never
 * call the real services, and a made-up theme and plugin to install. Never
 * shipped: import it from `@goodfellow-cms/core/testing` in tests only.
 */
import { serializeContent } from "./content/serialize.js";
import { PLUGIN_MANIFEST } from "./plugin-packages.js";
import { PLUGIN_KEYWORD } from "./plugins.js";
import { THEME_KEYWORD, THEME_MANIFEST } from "./themes.js";

export interface FakeThemeRelease {
  version: string;
  /** How many days before `now` it was published: 30 if left out. */
  age?: number;
  /** Its `peerDependencies` range on `@goodfellow-cms/core`: any release if left out; `null` for none. */
  goodfellow?: string | null;
  /** Whether it has provenance, with an attestation npm's attestations endpoint answers. */
  provenance?: boolean;
  repository?: string;
  /** The workflow its provenance says built it: `.github/workflows/release.yml` if left out. */
  workflow?: string;
  /** The repository its provenance says built it, where that isn't `repository`. */
  builtBy?: string;
  /** Its attestation's signature doesn't match what it says, as `fakeVerifier()` finds. */
  badSignature?: boolean;
  deprecated?: string;
  /** The packages it needs, with their ranges. */
  dependencies?: Record<string, string>;
  /** Its `package.json`'s scripts, such as `postinstall`. */
  scripts?: Record<string, string>;
  /** Its package's files by path, such as `goodfellow-theme.json` and `theme.css`. */
  files: Record<string, string>;
}

export interface FakeTheme {
  name: string;
  description?: string;
  publisher?: string;
  /** Its keywords: `goodfellow-theme` if left out. */
  keywords?: string[];
  releases: FakeThemeRelease[];
}

export interface FakeThemesResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface FakeThemesOptions {
  themes: FakeTheme[];
  /** What "now" is for the releases' ages. */
  now?: Date;
}

/** A plugin, or a package plugins need, on the fake npm: its keywords are `goodfellow-plugin` if left out. */
export type FakePlugin = FakeTheme;

export interface FakePluginsOptions {
  plugins: FakePlugin[];
  /** Other packages, such as the ones plugins need, with no keywords unless given. */
  packages?: FakePlugin[];
  now?: Date;
}

/**
 * Fake answers for npm's registry (`registry.npmjs.org`) and jsDelivr
 * (`cdn.jsdelivr.net`, and `data.jsdelivr.com`'s lists of files) for themes:
 * `handle()` for end-to-end tests' routes, `fetch` for unit tests.
 */
export function fakeThemes(options: FakeThemesOptions) {
  return fakeNpm({
    packages: options.themes.map((theme) => ({ ...theme, keywords: theme.keywords ?? [THEME_KEYWORD] })),
    ...(options.now && { now: options.now }),
  });
}

/** The same fake for plugins and the packages they need. */
export function fakePlugins(options: FakePluginsOptions) {
  return fakeNpm({
    packages: [
      ...options.plugins.map((plugin) => ({ ...plugin, keywords: plugin.keywords ?? [PLUGIN_KEYWORD] })),
      ...(options.packages ?? []).map((other) => ({ ...other, keywords: other.keywords ?? [] })),
    ],
    ...(options.now && { now: options.now }),
  });
}

function fakeNpm(options: { packages: (FakeTheme & { keywords: string[] })[]; now?: Date }) {
  const requests: string[] = [];
  const now = (options.now ?? new Date()).getTime();
  const cors = { "access-control-allow-origin": "*" };
  const json = (data: unknown, status = 200): FakeThemesResponse => ({
    status,
    headers: { ...cors, "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  const published = (release: FakeThemeRelease) => new Date(now - (release.age ?? 30) * 86_400_000).toISOString();

  function search(url: URL): FakeThemesResponse {
    const words = (url.searchParams.get("text") ?? "").split(/\s+/).filter(Boolean);
    const objects = options.packages
      .filter((theme) => {
        const keywords = theme.keywords;
        return words.every((word) => {
          if (word.startsWith("keywords:")) return keywords.includes(word.slice("keywords:".length));
          return `${theme.name} ${theme.description ?? ""}`.toLowerCase().includes(word.toLowerCase());
        });
      })
      .map((theme) => {
        const latest = theme.releases[theme.releases.length - 1];
        return {
          package: {
            name: theme.name,
            version: latest?.version,
            description: theme.description ?? "",
            keywords: theme.keywords,
            date: latest && published(latest),
            publisher: { username: theme.publisher ?? "someone" },
          },
        };
      });
    return json({ objects, total: objects.length });
  }

  function metadata(theme: FakeTheme): FakeThemesResponse {
    const versions: Record<string, unknown> = {};
    const time: Record<string, string> = {};
    for (const release of theme.releases) {
      const goodfellow = release.goodfellow === undefined ? ">=0.0.0" : release.goodfellow;
      versions[release.version] = {
        name: theme.name,
        version: release.version,
        description: theme.description ?? "",
        keywords: theme.keywords,
        ...(goodfellow !== null && { peerDependencies: { "@goodfellow-cms/core": goodfellow } }),
        ...(release.dependencies && { dependencies: release.dependencies }),
        ...(release.scripts && { scripts: release.scripts }),
        ...(release.repository && { repository: { type: "git", url: `git+${release.repository}.git` } }),
        ...(release.deprecated && { deprecated: release.deprecated }),
        dist: {
          tarball: `https://registry.npmjs.org/${theme.name}/-/${release.version}.tgz`,
          integrity: `sha512-${btoa(digestText(theme.name, release.version))}`,
          ...(release.provenance && {
            attestations: {
              url: `https://registry.npmjs.org/-/npm/v1/attestations/${theme.name}@${release.version}`,
              provenance: { predicateType: "https://slsa.dev/provenance/v1" },
            },
          }),
        },
      };
      time[release.version] = published(release);
    }
    return json({ name: theme.name, versions, time });
  }

  function attestations(name: string, version: string): FakeThemesResponse {
    const theme = options.packages.find((candidate) => candidate.name === name);
    const release = theme?.releases.find((candidate) => candidate.version === version);
    if (!theme || !release?.provenance) return json({ error: "Not found" }, 404);
    const repository = release.builtBy ?? release.repository ?? `https://github.com/example/${name}`;
    const workflow = release.workflow ?? ".github/workflows/release.yml";
    const statement = {
      _type: "https://in-toto.io/Statement/v1",
      subject: [
        { name: `pkg:npm/${name.replace(/^@/, "%40")}@${version}`, digest: { sha512: hex(digestText(name, version)) } },
      ],
      predicateType: "https://slsa.dev/provenance/v1",
      predicate: {
        buildDefinition: {
          buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
          externalParameters: { workflow: { ref: "refs/heads/main", repository, path: workflow } },
        },
      },
    };
    const payload = btoa(JSON.stringify(statement));
    return json({
      attestations: [
        {
          predicateType: "https://slsa.dev/provenance/v1",
          bundle: {
            mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
            // Made up: fakeVerifier() reads who signed it here, and checks the signature is the payload.
            verificationMaterial: { fakeIdentity: `${repository}/${workflow}@refs/heads/main` },
            dsseEnvelope: {
              payload,
              payloadType: "application/vnd.in-toto+json",
              signatures: [{ sig: release.badSignature ? btoa("forged") : payload }],
            },
          },
        },
      ],
    });
  }

  function handle(address: string): FakeThemesResponse {
    requests.push(address);
    const url = new URL(address);
    if (url.hostname === "registry.npmjs.org") {
      if (url.pathname === "/-/v1/search") return search(url);
      const attested = /^\/-\/npm\/v1\/attestations\/((?:@[^/]+\/)?[^/@]+)@([^/]+)$/.exec(
        decodeURIComponent(url.pathname),
      );
      if (attested) return attestations(attested[1] ?? "", attested[2] ?? "");
      const name = decodeURIComponent(url.pathname.slice(1));
      const theme = options.packages.find((candidate) => candidate.name === name);
      return theme ? metadata(theme) : json({ error: "Not found" }, 404);
    }
    if (url.hostname === "data.jsdelivr.com") {
      const match = /^\/v1\/packages\/npm\/((?:@[^/]+\/)?[^/@]+)@([^/]+)$/.exec(decodeURIComponent(url.pathname));
      const found = options.packages.find((candidate) => candidate.name === match?.[1]);
      const release = found?.releases.find((candidate) => candidate.version === match?.[2]);
      if (!release) return json({ status: 404, message: "Couldn't find the requested release." }, 404);
      const files = Object.entries(release.files).map(([name, text]) => ({
        type: "file",
        name: `/${name}`,
        hash: "",
        size: new TextEncoder().encode(text).length,
      }));
      return json({ type: "npm", name: found?.name, version: release.version, files });
    }
    if (url.hostname === "cdn.jsdelivr.net") {
      const match = /^\/npm\/((?:@[^/]+\/)?[^/@]+)@([^/]+)\/(.+)$/.exec(decodeURIComponent(url.pathname));
      const theme = options.packages.find((candidate) => candidate.name === match?.[1]);
      const release = theme?.releases.find((candidate) => candidate.version === match?.[2]);
      const file = match?.[3] && release?.files[match[3]];
      if (file !== undefined && file !== "") {
        const path = match?.[3] ?? "";
        const type = path.endsWith(".css")
          ? "text/css"
          : /\.[cm]?[jt]sx?$/.test(path)
            ? "application/javascript"
            : "application/json";
        return { status: 200, headers: { ...cors, "content-type": `${type}; charset=utf-8` }, body: file };
      }
      return { status: 404, headers: cors, body: "Couldn't find the requested file." };
    }
    return { status: 404, headers: {}, body: "Not found" };
  }

  return {
    requests,
    handle,
    fetch: async (url: string) => {
      const answer = handle(url);
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        json: async () => JSON.parse(answer.body) as unknown,
        text: async () => answer.body,
      };
    },
  };
}

/** The made-up file contents a fake release's digest is of. */
function digestText(name: string, version: string): string {
  return `${name}@${version}`;
}

function hex(text: string): string {
  return [...text].map((char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}

/**
 * Checks the fake registry's attestations as Sigstore checks real ones: the
 * signature must be the statement's, and the certificate the workflow's.
 * Pass it as `verify` to `verifiedSource()` and what uses it.
 */
export async function fakeVerifier(bundle: unknown, identity: { issuer: string; uri: string }): Promise<void> {
  const fake = bundle as {
    verificationMaterial?: { fakeIdentity?: string };
    dsseEnvelope?: { payload?: string; signatures?: { sig?: string }[] };
  };
  if (fake.dsseEnvelope?.signatures?.[0]?.sig !== fake.dsseEnvelope?.payload) throw new Error("signature mismatch");
  if (fake.verificationMaterial?.fakeIdentity !== identity.uri) {
    throw new Error(`certificate identity error - expected ${identity.uri}`);
  }
}

/** A made-up theme's files: navy and cream colors, two fonts, classes for a few parts, CSS, and a header. */
export function sampleThemeFiles(
  overrides: { title?: string; primary?: string; css?: string; header?: boolean } = {},
): Record<string, string> {
  const files: Record<string, string> = {
    [THEME_MANIFEST]: serializeContent({
      version: 1,
      title: overrides.title ?? "Harbor",
      description: "Navy and cream, with rounded cards.",
      theme: {
        colors: {
          background: "#fbfaf7",
          foreground: "#1f2933",
          primary: overrides.primary ?? "#1e3a5f",
          primaryForeground: "#ffffff",
          muted: "#eef1f4",
          mutedForeground: "#52606d",
          border: "#d9dee4",
        },
        fonts: { heading: "Merriweather", headingCategory: "serif", body: "Source Sans 3", bodyCategory: "sans-serif" },
        radius: "0.75rem",
        parts: { "gf-heading": "tracking-tight", "gf-button": "rounded-full" },
      },
      css: "theme.css",
      ...(overrides.header && { header: "header.json" }),
    }),
    "theme.css": overrides.css ?? ".gf-card { box-shadow: 0 1px 2px rgb(0 0 0 / 0.08); }\n",
  };
  if (overrides.header) {
    files["header.json"] = serializeContent({
      version: 1,
      data: {
        root: { props: {} },
        content: [
          {
            type: "Section",
            props: {
              id: "Section-harbor-header",
              background: "muted",
              backgroundImage: "",
              className: "",
              padding: "sm",
              width: "wide",
              content: [
                { type: "SiteBrand", props: { id: "SiteBrand-harbor", className: "", show: "both" } },
                {
                  type: "Menu",
                  props: { id: "Menu-harbor", className: "", menu: "main", orientation: "horizontal" },
                },
              ],
            },
          },
        ],
      },
    });
  }
  return files;
}

/**
 * A made-up plugin's files: its `goodfellow-plugin.json`, asking to reach one
 * service and to publish one content file, and code that requests it.
 */
export function samplePluginFiles(
  overrides: { title?: string; connect?: string[]; code?: string; manifest?: Record<string, unknown> } = {},
): Record<string, string> {
  return {
    [PLUGIN_MANIFEST]: serializeContent({
      version: 1,
      title: overrides.title ?? "Guestbook",
      description: "Lets visitors sign a guestbook, kept in a content file.",
      permissions: {
        connect: overrides.connect ?? ["https://guestbook.example.com"],
        files: ["content/guestbook.json"],
      },
      admin: true,
      screens: [{ id: "entries", title: "Guestbook" }],
      ...overrides.manifest,
    }),
    "package.json": JSON.stringify({ name: "goodfellow-plugin-guestbook", type: "module", main: "index.js" }),
    "index.js": "export default { name: 'goodfellow-plugin-guestbook', title: 'Guestbook' };\n",
    "admin.js":
      overrides.code ??
      "export default { screens: { entries(element) { fetch('https://guestbook.example.com/entries'); } } };\n",
    "index.d.ts": "declare const plugin: unknown;\nexport default plugin;\n",
  };
}
