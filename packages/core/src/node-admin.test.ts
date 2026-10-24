import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AdminCheckResponse, siteGuard, vercelAdminHeaders } from "./admin-domain.js";
import { AdminSetupError, checkSiteAdminAddress, formatAdminResult, setAdminAddress } from "./node-admin.js";
import { setBrokerAddress } from "./node-broker.js";

let site: string;
const config = () => readFile(join(site, "goodfellow.config.tsx"), "utf8");
const contentVercel = () => readFile(join(site, "content-repository/vercel.ts"), "utf8");

/** The site's home page, as a host serves it at the admin address. */
function page(html: string, headers: Record<string, string> = {}, redirectedTo?: string) {
  return async (url: string): Promise<AdminCheckResponse> => ({
    redirected: redirectedTo !== undefined,
    url: redirectedTo ?? url,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => html,
  });
}
const guarded = `<!doctype html><html><head><script data-goodfellow-guard>${siteGuard("https://admin.example.org", "https://parish.example.org")}</script><title>Home</title>`;

beforeEach(async () => {
  site = await mkdtemp(join(tmpdir(), "goodfellow-admin-"));
  // A site whose content is kept in a repository of its own, which Vercel builds from.
  await mkdir(join(site, "content-repository/content"), { recursive: true });
  await writeFile(
    join(site, "content-repository/content/site.json"),
    JSON.stringify({ title: "St. Joseph's", url: "https://parish.example.org/" }),
  );
  await writeFile(
    join(site, "content-repository/vercel.ts"),
    "export const config = {\n  framework: null,\n  headers: [],\n};\n",
  );
  await writeFile(join(site, "goodfellow.config.tsx"), "export default defineConfig({\n  blocks,\n});\n");
});

afterEach(async () => {
  await rm(site, { recursive: true, force: true });
});

describe("setAdminAddress", () => {
  it("names the address in the config, and writes Vercel's header rules into the content repository's vercel.ts", async () => {
    const result = await setAdminAddress(site, "admin.example.org/");
    expect(result).toEqual({ admin: { url: "https://admin.example.org" }, contentChanged: true });
    expect(await config()).toContain('  admin: { url: "https://admin.example.org" },');
    expect(await contentVercel()).toContain(
      `  headers: ${JSON.stringify(vercelAdminHeaders({ url: "https://admin.example.org" }))},`,
    );

    // A broker added later is named in the rules too.
    await setBrokerAddress(site, "https://signin.example.org");
    expect(await contentVercel()).toContain("frame-ancestors https://signin.example.org");

    await setAdminAddress(site, undefined);
    expect(await config()).not.toContain("admin:");
    expect(await contentVercel()).toContain("  headers: [],");
  });

  it("refuses addresses that aren't one of its own", async () => {
    await expect(setAdminAddress(site, "https://parish.example.org")).rejects.toThrow("site's own address");
    await expect(setAdminAddress(site, "http://admin.example.org")).rejects.toBeInstanceOf(AdminSetupError);
    await expect(setAdminAddress(site, "https://admin.example.org/admin")).rejects.toThrow("nothing after");
  });
});

describe("checkSiteAdminAddress", () => {
  it("marks the address checked once the home page there starts with the guard, sandboxed on Vercel", async () => {
    await expect(checkSiteAdminAddress(site, { fetch: page(guarded) })).rejects.toThrow("goodfellow admin add");
    await setAdminAddress(site, "https://admin.example.org");

    const notYet = await checkSiteAdminAddress(site, { fetch: page("<!doctype html><title>Home</title>") });
    expect(notYet.check).toBe("no-guard");
    expect(notYet.home).toBe("https://admin.example.org/");
    expect(formatAdminResult("check", notYet).ok).toBe(false);
    expect(await config()).not.toContain("checked");

    // Vercel builds it, so the page there must be sandboxed too.
    expect((await checkSiteAdminAddress(site, { fetch: page(guarded) })).check).toBe("no-sandbox");
    const ready = await checkSiteAdminAddress(site, {
      fetch: page(guarded, { "content-security-policy": "sandbox" }),
    });
    expect(ready.check).toBe("ok");
    expect(await config()).toContain('  admin: { url: "https://admin.example.org", checked: true },');
    expect(formatAdminResult("check", ready).lines[0]).toContain("https://admin.example.org is ready");
  });

  it("takes a host sending the address's pages to the Site address as passing", async () => {
    await setAdminAddress(site, "https://admin.example.org");
    const result = await checkSiteAdminAddress(site, { fetch: page("", {}, "https://parish.example.org/") });
    expect(result.check).toBe("ok");
  });
});
