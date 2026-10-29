/**
 * Admin domains: the site's build at a second address, such as
 * `admin.example.com`, where editors sign in, while visitors use the Site
 * address. It's another origin, so the site's pages can't read the admin
 * panel's storage, as long as no site page ever runs there: every page a
 * browser opens starts with a guard script that leaves the admin address, and
 * hosts that send headers sandbox the rest.
 *
 * Setting one up takes two publishes: the address (`AdminAddress.url`) first,
 * so builds write the guards and the sign-in worker gives tokens there, then,
 * once the admin panel has checked a site page at that address, `checked`,
 * from which the admin panel starts only there.
 */

/** `GoodfellowConfig.admin`: where the admin panel starts and signs in. */
export interface AdminAddress {
  /** The admin address, such as `https://admin.example.com`. */
  url: string;
  /**
   * Whether the admin panel has checked the address: a site page served there
   * leaves it before running anything. Until then the admin panel also starts
   * at the Site address; from then on it goes to this one.
   */
  checked?: boolean;
}

/**
 * The admin address's origin, such as `https://admin.example.com`, if it's a
 * valid `https://` address. `http://` is taken only for this computer
 * (`localhost` and `127.0.0.1`), which nobody else can reach, for tests.
 */
export function adminOrigin(admin: AdminAddress | undefined): string | undefined {
  if (!admin) return undefined;
  try {
    const url = new URL(admin.url);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const secure = url.protocol === "https:" || (url.protocol === "http:" && local);
    return secure && url.pathname === "/" && !url.search && !url.hash ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/** Why an admin address can't be used, for builds and the admin panel to explain. */
export type AdminAddressProblem =
  /** Not an `https://` address of its own, such as `https://admin.example.com`. */
  | "invalid"
  /** The same address as the site's, which leaves nothing to keep apart. */
  | "same-as-site";

export function adminAddressProblem(admin: AdminAddress, siteUrl: string | undefined): AdminAddressProblem | undefined {
  const origin = adminOrigin(admin);
  if (!origin) return "invalid";
  if (siteUrl) {
    try {
      if (new URL(siteUrl).origin === origin) return "same-as-site";
    } catch {
      // A Site address that isn't one is the site checks' to report.
    }
  }
  return undefined;
}

/** What marks a guard script, so checks can find it. */
export const GUARD_ATTRIBUTE = "data-goodfellow-guard";

/**
 * The script every site page starts with: on the admin address, it stops the
 * page loading, so nothing after it runs, and goes to the same page at the
 * Site address. `document.write()` of `<plaintext>` turns the rest of an HTML
 * page into text before the parser reaches it; XML and SVG can't be written
 * to, so they only stop.
 */
export function siteGuard(admin: string, site: string | undefined): string {
  const go = site ? `location.replace(${JSON.stringify(site)}+location.pathname+location.search+location.hash);` : "";
  return `(function(){if(location.origin!==${JSON.stringify(admin)})return;try{document.write("\\x3cplaintext hidden>")}catch(e){}try{window.stop()}catch(e){}${go}})();`;
}

/**
 * The script the admin panel's page starts with: it never draws itself in a
 * frame, which keeps pages on the same site, the Site address included, from
 * putting it under someone's pointer; and once the address is checked, it
 * starts only there, going there from anywhere else.
 */
export function adminGuard(admin: AdminAddress, broker?: string): string {
  const origin = JSON.stringify(adminOrigin(admin) ?? "");
  const checked = admin.checked === true;
  // With a token broker, the admin panel is shown in its frame, and waits for the broker before showing anything.
  const framedCheck = broker ? "var framed=false;" : "var framed=true;try{framed=window.top!==window}catch(e){}";
  return `(function(){${framedCheck}var away=${checked ? `location.origin!==${origin}` : "false"};if(!(framed||away))return;try{document.write("\\x3cplaintext hidden>")}catch(e){}try{window.stop()}catch(e){}if(!framed)location.replace(${origin}+location.pathname+location.search+location.hash);})();`;
}

/** The kinds of file a browser opens as a page, which can run scripts. */
export type PageFileKind = "html" | "svg" | "xml";

const PAGE_EXTENSIONS: Record<string, PageFileKind> = {
  html: "html",
  htm: "html",
  shtml: "html",
  xhtml: "xml",
  xht: "xml",
  svg: "svg",
  svgz: "svg",
  xml: "xml",
  rss: "xml",
  atom: "xml",
  rdf: "xml",
  xsl: "xml",
  xslt: "xml",
  mml: "xml",
};

/** What kind of page a file is, from its name, or `undefined` for files browsers don't run, such as images and scripts. */
export function pageFileKind(path: string): PageFileKind | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? undefined : PAGE_EXTENSIONS[name.slice(dot + 1).toLowerCase()];
}

function guardElement(script: string, kind: PageFileKind): string {
  if (kind === "html") return `<script ${GUARD_ATTRIBUTE}>${script}</script>`;
  // XML's scripts run only in the XHTML or SVG namespace, and their text can't hold a bare "<" or "&".
  const namespace = kind === "svg" ? "" : ' xmlns="http://www.w3.org/1999/xhtml"';
  return `<script${namespace} ${GUARD_ATTRIBUTE}=""><![CDATA[${script}]]></script>`;
}

/** Where the guard goes: just after `<head>`, or failing that `<html>` or the doctype, in HTML; just inside the root element in XML. */
function guardPosition(text: string, kind: PageFileKind): number | undefined {
  if (kind === "html") {
    for (const pattern of [/<head(?:\s[^>]*)?>/i, /<html(?:\s[^>]*)?>/i, /<!doctype[^>]*>/i]) {
      const match = pattern.exec(text);
      if (match) return match.index + match[0].length;
    }
    return /^\s*$/.test(text) ? undefined : 0;
  }
  const root = rootElement(text);
  return root ? root.end : undefined;
}

/** The root element's start tag in an XML file, after its declaration, comments, doctype and processing instructions. */
function rootElement(text: string): { start: number; end: number; tag: string } | undefined {
  const prolog = /^(?:\uFEFF)?(?:\s+|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE(?:[^[>]|\[[\s\S]*?\])*>)*/i.exec(text);
  const start = prolog ? prolog[0].length : 0;
  const tag = /^<[A-Za-z_][^\s/>]*(?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*\s*>/.exec(text.slice(start));
  return tag ? { start, end: start + tag[0].length, tag: tag[0] } : undefined;
}

/** A page with the guard put in first, or `undefined` if it isn't a page the guard can go in, such as an empty file. */
export function withGuard(text: string, kind: PageFileKind, script: string): string | undefined {
  if (startsWithGuard(text, kind)) return text;
  const at = guardPosition(text, kind);
  if (at === undefined) return undefined;
  return `${text.slice(0, at)}${guardElement(script, kind)}${text.slice(at)}`;
}

/**
 * Whether a page starts with a guard, with nothing before it that could run
 * first: no script, no event handler attribute, no frame, and in XML no
 * stylesheet processing instruction, which can turn the page into another.
 */
export function startsWithGuard(text: string, kind: PageFileKind): boolean {
  const marker = kind === "html" ? `<script ${GUARD_ATTRIBUTE}>` : `${GUARD_ATTRIBUTE}=""><![CDATA[`;
  const at = text.indexOf(marker);
  if (at === -1) return false;
  if (kind === "html") {
    const before = text.slice(0, at);
    const safe =
      /^(?:\uFEFF)?\s*(?:<!doctype[^>]*>\s*)?(?:<!--(?:(?!-->)[\s\S])*-->\s*)*(?:<html(?:\s+[a-z:-]+(?:="[^"<>]*")?)*\s*>\s*)?(?:<head\s*>\s*)?$/i;
    return safe.test(before) && !/\son[a-z]+\s*=/i.test(before);
  }
  const root = rootElement(text);
  if (!root || /<\?xml-stylesheet/i.test(text.slice(0, root.start)) || /\son[a-z]+\s*=/i.test(root.tag)) return false;
  const opening = kind === "svg" ? "<script " : '<script xmlns="http://www.w3.org/1999/xhtml" ';
  return text.startsWith(`${opening}${marker}`, root.end);
}

/** What checking an admin address found. */
export type AdminAddressCheck =
  /** A site page there leaves before running anything, or the host sends it away. */
  | "ok"
  /** The site's home page there doesn't start with the guard: the site hasn't been rebuilt with the address yet. */
  | "no-guard"
  /** The host sends headers but didn't sandbox the page. */
  | "no-sandbox"
  /** The page couldn't be read. */
  | "failed";

/** The part of a `fetch()` answer `checkAdminAddress()` reads. */
export interface AdminCheckResponse {
  redirected: boolean;
  url: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/**
 * Checks an admin address by reading the site's home page there (`home`, at
 * the admin address): it must start with the guard, and, where the host sends
 * headers, be sandboxed, unless the host sends it to another address. The
 * admin panel runs it from the admin address, the only page that can read
 * there, and `goodfellow admin check` from a computer.
 */
export async function checkAdminAddress(
  home: string,
  options: { headers: boolean; fetch: (url: string) => Promise<AdminCheckResponse> },
): Promise<AdminAddressCheck> {
  try {
    const response = await options.fetch(home);
    if (response.redirected && new URL(response.url).origin !== new URL(home).origin) return "ok";
    if (!startsWithGuard(await response.text(), "html")) return "no-guard";
    const policy = response.headers.get("content-security-policy") ?? "";
    if (options.headers && !/(^|[;,])\s*sandbox(\s|;|,|$)/i.test(policy)) return "no-sandbox";
    return "ok";
  } catch {
    return "failed";
  }
}

/** The headers the admin panel's own pages get where the host sends headers. */
export const ADMIN_PAGE_HEADERS: Readonly<Record<string, string>> = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Origin-Agent-Cluster": "?1",
};

/** `ADMIN_PAGE_HEADERS`, letting the site's token broker, at `broker`, show the admin panel in its frame. */
export function adminPageHeaders(broker?: string): Readonly<Record<string, string>> {
  return broker
    ? { ...ADMIN_PAGE_HEADERS, "Content-Security-Policy": `frame-ancestors ${broker}` }
    : ADMIN_PAGE_HEADERS;
}

/** The editor's frames, and plugins', are the admin panel's own, so they may be framed by it, and only by it. */
const EDITOR_FRAME_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": "frame-ancestors 'self'",
  "Origin-Agent-Cluster": "?1",
};

/** Where Cloudflare Pages reads header rules from, in the built site. */
export const CLOUDFLARE_HEADERS_PATH = "_headers";

/**
 * Cloudflare Pages' header rules for an admin address: every page there is
 * sandboxed, in an opaque origin without the admin panel's storage, except the
 * admin panel's own, which get `ADMIN_PAGE_HEADERS`. `base` is the site's base
 * path, such as `/` or `/my-site/`.
 */
export function cloudflareAdminHeaders(admin: AdminAddress, base = "/", broker?: string): string {
  const origin = adminOrigin(admin);
  if (!origin) return "";
  const adminPath = `${base.replace(/\/?$/, "/")}admin/`;
  const block = (path: string, lines: string[]) => [`${origin}${path}`, ...lines.map((line) => `  ${line}`)].join("\n");
  const headers = (record: Readonly<Record<string, string>>) =>
    Object.entries(record).map(([name, value]) => `${name}: ${value}`);
  return `${[
    block("/*", ["Content-Security-Policy: sandbox"]),
    block(`${adminPath}*`, ["! Content-Security-Policy", ...headers(adminPageHeaders(broker))]),
    block(`${adminPath}editor/*`, ["! Content-Security-Policy", ...headers(EDITOR_FRAME_HEADERS)]),
    block(`${adminPath}plugins/*`, ["! Content-Security-Policy", ...headers(EDITOR_FRAME_HEADERS)]),
  ].join("\n\n")}\n`;
}

/** A Vercel header rule, as `vercel.ts` and Next.js's `headers()` take it. */
export interface HostHeaderRule {
  source: string;
  /** The host it's for, such as the admin address; every host without it. */
  has?: { type: "host"; value: string }[];
  headers: { key: string; value: string }[];
}

/** Vercel's header rules for an admin address, the same as `cloudflareAdminHeaders()`'s. `base` is the site's base path. */
export function vercelAdminHeaders(admin: AdminAddress, base = "/", broker?: string): HostHeaderRule[] {
  const origin = adminOrigin(admin);
  if (!origin) return [];
  const has = [{ type: "host" as const, value: origin.replace(/^https?:\/\//, "") }];
  const prefix = base.replace(/\/$/, "");
  const list = (record: Readonly<Record<string, string>>) =>
    Object.entries(record).map(([key, value]) => ({ key, value }));
  return [
    {
      source: `${prefix}/((?!admin/|admin$).*)`,
      has,
      headers: [{ key: "Content-Security-Policy", value: "sandbox" }],
    },
    { source: `${prefix}/admin/((?!editor/|editor$|plugins/).*)`, has, headers: list(adminPageHeaders(broker)) },
    { source: `${prefix}/admin/editor/:path*`, has, headers: list(EDITOR_FRAME_HEADERS) },
    { source: `${prefix}/admin/plugins/:path*`, has, headers: list(EDITOR_FRAME_HEADERS) },
  ];
}

/** A Vercel redirect, as `vercel.ts` and Next.js's `redirects()` take it. */
export interface HostRedirectRule {
  source: string;
  has: ({ type: "host"; value: string } | { type: "header"; key: string; value: string })[];
  destination: string;
  /** Never permanent, since an owner can change or remove the admin address, and browsers keep permanent ones. */
  permanent: false;
}

/** The request header browsers send with what they're asked for, `document` for a page opened in a tab. */
const PAGE_OPENED = { type: "header" as const, key: "sec-fetch-dest", value: "document" };

/**
 * Vercel's redirects between the Site address and an admin address, which
 * send people where the guards would, before anything loads: a site page
 * opened at the admin address goes to the Site address, and, once the address
 * is `checked`, the admin panel opened at the Site address goes to the admin
 * address, as `adminGuard()` does. Only pages opened in a tab are sent
 * (`Sec-Fetch-Dest: document`): the admin panel's frames, previews' styles
 * and media, and checks of the address load where they are, and browsers that
 * don't say what they're opening still have the guards. Only from the Site
 * address's host, so copies and previews at other addresses keep their own.
 * Nothing without a Site address. `base` is the site's base path.
 */
export function vercelAdminRedirects(admin: AdminAddress, siteUrl: string | undefined, base = "/"): HostRedirectRule[] {
  const origin = adminOrigin(admin);
  if (!origin || !siteUrl || adminAddressProblem(admin, siteUrl)) return [];
  let site: URL;
  try {
    site = new URL(siteUrl);
  } catch {
    return [];
  }
  const prefix = base.replace(/\/$/, "");
  const host = (at: string) => ({ type: "host" as const, value: at.replace(/^https?:\/\//, "") });
  const atAdmin = [host(origin), PAGE_OPENED];
  const atSite = [host(site.origin), PAGE_OPENED];
  return [
    {
      source: `${prefix}/:path((?!admin/|admin$).*)`,
      has: atAdmin,
      destination: `${site.origin}${prefix}/:path`,
      permanent: false,
    },
    ...(admin.checked
      ? [
          {
            source: `${prefix}/admin`,
            has: atSite,
            destination: `${origin}${prefix}/admin/`,
            permanent: false as const,
          },
          {
            source: `${prefix}/admin/:path((?!editor/|editor$|plugins/).*)`,
            has: atSite,
            destination: `${origin}${prefix}/admin/:path`,
            permanent: false as const,
          },
        ]
      : []),
  ];
}

/**
 * Headers every file of a site gets where the host sends headers: browsers
 * never guess a file's type from what's in it, other sites a visitor goes to
 * are told the site's address, not the page they came from, and pages can't
 * load plugins or point their links elsewhere with `<base>`. Scripts, styles
 * and frames aren't limited, since custom code and embeds need them.
 */
export const SITE_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Only what no block or custom code needs: plugins (`<object>`, `<embed>`) and a `<base>` sending links elsewhere.
  "Content-Security-Policy": "object-src 'none'; base-uri 'self'",
};

/**
 * The media library's SVGs, which can hold scripts, opened on their own run in
 * an opaque origin, so never as the site, whatever `cleanSvg()` missed or
 * didn't see. Only SVGs: Chrome won't show a sandboxed PDF.
 */
export const SVG_MEDIA_HEADERS: Readonly<Record<string, string>> = { "Content-Security-Policy": "sandbox" };

/** Starts Goodfellow's rules in `_headers`, so a build adds them once to a site's own file. */
export const SITE_HEADERS_MARK = "# Goodfellow's header rules";

/**
 * Cloudflare Pages' header rules for every site: `SITE_HEADERS` everywhere,
 * the media library's SVGs sandboxed, and, without an admin address (whose
 * own rules, `cloudflareAdminHeaders()`, cover them), the admin panel's pages'
 * `adminPageHeaders()` and its frames', so no other site can frame them and
 * the site's pages can't reach a window of them. `base` is the site's base path.
 */
export function cloudflareSiteHeaders(
  base = "/",
  { admin, broker }: { admin?: AdminAddress; broker?: string } = {},
): string {
  const root = base.replace(/\/?$/, "/");
  const block = (path: string, lines: string[]) => [path, ...lines.map((line) => `  ${line}`)].join("\n");
  const headers = (record: Readonly<Record<string, string>>) =>
    Object.entries(record).map(([name, value]) => `${name}: ${value}`);
  const blocks = [
    block(`${root}*`, headers(SITE_HEADERS)),
    // A rule takes one splat, so each spelling of the extension has its own.
    block(`${root}media/*.svg`, headers(SVG_MEDIA_HEADERS)),
    block(`${root}media/*.SVG`, headers(SVG_MEDIA_HEADERS)),
  ];
  if (!adminOrigin(admin)) {
    const adminPath = `${root}admin/`;
    // The frames' rules take away the admin panel's, which their paths match too, since Cloudflare joins both.
    const frames = ["! Content-Security-Policy", "! Cross-Origin-Opener-Policy", "! Origin-Agent-Cluster"];
    blocks.push(
      block(`${adminPath}*`, headers(adminPageHeaders(broker))),
      block(`${adminPath}editor/*`, [...frames, ...headers(EDITOR_FRAME_HEADERS)]),
      block(`${adminPath}plugins/*`, [...frames, ...headers(EDITOR_FRAME_HEADERS)]),
    );
  }
  return `${SITE_HEADERS_MARK}\n${blocks.join("\n\n")}\n`;
}

/** Vercel's header rules for every site, the same as `cloudflareSiteHeaders()`'s. `base` is the site's base path. */
export function vercelSiteHeaders(
  base = "/",
  { admin, broker }: { admin?: AdminAddress; broker?: string } = {},
): HostHeaderRule[] {
  const prefix = base.replace(/\/$/, "");
  const list = (record: Readonly<Record<string, string>>) =>
    Object.entries(record).map(([key, value]) => ({ key, value }));
  const rules: HostHeaderRule[] = [
    { source: `${prefix}/(.*)`, headers: list(SITE_HEADERS) },
    { source: `${prefix}/media/(.*)\\.(svg|SVG)`, headers: list(SVG_MEDIA_HEADERS) },
  ];
  if (adminOrigin(admin)) return rules;
  return [
    ...rules,
    { source: `${prefix}/admin/((?!editor/|editor$|plugins/).*)`, headers: list(adminPageHeaders(broker)) },
    { source: `${prefix}/admin/editor/:path*`, headers: list(EDITOR_FRAME_HEADERS) },
    { source: `${prefix}/admin/plugins/:path*`, headers: list(EDITOR_FRAME_HEADERS) },
  ];
}

/** Every one of a site's Vercel header rules: `vercelSiteHeaders()`, then an admin address's `vercelAdminHeaders()`. */
export function vercelHeaders(
  options: { admin?: AdminAddress; base?: string; broker?: string } = {},
): HostHeaderRule[] {
  const { admin, base = "/", broker } = options;
  return [
    ...vercelSiteHeaders(base, { ...(admin && { admin }), ...(broker && { broker }) }),
    ...(admin ? vercelAdminHeaders(admin, base, broker) : []),
  ];
}

/** The `headers` line of a content repository's `vercel.ts`: header rules written out, since Vercel reads it before the code is cloned. */
const VERCEL_HEADERS_LINE = /^([ \t]*)headers: \[.*\],[ \t]*$/m;

/**
 * A content repository's `vercel.ts` with its `headers` line set to `rules`,
 * as `planSite()`, `goodfellow admin` and `goodfellow broker` copy them from
 * the code's config (`vercelAdminHeaders()`), or `undefined` if it has no such
 * line, such as a `vercel.ts` that reads the config itself.
 */
export function withVercelHeaders(source: string, rules: HostHeaderRule[]): string | undefined {
  if (!VERCEL_HEADERS_LINE.test(source)) return undefined;
  return source.replace(VERCEL_HEADERS_LINE, (_, indent: string) => `${indent}headers: ${JSON.stringify(rules)},`);
}

/** The `redirects` line of a `vercel.ts`, whose `adminRedirects()` is given the admin address. */
const VERCEL_ADMIN_REDIRECTS_LINE = /^([ \t]*)redirects: \[\.\.\.adminRedirects\(.*\), \.\.\.redirects\(\)\],[ \t]*$/m;

/**
 * A content repository's `vercel.ts` with the admin address written into its
 * `adminRedirects()` call, which works the redirects out from it and the
 * content's Site address (`vercelAdminRedirects()`), as `planSite()`,
 * `goodfellow admin` and `goodfellow broker` copy it from the code's config;
 * `undefined` if it has no such line.
 */
export function withVercelAdminAddress(source: string, admin: AdminAddress | undefined): string | undefined {
  if (!VERCEL_ADMIN_REDIRECTS_LINE.test(source)) return undefined;
  const value = admin ? JSON.stringify({ url: admin.url, checked: admin.checked === true }) : "undefined";
  return source.replace(
    VERCEL_ADMIN_REDIRECTS_LINE,
    (_, indent: string) => `${indent}redirects: [...adminRedirects(${value}), ...redirects()],`,
  );
}

const ADMIN_LINE = /^[ \t]*admin:[ \t]*\{[^\n]*\},?[ \t]*\n/m;

/**
 * `goodfellow.config.tsx` with its `admin` set to `admin`, or removed when
 * it's `undefined`, as the Domain screen publishes it. The option goes on one
 * line of its own, just inside `defineConfig({`, which `vercel.ts` reads too.
 * `undefined` if the file has no `defineConfig({` to put it in.
 */
export function withAdminConfig(source: string, admin: AdminAddress | undefined): string | undefined {
  const line = admin
    ? `  admin: { url: ${JSON.stringify(admin.url)}${admin.checked ? ", checked: true" : ""} },\n`
    : "";
  if (ADMIN_LINE.test(source)) return source.replace(ADMIN_LINE, line);
  if (!admin) return source;
  const opening = /defineConfig\(\{[ \t]*\n/.exec(source);
  if (!opening) return undefined;
  const at = opening.index + opening[0].length;
  return `${source.slice(0, at)}${line}${source.slice(at)}`;
}

/** The `admin` that `goodfellow.config.tsx` sets on its line of its own, as `withAdminConfig()` writes it. */
export function configAdmin(source: string): AdminAddress | undefined {
  const line = ADMIN_LINE.exec(source)?.[0];
  const url = line && /url:\s*"([^"\\]+)"/.exec(line)?.[1];
  if (!line || !url) return undefined;
  return { url, ...(/checked:\s*true/.test(line) && { checked: true }) };
}
