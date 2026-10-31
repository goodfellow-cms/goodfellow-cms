/**
 * Visit counts: Plausible, Umami or GoatCounter, which count visits without
 * cookies. `content/site.json`'s `stats` names one; `statsElements()` gives the
 * service's own script, which both renderers add to the site's pages, and
 * `statsDashboard()` where its owner reads the counts. No React or DOM.
 */
import type { HeadElement } from "./content/code.js";
import type { ConsentKind, ConsentSettings } from "./content/schemas.js";
import { isPrivateHost } from "./hosts.js";

export const STATS_SERVICES = ["plausible", "umami", "goatcounter"] as const;

export type StatsService = (typeof STATS_SERVICES)[number];

/** What the counting script is for: `statistics`, which waits for visitors' agreement where the site asks, or `needed`. */
export const STATS_PURPOSES = ["statistics", "needed"] as const;

export type StatsPurpose = (typeof STATS_PURPOSES)[number];

/** A site's domain as Plausible knows it: `example.org`, or `example.org/blog`. */
export const PLAUSIBLE_DOMAIN =
  /^(?=.{1,253}(?:\/|$))[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:\/[\w.~-]+)*$/i;

/** An Umami website's id. */
export const UMAMI_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The services' own scripts, where a site uses their service rather than running its own. */
export const PLAUSIBLE_SCRIPT = "https://plausible.io/js/script.js";
export const UMAMI_SCRIPT = "https://cloud.umami.is/script.js";
export const GOATCOUNTER_SCRIPT = "https://gc.zgo.at/count.js";

export interface PlausibleStats {
  service: "plausible";
  /** The site's domain in Plausible, which its dashboard is named by. */
  domain: string;
  /** Plausible's script: its own (`PLAUSIBLE_SCRIPT`, or a site's `pa-….js`), or a server of the site's own. */
  script: string;
  purpose?: StatsPurpose;
}

export interface UmamiStats {
  service: "umami";
  website: string;
  /** Umami's script, on Umami Cloud (`UMAMI_SCRIPT`) or a server of the site's own. */
  script: string;
  purpose?: StatsPurpose;
}

export interface GoatCounterStats {
  service: "goatcounter";
  /** Where visits are counted: `https://<code>.goatcounter.com/count`, or a server of the site's own. */
  endpoint: string;
  /** GoatCounter's script, `GOATCOUNTER_SCRIPT` where it's left out. */
  script?: string;
  purpose?: StatsPurpose;
}

export type StatsSettings = PlausibleStats | UmamiStats | GoatCounterStats;

/**
 * An address the counting script may load from or send to: `https://` only,
 * never this computer or a private network, given back as the browser reads it.
 * `//host/path`, as GoatCounter writes its script, is read as `https://`.
 */
export function statsAddress(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().startsWith("//") ? `https:${value.trim()}` : value.trim();
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password || isPrivateHost(url.hostname)) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/** Plausible's scripts for one site (`/js/pa-….js`), which name the site themselves and start with `plausible.init()`. */
function isSiteScript(script: string): boolean {
  return /\/js\/pa-[\w-]+\.js$/.test(new URL(script).pathname);
}

/** What Plausible's site scripts need beside them, as Plausible gives it. */
const PLAUSIBLE_INIT =
  "window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()";

/**
 * The service's script for the site's pages, as head elements, or nothing
 * where the settings can't be used. Every script loads `async`, so it never
 * holds the page up, and Next.js's React moves it into the head as `goodfellow
 * build` writes it.
 */
export function statsElements(stats: StatsSettings | undefined): HeadElement[] {
  if (!stats) return [];
  if (stats.service === "plausible") {
    const script = statsAddress(stats.script);
    if (!script || !PLAUSIBLE_DOMAIN.test(stats.domain)) return [];
    if (isSiteScript(script)) {
      return [
        {
          tag: "script",
          attributes: [
            ["async", ""],
            ["src", script],
          ],
        },
        { tag: "script", attributes: [], content: PLAUSIBLE_INIT },
      ];
    }
    return [
      {
        tag: "script",
        attributes: [
          ["async", ""],
          ["data-domain", stats.domain],
          ["src", script],
        ],
      },
    ];
  }
  if (stats.service === "umami") {
    const script = statsAddress(stats.script);
    if (!script || !UMAMI_ID.test(stats.website)) return [];
    return [
      {
        tag: "script",
        attributes: [
          ["async", ""],
          ["data-website-id", stats.website],
          ["src", script],
        ],
      },
    ];
  }
  const endpoint = statsAddress(stats.endpoint);
  const script = statsAddress(stats.script ?? GOATCOUNTER_SCRIPT);
  if (!endpoint || !script) return [];
  return [
    {
      tag: "script",
      attributes: [
        ["async", ""],
        ["data-goatcounter", endpoint],
        ["src", script],
      ],
    },
  ];
}

