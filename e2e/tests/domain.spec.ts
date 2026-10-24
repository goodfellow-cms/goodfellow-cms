import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { fakeGitLab } from "@goodfellow-cms/gitlab/testing";
import { expect, type Page, test } from "@playwright/test";
import { files, GITHUB_SITE, GITLAB_SITE, routeToFake } from "./backends.js";

const TYPES: Record<string, number> = { A: 1, CNAME: 5, SOA: 6, TXT: 16, AAAA: 28 };

/**
 * A fake of Google Public DNS, which the Domain screen checks records with,
 * answering from `records` (name → type → values) with `zone` as the only zone.
 */
async function fakeDns(page: Page, zone: string, records: Record<string, Record<string, string[]>>) {
  await page.route("https://dns.google/resolve**", (route) => {
    const url = new URL(route.request().url());
    const name = url.searchParams.get("name") ?? "";
    const type = url.searchParams.get("type") ?? "A";
    const body =
      type === "SOA"
        ? name === zone
          ? { Status: 0, Answer: [{ name: `${name}.`, type: 6, data: "ns1.example. host. 1 2 3 4 5" }] }
          : { Status: 0, Authority: [{ name: `${zone}.`, type: 6, data: "ns1.example. host. 1 2 3 4 5" }] }
        : {
            Status: 0,
            Answer: (records[name]?.[type] ?? []).map((data) => ({ name: `${name}.`, type: TYPES[type], data })),
          };
    return route.fulfill({ json: body, headers: { "access-control-allow-origin": "*" } });
  });
}

/** The new domain's site: unreachable until `online.value` is set. */
async function domainSite(page: Page, origin: string) {
  const online = { value: false };
  await page.route(`${origin}/**`, (route) =>
    online.value ? route.fulfill({ status: 200, body: "<!doctype html>" }) : route.abort("connectionrefused"),
  );
  return online;
}

function siteAddress(file: string | Uint8Array | undefined): unknown {
  return JSON.parse(typeof file === "string" ? file : new TextDecoder().decode(file)).url;
}

