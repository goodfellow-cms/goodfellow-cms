import { describe, expect, it } from "vitest";
import {
  adminAddressProblem,
  adminGuard,
  adminOrigin,
  cloudflareAdminHeaders,
  cloudflareSiteHeaders,
  configAdmin,
  pageFileKind,
  SITE_HEADERS_MARK,
  siteGuard,
  startsWithGuard,
  vercelAdminHeaders,
  vercelAdminRedirects,
  vercelHeaders,
  vercelSiteHeaders,
  withAdminConfig,
  withGuard,
  withVercelAdminAddress,
} from "./admin-domain.js";

const admin = { url: "https://admin.example.org" };
const script = siteGuard("https://admin.example.org", "https://example.org");

describe("admin addresses", () => {
  it("takes https:// addresses of their own only", () => {
    expect(adminOrigin(admin)).toBe("https://admin.example.org");
    expect(adminOrigin({ url: "https://admin.example.org/" })).toBe("https://admin.example.org");
    expect(adminOrigin({ url: "http://admin.example.org" })).toBeUndefined();
    expect(adminOrigin({ url: "http://localhost:4411" })).toBe("http://localhost:4411");
    expect(adminOrigin({ url: "https://example.org/admin" })).toBeUndefined();
    expect(adminOrigin({ url: "not an address" })).toBeUndefined();
    expect(adminAddressProblem(admin, "https://example.org/")).toBeUndefined();
    expect(adminAddressProblem({ url: "https://example.org" }, "https://example.org/site/")).toBe("same-as-site");
    expect(adminAddressProblem({ url: "http://admin.example.org" }, undefined)).toBe("invalid");
  });

  it("knows which files browsers open as pages", () => {
    expect(pageFileKind("about/index.html")).toBe("html");
    expect(pageFileKind("media/logo.SVG")).toBe("svg");
    expect(pageFileKind("feeds/news.rss")).toBe("xml");
    expect(pageFileKind("sitemap.xml")).toBe("xml");
    expect(pageFileKind("assets/site.js")).toBeUndefined();
    expect(pageFileKind("media/photo.jpg")).toBeUndefined();
    expect(pageFileKind("CNAME")).toBeUndefined();
  });
});

describe("guards", () => {
  it("puts the guard first in a page's head", () => {
    const html =
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><script async src="/x.js"></script></head>';
    const guarded = withGuard(html, "html", script) ?? "";
    expect(guarded.startsWith('<!DOCTYPE html><html lang="en"><head><script data-goodfellow-guard>')).toBe(true);
    expect(startsWithGuard(guarded, "html")).toBe(true);
    expect(withGuard(guarded, "html", script)).toBe(guarded);
    expect(startsWithGuard(html, "html")).toBe(false);
  });

  it("puts it in pages without a head, such as redirect pages", () => {
    const guarded = withGuard('<!doctype html><meta http-equiv="refresh" content="0;url=/new">', "html", script) ?? "";
    expect(guarded.startsWith("<!doctype html><script data-goodfellow-guard>")).toBe(true);
    expect(startsWithGuard(guarded, "html")).toBe(true);
  });

  it("refuses pages with anything that could run before it", () => {
    const after = `<script data-goodfellow-guard>${script}</script>`;
    expect(startsWithGuard(`<html><head><script>steal()</script>${after}`, "html")).toBe(false);
    expect(startsWithGuard(`<html onload="steal()"><head>${after}`, "html")).toBe(false);
    expect(startsWithGuard(`<html><head><iframe src="/x"></iframe>${after}`, "html")).toBe(false);
    expect(startsWithGuard(`<!-- note --><html lang="en"><head>${after}`, "html")).toBe(true);
  });

  it("puts the guard just inside an SVG's or XML file's root element", () => {
    const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect/></svg>';
    const guardedSvg = withGuard(svg, "svg", script) ?? "";
    expect(guardedSvg).toContain('viewBox="0 0 1 1"><script data-goodfellow-guard=""><![CDATA[');
    expect(startsWithGuard(guardedSvg, "svg")).toBe(true);

    const rss = '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel/></rss>';
    const guardedRss = withGuard(rss, "xml", script) ?? "";
    expect(guardedRss).toContain(
      '<rss version="2.0"><script xmlns="http://www.w3.org/1999/xhtml" data-goodfellow-guard=""><![CDATA[',
    );
    expect(startsWithGuard(guardedRss, "xml")).toBe(true);
  });

  it("refuses SVGs whose root has an event handler, and XML with a stylesheet", () => {
    const svg = withGuard('<svg xmlns="http://www.w3.org/2000/svg" onload="steal()"></svg>', "svg", script) ?? "";
    expect(startsWithGuard(svg, "svg")).toBe(false);
    const xml = withGuard('<?xml-stylesheet href="x.xsl" type="text/xsl"?><feed/>', "xml", script) ?? "";
    expect(startsWithGuard(xml, "xml")).toBe(false);
    expect(withGuard("", "html", script)).toBeUndefined();
    expect(withGuard("\u001f\u008b binary", "svg", script)).toBeUndefined();
  });

  it("writes scripts with nothing XML can't hold", () => {
    for (const guard of [script, adminGuard({ ...admin, checked: true })]) {
      expect(guard).not.toMatch(/[<&]|\]\]>/);
    }
  });
});

