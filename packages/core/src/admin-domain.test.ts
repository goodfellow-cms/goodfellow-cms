import { describe, expect, it } from "vitest";
import {
  adminAddressProblem,
  adminGuard,
  adminOrigin,
  cloudflareAdminHeaders,
  configAdmin,
  pageFileKind,
  siteGuard,
  startsWithGuard,
  vercelAdminHeaders,
  withAdminConfig,
  withGuard,
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
      ].join("\n"),
    );
  });

  it("does the same on Vercel, for the admin address's host only", () => {
    const rules = vercelAdminHeaders(admin, "/site/");
    expect(rules.map((rule) => rule.source)).toEqual([
      "/site/((?!admin/|admin$).*)",
      "/site/admin/((?!editor/|editor$).*)",
      "/site/admin/editor/:path*",
    ]);
    expect(rules.every((rule) => rule.has[0]?.value === "admin.example.org")).toBe(true);
    expect(rules[0]?.headers).toEqual([{ key: "Content-Security-Policy", value: "sandbox" }]);
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