test("connects a domain to a GitHub Pages site, and follows it until it works", async ({ page }) => {
  const fake = fakeGitHub({ repo: "parish/site", files: files(), pages: true });
  await routeToFake(page, "https://api.github.com", fake.handle);
  const dns: Record<string, Record<string, string[]>> = { "parish.example": { A: ["203.0.113.7"] } };
  await fakeDns(page, "parish.example", dns);
  const online = await domainSite(page, "https://parish.example");

  await page.goto(`${GITHUB_SITE}/admin/#/settings/domain`);
  await page.getByLabel("Access token").fill("test-token");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("The site is at https://parish.github.io/site/ now.")).toBeVisible();

  await page.getByLabel("Domain", { exact: true }).fill("https://Parish.example/");
  await page.getByRole("button", { name: "Connect domain" }).click();

  // Connected on GitHub, and the site's address published, so the next build is served from the domain's root.
  await expect(page.getByRole("heading", { name: "1. Add these records at your registrar" })).toBeVisible();
  // Signing in with a token works from any address.
  await expect(page.getByText("to the redirect URIs")).toHaveCount(0);
  expect(fake.pages.current?.cname).toBe("parish.example");
  expect(siteAddress(fake.repo.files().get("content/site.json"))).toBe("https://parish.example");
  const rows = page.locator(".gfa-records tbody tr");
  await expect(rows).toHaveCount(9);
  await expect(rows.first()).toContainText("@");
  await expect(rows.first()).toContainText("185.199.108.153");
  // A registrar's own address is still there.
  await expect(rows.first()).toContainText("Something else is there: 203.0.113.7");
  await expect(rows.last()).toContainText("www");
  await expect(page.getByText("Not yet.")).toBeVisible();

  dns["parish.example"] = {
    A: ["185.199.108.153", "185.199.109.153", "185.199.110.153", "185.199.111.153"],
  };
  if (fake.pages.current) fake.pages.current.certificate = "approved";
  online.value = true;
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(rows.first()).toContainText("In place");
  await expect(page.getByText("The HTTPS certificate is ready.")).toBeVisible();
  await expect(page.getByText("It does.")).toBeVisible();

  await page.getByRole("button", { name: "Send everyone to https://parish.example" }).click();
  await expect(page.getByText("Done: the site is at https://parish.example.")).toBeVisible();
  expect(fake.pages.current?.https_enforced).toBe(true);

  await page.getByRole("button", { name: "Remove domain" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove domain" }).click();
  await expect(page.getByLabel("Domain", { exact: true })).toBeVisible();
  expect(fake.pages.current?.cname).toBeNull();
  expect(siteAddress(fake.repo.files().get("content/site.json"))).toBe("https://parish.github.io/site");
});

test("connects a subdomain to a GitLab Pages site once GitLab has verified it", async ({ page }) => {
  const fake = fakeGitLab({
    project: "parish/site",
    files: files(),
    tokens: { "glpat-test": { username: "maria" } },
    pages: {},
  });
  await routeToFake(page, "https://gitlab.com/api", fake.handle);
  const dns: Record<string, Record<string, string[]>> = {};
  await fakeDns(page, "parish.example", dns);
  const online = await domainSite(page, "https://www.parish.example");

  await page.goto(`${GITLAB_SITE}/admin/#/settings/domain`);
  await page.getByText("Or sign in with an access token").click();
  await page.getByLabel("Access token").fill("glpat-test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Domain", { exact: true }).fill("www.parish.example");
  await page.getByRole("button", { name: "Connect domain" }).click();

  const rows = page.locator(".gfa-records tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("CNAME");
  await expect(rows.nth(0)).toContainText("parish.gitlab.io");
  await expect(rows.nth(1)).toContainText("_gitlab-pages-verification-code.www");
  // Editors sign in by being sent to GitLab, which sends them back only to addresses it allows.
  await expect(page.getByText("Add https://www.parish.example/admin/ to the redirect URIs")).toBeVisible();
  await expect(page.getByText("Waiting for GitLab to find the record that proves the domain is yours.")).toBeVisible();
  const code = fake.pages?.domains.get("www.parish.example")?.verificationCode ?? "";

  dns["www.parish.example"] = { CNAME: ["parish.gitlab.io."] };
  dns["_gitlab-pages-verification-code.www.parish.example"] = { TXT: [`"gitlab-pages-verification-code=${code}"`] };
  fake.pages?.dnsReady.add("www.parish.example");
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(rows.nth(1)).toContainText("In place");
  await expect(page.getByText("Waiting for the HTTPS certificate")).toBeVisible();

  const domain = fake.pages?.domains.get("www.parish.example");
  if (domain) domain.certificate = true;
  online.value = true;
  await page.getByRole("button", { name: "Check again" }).click();
  await page.getByRole("button", { name: "Send everyone to https://www.parish.example" }).click();
  // GitLab already sends everyone to HTTPS; the domain becomes where the gitlab.io address sends visitors.
  await expect(page.getByText("Done: the site is at https://www.parish.example.")).toBeVisible();
  expect(fake.pages?.primaryDomain).toBe("www.parish.example");
  expect(siteAddress(fake.repo.files().get("content/site.json"))).toBe("https://www.parish.example");
});

test("asks for an owner token when signing in can't change GitHub Pages settings", async ({ page }) => {
  const fake = fakeGitHub({
    repo: "parish/site",
    files: files(),
    pages: true,
    tokens: {
      "test-token": { login: "maria", admin: true, pages: false },
      "owner-token": { login: "maria", admin: true, administration: true },
    },
  });
  await routeToFake(page, "https://api.github.com", fake.handle);
  await fakeDns(page, "parish.example", {});

  await page.goto(`${GITHUB_SITE}/admin/#/settings/domain`);
  await page.getByLabel("Access token").fill("test-token");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Domain", { exact: true }).fill("parish.example");
  await page.getByRole("button", { name: "Connect domain" }).click();
  await page.getByLabel("Owner token").fill("owner-token");
  await page.getByRole("button", { name: "Use this token" }).click();
  await expect(page.getByText("This tab is using an owner token.")).toBeVisible();
  await page.getByRole("button", { name: "Connect domain" }).click();
  await expect(page.getByRole("heading", { name: "1. Add these records at your registrar" })).toBeVisible();
  expect(fake.pages.current?.cname).toBe("parish.example");
});

test("gives the admin panel an address of its own on GitLab Pages", async ({ page }) => {
  const settings = JSON.parse(files()["content/site.json"] ?? "{}");
  const fake = fakeGitLab({
    project: "parish/site",
    files: {
      ...files(),
      "content/site.json": `${JSON.stringify({ ...settings, url: "https://parish.example" }, null, 2)}\n`,
      "goodfellow.config.tsx": "export default defineConfig({\n  blocks,\n});\n",
    },
    tokens: { "glpat-test": { username: "maria" } },
    pages: {},
  });
  await routeToFake(page, "https://gitlab.com/api", fake.handle);
  await fakeDns(page, "parish.example", {});

  await page.goto(`${GITLAB_SITE}/admin/#/settings/domain`);
  await page.getByText("Or sign in with an access token").click();
  await page.getByLabel("Access token").fill("glpat-test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const section = page.getByRole("region", { name: "Admin address" });
  await section.getByLabel("Admin address").fill("admin.parish.example");
  await section.getByRole("button", { name: "Give the admin panel this address" }).click();

  // GitLab serves the site there too, and the config names it, so the next build guards every page against it.
  await expect(section.locator(".gfa-records tbody tr").first()).toContainText("parish.gitlab.io");
  await expect(section.getByText("open the admin panel there")).toBeVisible();
  expect(fake.pages?.domains.has("admin.parish.example")).toBe(true);
  expect(fake.repo.files().get("goodfellow.config.tsx")).toBe(
    'export default defineConfig({\n  admin: { url: "https://admin.parish.example" },\n  blocks,\n});\n',
  );
  await expect(
    section.getByRole("link", { name: "Open the admin panel at https://admin.parish.example" }),
  ).toHaveAttribute("href", "https://admin.parish.example/admin/#/settings/domain");
});