describe("host rules", () => {
  it("sandboxes every page at the admin address but the admin panel's, on Cloudflare Pages", () => {
    expect(cloudflareAdminHeaders(admin)).toBe(
      [
        "https://admin.example.org/*",
        "  Content-Security-Policy: sandbox",
        "",
        "https://admin.example.org/admin/*",
        "  ! Content-Security-Policy",
        "  Cross-Origin-Opener-Policy: same-origin",
        "  Content-Security-Policy: frame-ancestors 'none'",
        "  Origin-Agent-Cluster: ?1",
        "",
        "https://admin.example.org/admin/editor/*",
        "  ! Content-Security-Policy",
        "  Content-Security-Policy: frame-ancestors 'self'",
        "  Origin-Agent-Cluster: ?1",
        "",
        "https://admin.example.org/admin/plugins/*",
        "  ! Content-Security-Policy",
        "  Content-Security-Policy: frame-ancestors 'self'",
        "  Origin-Agent-Cluster: ?1",
        "",
      ].join("\n"),
    );
  });

  it("does the same on Vercel, for the admin address's host only", () => {
    const rules = vercelAdminHeaders(admin, "/site/");
    expect(rules.map((rule) => rule.source)).toEqual([
      "/site/((?!admin/|admin$).*)",
      "/site/admin/((?!editor/|editor$|plugins/).*)",
      "/site/admin/editor/:path*",
      "/site/admin/plugins/:path*",
    ]);
    expect(rules.every((rule) => rule.has?.[0]?.value === "admin.example.org")).toBe(true);
    expect(rules[0]?.headers).toEqual([{ key: "Content-Security-Policy", value: "sandbox" }]);
  });

  it("sends pages opened at the wrong address where the guards would, on Vercel", () => {
    const opened = { type: "header", key: "sec-fetch-dest", value: "document" };
    // Until the address is checked, the admin panel works at the Site address, so only site pages move.
    expect(vercelAdminRedirects(admin, "https://example.org/site/", "/site/")).toEqual([
      {
        source: "/site/:path((?!admin/|admin$).*)",
        has: [{ type: "host", value: "admin.example.org" }, opened],
        destination: "https://example.org/site/:path",
        permanent: false,
      },
    ]);
    const rules = vercelAdminRedirects({ ...admin, checked: true }, "https://example.org");
    expect(rules.map(({ source, destination }) => [source, destination])).toEqual([
      ["/:path((?!admin/|admin$).*)", "https://example.org/:path"],
      ["/admin", "https://admin.example.org/admin/"],
      ["/admin/:path((?!editor/|editor$|plugins/).*)", "https://admin.example.org/admin/:path"],
    ]);
    // Only from the Site address, so a copy at an address of its own keeps its admin panel.
    expect(rules[1]?.has).toEqual([{ type: "host", value: "example.org" }, opened]);
    // Without a Site address, or with an address that can't be one, there's nowhere to send anyone.
    expect(vercelAdminRedirects(admin, undefined)).toEqual([]);
    expect(vercelAdminRedirects({ url: "https://example.org" }, "https://example.org")).toEqual([]);
    expect(vercelAdminRedirects({ url: "http://admin.example.org" }, "https://example.org")).toEqual([]);
  });

  it("writes the admin address into a content repository's vercel.ts", () => {
    const source = "  redirects: [...adminRedirects(undefined), ...redirects()],\n";
    expect(withVercelAdminAddress(source, { ...admin, checked: true })).toBe(
      '  redirects: [...adminRedirects({"url":"https://admin.example.org","checked":true}), ...redirects()],\n',
    );
    expect(withVercelAdminAddress(withVercelAdminAddress(source, admin) ?? "", undefined)).toBe(source);
    expect(withVercelAdminAddress("  redirects: redirects(),\n", admin)).toBeUndefined();
  });

  it("gives every site's files safe headers, sandboxes its SVGs and keeps its admin panel from being framed", () => {
    const rules = cloudflareSiteHeaders("/site/");
    expect(rules.startsWith(`${SITE_HEADERS_MARK}\n/site/*\n  X-Content-Type-Options: nosniff\n`)).toBe(true);
    expect(rules).toContain("/site/media/*.svg\n  Content-Security-Policy: sandbox\n");
    expect(rules).toContain("/site/media/*.SVG\n  Content-Security-Policy: sandbox\n");
    expect(rules).toContain(
      "/site/admin/*\n  Cross-Origin-Opener-Policy: same-origin\n  Content-Security-Policy: frame-ancestors 'none'\n",
    );
    // The frames' paths are under the admin panel's too, whose headers Cloudflare would join with theirs.
    expect(rules).toContain(
      "/site/admin/editor/*\n  ! Content-Security-Policy\n  ! Cross-Origin-Opener-Policy\n  ! Origin-Agent-Cluster\n  Content-Security-Policy: frame-ancestors 'self'\n",
    );
    // A token broker frames the admin panel.
    expect(cloudflareSiteHeaders("/", { broker: "https://signin.example.org" })).toContain(
      "frame-ancestors https://signin.example.org",
    );
    // An admin address's own rules cover the admin panel there.
    const withAdmin = cloudflareSiteHeaders("/", { admin });
    expect(withAdmin).toContain("/media/*.svg");
    expect(withAdmin).not.toContain("/admin/");
  });

  it("does the same on Vercel, then adds an admin address's rules", () => {
    expect(vercelHeaders().map((rule) => rule.source)).toEqual([
      "/(.*)",
      "/media/(.*)\\.(svg|SVG)",
      "/admin/((?!editor/|editor$|plugins/).*)",
      "/admin/editor/:path*",
      "/admin/plugins/:path*",
    ]);
    expect(vercelHeaders().every((rule) => rule.has === undefined)).toBe(true);
    expect(vercelHeaders({ base: "/site/" })[1]?.source).toBe("/site/media/(.*)\\.(svg|SVG)");
    expect(vercelHeaders({ admin })).toEqual([...vercelSiteHeaders("/", { admin }), ...vercelAdminHeaders(admin)]);
    expect(vercelSiteHeaders("/", { admin })).toHaveLength(2);
  });
});

describe("the config's admin line", () => {
  const config = 'export default defineConfig({\n  blocks,\n  // backend: github({ repo: "a/b" }),\n});\n';

  it("adds, changes and removes it", () => {
    const added = withAdminConfig(config, admin) ?? "";
    expect(added).toBe(
      'export default defineConfig({\n  admin: { url: "https://admin.example.org" },\n  blocks,\n  // backend: github({ repo: "a/b" }),\n});\n',
    );
    expect(configAdmin(added)).toEqual(admin);
    const checked = withAdminConfig(added, { ...admin, checked: true }) ?? "";
    expect(checked).toContain('  admin: { url: "https://admin.example.org", checked: true },\n  blocks,');
    expect(configAdmin(checked)).toEqual({ ...admin, checked: true });
    expect(withAdminConfig(checked, undefined)).toBe(config);
    expect(configAdmin(config)).toBeUndefined();
    expect(withAdminConfig("export default {};\n", admin)).toBeUndefined();
  });
});
