import { describe, expect, it } from "vitest";
import { gitlab } from "./index.js";
import { fakeGitLab } from "./testing.js";

async function signIn(options: Partial<Parameters<typeof fakeGitLab>[0]> = {}) {
  const fake = fakeGitLab({ project: "st-joseph/website", pages: {}, ...options });
  const backend = await gitlab({ project: "st-joseph/website", fetch: fake.fetch }).signInWithToken(
    "test-token",
    false,
  );
  if (!backend.pages) throw new Error("no pages");
  return { fake, pages: backend.pages };
}

describe("GitLab Pages domains", () => {
  it("says where Pages publishes the site, and nothing when it doesn't", async () => {
    const { pages } = await signIn();
    expect(await pages.site()).toEqual({ url: "https://website-1a2b3c.gitlab.io", domain: undefined });
    const { pages: elsewhere } = await signIn({ pages: undefined });
    expect(await elsewhere.site()).toBeUndefined();
  });

  it("adds an apex domain and www., with GitLab's address and a verification record for each", async () => {
    const { fake, pages } = await signIn({ pages: { uniqueDomain: false } });
    const records = await pages.connect("example.org", { apex: true, www: true });
    // Served from the root, as the custom domain will be, so the build's base path is right for both.
    expect(fake.pages?.uniqueDomain).toBe(true);
    expect(records).toEqual([
      { type: "A", name: "example.org", value: "35.185.44.232", purpose: "site" },
      { type: "AAAA", name: "example.org", value: "2600:1901:0:7b8a::", purpose: "site", optional: true },
      { type: "CNAME", name: "www.example.org", value: "st-joseph.gitlab.io", purpose: "www", optional: true },
      {
        type: "TXT",
        name: "_gitlab-pages-verification-code.example.org",
        value: expect.stringMatching(/^gitlab-pages-verification-code=code-/),
        purpose: "verification",
        optional: false,
      },
      {
        type: "TXT",
        name: "_gitlab-pages-verification-code.www.example.org",
        value: expect.stringMatching(/^gitlab-pages-verification-code=code-/),
        purpose: "verification",
        optional: true,
      },
    ]);
    expect(await pages.records("example.org", { apex: true, www: true })).toEqual(records);
    expect(await pages.site()).toMatchObject({ domain: "example.org" });
  });

  it("verifies the domain once its record is in place, then requires HTTPS and makes it the primary domain", async () => {
    const { fake, pages } = await signIn();
    await pages.connect("example.org", { apex: true });
    expect(await pages.status("example.org")).toEqual({
      verified: false,
      certificate: "pending",
      httpsOnly: true,
      primary: false,
    });
    await expect(pages.secure("example.org")).rejects.toMatchObject({ problem: "not-ready" });
    fake.pages?.dnsReady.add("example.org");
    expect((await pages.status("example.org")).verified).toBe(true);
    const domain = fake.pages?.domains.get("example.org");
    if (domain) domain.certificate = true;
    expect(await pages.status("example.org")).toEqual({
      verified: true,
      certificate: "ready",
      httpsOnly: true,
      primary: false,
    });
    await pages.secure("example.org");
    expect(fake.pages?.primaryDomain).toBe("example.org");
    await pages.disconnect("example.org");
    expect(await pages.site()).toMatchObject({ domain: undefined });
  });

  it("serves the site on a second domain, an admin address, without making it the primary one", async () => {
    const { fake, pages } = await signIn();
    expect(pages.severalDomains).toBe(true);
    await pages.connect("example.org", { apex: true });
    await pages.connect("admin.example.org", { apex: false });
    for (const name of ["example.org", "admin.example.org"]) {
      fake.pages?.dnsReady.add(name);
      await pages.status(name);
      const domain = fake.pages?.domains.get(name);
      if (domain) domain.certificate = true;
    }
    await pages.secure("example.org");
    await pages.secure("admin.example.org", { primary: false });
    expect(fake.pages?.primaryDomain).toBe("example.org");
    expect(await pages.site()).toMatchObject({ domain: "example.org" });
    expect((await pages.status("admin.example.org")).primary).toBe(false);
  });

  it("says that connecting a domain needs the Maintainer role", async () => {
    const { pages } = await signIn({ tokens: { "test-token": { username: "dev", accessLevel: 30 } } });
    await expect(pages.connect("example.org", { apex: true })).rejects.toMatchObject({ problem: "not-allowed" });
  });
});
