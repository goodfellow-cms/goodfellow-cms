import { DomainError } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { github } from "./index.js";
import { fakeGitHub } from "./testing.js";

async function signIn(options: Partial<Parameters<typeof fakeGitHub>[0]> = {}) {
  const fake = fakeGitHub({ repo: "Someone/parish", pages: true, ...options });
  const backend = await github({ repo: "Someone/parish", fetch: fake.fetch }).signInWithToken("test-token", false);
  if (!backend.pages) throw new Error("no pages");
  return { fake, pages: backend.pages };
}

describe("GitHub Pages domains", () => {
  it("says where Pages publishes the site, and nothing when it doesn't", async () => {
    const { pages } = await signIn();
    expect(await pages.site()).toEqual({ url: "https://someone.github.io/parish/", domain: undefined });
    const { pages: elsewhere } = await signIn({ pages: false });
    expect(await elsewhere.site()).toBeUndefined();
  });

  it("connects an apex domain with GitHub's addresses, and www. as an alias", async () => {
    const { fake, pages } = await signIn();
    const records = await pages.connect("example.org", { apex: true, www: true });
    expect(fake.pages.current?.cname).toBe("example.org");
    expect(records.filter((record) => record.type === "A").map((record) => record.value)).toEqual([
      "185.199.108.153",
      "185.199.109.153",
      "185.199.110.153",
      "185.199.111.153",
    ]);
    expect(records.filter((record) => record.type === "AAAA").every((record) => record.optional)).toBe(true);
    expect(records.at(-1)).toEqual({
      type: "CNAME",
      name: "www.example.org",
      value: "someone.github.io",
      purpose: "www",
      optional: true,
    });
    expect(await pages.site()).toEqual({ url: "https://example.org/", domain: "example.org" });
  });

  it("connects a subdomain as an alias of the owner's github.io", async () => {
    const { pages } = await signIn();
    expect(await pages.connect("www.example.org", { apex: false })).toEqual([
      { type: "CNAME", name: "www.example.org", value: "someone.github.io", purpose: "site" },
    ]);
  });

  it("requires HTTPS once the certificate is ready, and not before", async () => {
    const { fake, pages } = await signIn();
    await pages.connect("example.org", { apex: true });
    expect(await pages.status("example.org")).toEqual({
      verified: true,
      certificate: "pending",
      httpsOnly: false,
      primary: true,
    });
    await expect(pages.secure("example.org")).rejects.toMatchObject({ problem: "not-ready" });
    if (fake.pages.current) fake.pages.current.certificate = "approved";
    await pages.secure("example.org");
    expect(await pages.status("example.org")).toEqual({
      verified: true,
      certificate: "ready",
      httpsOnly: true,
      primary: true,
    });
    await pages.disconnect("example.org");
    expect(await pages.site()).toEqual({ url: "https://someone.github.io/parish/", domain: undefined });
  });

  it("secures and removes only the domain it's told, which is the one GitHub has", async () => {
    const { fake, pages } = await signIn();
    await pages.connect("b.example.org", { apex: false });
    if (fake.pages.current) fake.pages.current.certificate = "approved";
    // Approved for a.example.org, while the site's domain has become b.example.org meanwhile.
    await expect(pages.secure("a.example.org")).rejects.toMatchObject({ problem: "changed" });
    await expect(pages.disconnect("a.example.org")).rejects.toMatchObject({ problem: "changed" });
    expect(await pages.status("b.example.org")).toMatchObject({ httpsOnly: false });
    expect((await pages.site())?.domain).toBe("b.example.org");
  });

  it("says when the sign-in can't change Pages, or the domain is taken", async () => {
    const { pages } = await signIn({ tokens: { "test-token": { login: "editor", pages: false } } });
    await expect(pages.connect("example.org", { apex: true })).rejects.toMatchObject({ problem: "not-allowed" });
    const { pages: taken } = await signIn({ takenDomains: ["example.org"] });
    await expect(taken.connect("example.org", { apex: true })).rejects.toBeInstanceOf(DomainError);
    await expect(taken.connect("example.org", { apex: true })).rejects.toMatchObject({ problem: "taken" });
  });
});
