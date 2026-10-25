/**
 * A fake of npm's registry and jsDelivr for themes, so tests never call the
 * real services, and a made-up theme to install. Never shipped: import it from
 * `@goodfellow-cms/core/testing` in tests only.
 */
import { serializeContent } from "./content/serialize.js";
import { THEME_KEYWORD, THEME_MANIFEST } from "./themes.js";

export interface FakeThemeRelease {
  version: string;
  /** How many days before `now` it was published: 30 if left out. */
  age?: number;
  /** Its `peerDependencies` range on `@goodfellow-cms/core`: any release if left out; `null` for none. */
  goodfellow?: string | null;
  provenance?: boolean;
  repository?: string;
  deprecated?: string;
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

/**
 * Fake answers for npm's registry (`registry.npmjs.org`) and jsDelivr's npm
 * files (`cdn.jsdelivr.net`): `handle()` for end-to-end tests' routes, `fetch`
 * for unit tests.
 */
export function fakeThemes(options: FakeThemesOptions) {
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
    const objects = options.themes
      .filter((theme) => {
        const keywords = theme.keywords ?? [THEME_KEYWORD];
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
            keywords: theme.keywords ?? [THEME_KEYWORD],
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
        keywords: theme.keywords ?? [THEME_KEYWORD],
        ...(goodfellow !== null && { peerDependencies: { "@goodfellow-cms/core": goodfellow } }),
        ...(release.repository && { repository: { type: "git", url: `git+${release.repository}.git` } }),
        ...(release.deprecated && { deprecated: release.deprecated }),
        dist: {
          tarball: `https://registry.npmjs.org/${theme.name}/-/${release.version}.tgz`,
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

  function handle(address: string): FakeThemesResponse {
    requests.push(address);
    const url = new URL(address);
    if (url.hostname === "registry.npmjs.org") {
      if (url.pathname === "/-/v1/search") return search(url);
      const name = decodeURIComponent(url.pathname.slice(1));
      const theme = options.themes.find((candidate) => candidate.name === name);
      return theme ? metadata(theme) : json({ error: "Not found" }, 404);
    }
    if (url.hostname === "cdn.jsdelivr.net") {
      const match = /^\/npm\/((?:@[^/]+\/)?[^/@]+)@([^/]+)\/(.+)$/.exec(decodeURIComponent(url.pathname));
      const theme = options.themes.find((candidate) => candidate.name === match?.[1]);
      const release = theme?.releases.find((candidate) => candidate.version === match?.[2]);
      const file = match?.[3] && release?.files[match[3]];
      if (file !== undefined && file !== "") {
        const type = match?.[3]?.endsWith(".css") ? "text/css" : "application/json";
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