/** Where the site's owner reads the counts, or nothing where the settings can't be used. */
export function statsDashboard(stats: StatsSettings | undefined): string | undefined {
  if (!stats || statsElements(stats).length === 0) return undefined;
  if (stats.service === "plausible") return `${new URL(stats.script).origin}/${encodeURIComponent(stats.domain)}`;
  if (stats.service === "umami") {
    const origin = new URL(stats.script).origin;
    return `${origin === new URL(UMAMI_SCRIPT).origin ? "https://cloud.umami.is" : origin}/websites/${stats.website}`;
  }
  return `${new URL(stats.endpoint).origin}/`;
}

/**
 * What the counting script waits for visitors to allow: `statistics`, on a
 * site that asks visitors first and hasn't said the script needs no
 * agreement, or `false` where it loads straight away.
 */
export function heldStats(consent: ConsentSettings | undefined, stats: StatsSettings | undefined): ConsentKind | false {
  if (!consent || !stats || stats.purpose === "needed") return false;
  return "statistics";
}

/** The attributes of the first `<script>` in some HTML, by lowercase name, read without a DOM. */
function scriptAttributes(html: string): Map<string, string>[] {
  const scripts: Map<string, string>[] = [];
  for (const tag of html.matchAll(/<script\b([^>]*)>/gi)) {
    const attributes = new Map<string, string>();
    for (const attribute of (tag[1] ?? "").matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      const name = attribute[1]?.toLowerCase();
      if (name) attributes.set(name, attribute[2] ?? attribute[3] ?? attribute[4] ?? "");
    }
    scripts.push(attributes);
  }
  return scripts;
}

/**
 * The settings for a service from what its owner pasted: the code the service
 * gives (its `<script>` tag), or, more simply, Plausible's domain, Umami's
 * website id, or GoatCounter's code or address. Nothing where it can't be read;
 * what's given still goes through `statsElements()`'s checks.
 */
export function readStatsCode(service: StatsService, pasted: string): StatsSettings | undefined {
  const text = pasted.trim();
  if (!text) return undefined;
  const scripts = scriptAttributes(text);
  if (service === "plausible") {
    if (!scripts.length) {
      const domain = text.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
      return PLAUSIBLE_DOMAIN.test(domain) ? { service, domain, script: PLAUSIBLE_SCRIPT } : undefined;
    }
    const found = scripts.find(
      (attributes) => attributes.has("src") && /plausible|\/js\/(script|pa-)/i.test(attributes.get("src") ?? ""),
    );
    const script = statsAddress(found?.get("src"));
    const domain = found?.get("data-domain");
    if (!script) return undefined;
    // A site script names the site itself, so its domain is asked for separately.
    return domain && PLAUSIBLE_DOMAIN.test(domain) ? { service, domain, script } : { service, domain: "", script };
  }
  if (service === "umami") {
    if (!scripts.length)
      return UMAMI_ID.test(text) ? { service, website: text.toLowerCase(), script: UMAMI_SCRIPT } : undefined;
    const found = scripts.find((attributes) => attributes.has("data-website-id"));
    const script = statsAddress(found?.get("src"));
    const website = found?.get("data-website-id")?.toLowerCase();
    return script && website && UMAMI_ID.test(website) ? { service, website, script } : undefined;
  }
  if (!scripts.length) {
    if (/^[a-z0-9][a-z0-9-]{0,62}$/i.test(text)) {
      return { service, endpoint: `https://${text.toLowerCase()}.goatcounter.com/count` };
    }
    const address = statsAddress(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (!address) return undefined;
    const url = new URL(address);
    return { service, endpoint: url.pathname === "/" ? new URL("/count", url).href : url.href };
  }
  const found = scripts.find((attributes) => attributes.has("data-goatcounter"));
  const endpoint = statsAddress(found?.get("data-goatcounter"));
  const script = statsAddress(found?.get("src"));
  if (!endpoint) return undefined;
  return { service, endpoint, ...(script && script !== GOATCOUNTER_SCRIPT && { script }) };
}
