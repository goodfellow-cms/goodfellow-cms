import { describe, expect, it } from "vitest";
import { cloudflareSiteHeaders, headersHost, netlifySiteHeaders } from "./admin-domain.js";
import { outsideHost } from "./cloudflare-setup.js";
import { netlifySetupFiles } from "./netlify-setup.js";

/** Netlify's rules as path → headers, as a host that applies every matching rule would read them. */
function rules(text: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  let path = "";
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    if (!line.startsWith(" ")) {
      path = line;
      found.set(path, []);
    } else found.get(path)?.push(line.trim());
  }
  return found;
}

describe("Netlify's header rules", () => {
  const text = netlifySiteHeaders("/");

  it("never use Cloudflare's way of taking a header away, which Netlify doesn't document", () => {
    expect(cloudflareSiteHeaders("/")).toContain("! Content-Security-Policy");
    expect(text).not.toMatch(/^\s*!/m);
  });

  it("keep the admin panel's own headers off the editor's frames, whatever way Netlify combines rules", () => {
    const found = rules(text);
    // Only exact addresses of the admin page, never a pattern its frames' addresses match.
    const adminPaths = [...found].filter(([, lines]) => lines.some((line) => line.includes("frame-ancestors 'none'")));
    expect(adminPaths.map(([path]) => path)).toEqual(["/admin", "/admin/", "/admin/index.html", "/admin.html"]);
    expect(found.get("/admin/editor/*")).toEqual([
      "Content-Security-Policy: object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
      "Origin-Agent-Cluster: ?1",
    ]);
    // Every rule's policy keeps what every page's has, so it's right whether rules are joined or one wins.
    for (const [path, lines] of found) {
      const policy = lines.find((line) => line.startsWith("Content-Security-Policy:"));
      expect(policy, path).toContain("object-src 'none'; base-uri 'self'");
    }
    expect(found.get("/media/*.svg")).toEqual(["Content-Security-Policy: object-src 'none'; base-uri 'self'; sandbox"]);
  });

  it("let the site's token broker frame the admin panel, under the base path", () => {
    expect(rules(netlifySiteHeaders("/site/", { broker: "https://signin.example.org" })).get("/site/admin/")).toContain(
      "Content-Security-Policy: object-src 'none'; base-uri 'self'; frame-ancestors https://signin.example.org",
    );
  });

  it("are written where Netlify builds the site, or where the site says it's on Netlify", () => {
    expect(headersHost({ NETLIFY: "true" })).toBe("netlify");
    expect(headersHost({ GOODFELLOW_HOST: "netlify" })).toBe("netlify");
    expect(headersHost({ CF_PAGES: "1" })).toBeUndefined();
  });
});

describe("outsideHost", () => {
  it("tells a Netlify site by its netlify.toml or its build hook", async () => {
    const files = netlifySetupFiles({ git: "github", next: false });
    expect(await outsideHost(async (path) => files.get(path))).toBe("netlify");
    const workflowOnly = new Map([...files].filter(([path]) => path !== "netlify.toml"));
    expect(await outsideHost(async (path) => workflowOnly.get(path))).toBe("netlify");
    expect(await outsideHost(async (path) => (path === "vercel.ts" ? "{}" : undefined))).toBe("vercel");
  });
});
