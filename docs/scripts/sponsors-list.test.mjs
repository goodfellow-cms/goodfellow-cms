import { describe, expect, it } from "vitest";
import {
  emptySponsors,
  README_END,
  README_START,
  readmeSponsors,
  sponsorsFileText,
  sponsorsList,
  webAddress,
  withReadmeSponsors,
} from "./sponsors-list.mjs";

const NOW = Date.parse("2026-11-01T00:00:00Z");
const daysAgo = (days) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

const sponsor = (login, extra = {}) => ({
  login,
  name: `${login} name`,
  url: `https://github.com/${login}`,
  websiteUrl: `${login}.example.org`,
  avatarUrl: `https://avatars.githubusercontent.com/u/1?s=256&v=4&u=${login}`,
  ...extra,
});

const monthly = (login, dollars, extra = {}) => ({
  createdAt: daysAgo(30),
  isActive: true,
  isOneTimePayment: false,
  privacyLevel: "PUBLIC",
  tier: { monthlyPriceInDollars: dollars, isOneTime: false },
  sponsorEntity: sponsor(login),
  ...extra,
});

const oneTime = (login, dollars, days) => ({
  createdAt: daysAgo(days),
  tierSelectedAt: daysAgo(days),
  isActive: false,
  isOneTimePayment: true,
  privacyLevel: "PUBLIC",
  tier: { monthlyPriceInDollars: dollars, isOneTime: true },
  sponsorEntity: sponsor(login),
});

describe("sponsorsList", () => {
  it("lists each tier as agreed, and leaves out supporters", () => {
    const list = sponsorsList(
      [monthly("patron", 500), monthly("org", 100), monthly("backer", 25), monthly("supporter", 5)],
      NOW,
    );
    expect(list.patrons).toEqual([
      {
        login: "patron",
        name: "patron name",
        url: "https://patron.example.org/",
        logo: "https://avatars.githubusercontent.com/u/1?s=256&v=4&u=patron",
      },
    ]);
    expect(list.organizations.map((item) => item.login)).toEqual(["org"]);
    expect(list.backers).toEqual([{ login: "backer", name: "backer name", url: "https://backer.example.org/" }]);
  });

  it("lists a one-time gift of $50 or more by name for a year", () => {
    const list = sponsorsList([oneTime("recent", 50, 364), oneTime("old", 500, 366), oneTime("small", 49, 10)], NOW);
    expect(list.backers.map((item) => item.login)).toEqual(["recent"]);
    expect(list.patrons).toEqual([]);
  });

  it("leaves out private and ended sponsorships", () => {
    const list = sponsorsList(
      [monthly("private", 500, { privacyLevel: "PRIVATE" }), monthly("ended", 500, { isActive: false })],
      NOW,
    );
    expect(list).toEqual(emptySponsors());
  });

  it("lists each sponsor once, in their highest tier, those who've sponsored longest first", () => {
    const list = sponsorsList(
      [
        oneTime("both", 50, 10),
        monthly("both", 100, { createdAt: daysAgo(200) }),
        monthly("newer", 100, { createdAt: daysAgo(5) }),
      ],
      NOW,
    );
    expect(list.organizations.map((item) => item.login)).toEqual(["both", "newer"]);
    expect(list.backers).toEqual([]);
  });

  it("uses the GitHub profile without a website, and applies overrides", () => {
    const list = sponsorsList(
      [
        monthly("plain", 100, {
          createdAt: daysAgo(60),
          sponsorEntity: sponsor("plain", { websiteUrl: null, name: null }),
        }),
        monthly("custom", 100),
        monthly("hidden", 25),
      ],
      NOW,
      {
        custom: { name: "Custom Co.", url: "https://custom.example.com", logo: "https://custom.example.com/logo.png" },
        hidden: { hide: true },
      },
    );
    expect(list.organizations).toEqual([
      expect.objectContaining({ login: "plain", name: "plain", url: "https://github.com/plain" }),
      {
        login: "custom",
        name: "Custom Co.",
        url: "https://custom.example.com/",
        logo: "https://custom.example.com/logo.png",
      },
    ]);
    expect(list.backers).toEqual([]);
  });

  it("never lists a logo or a website that isn't a web address", () => {
    const list = sponsorsList(
      [
        monthly("script", 100, {
          sponsorEntity: sponsor("script", {
            websiteUrl: "javascript:alert(1)",
            avatarUrl: "https://elsewhere.example/a.png",
          }),
        }),
      ],
      NOW,
    );
    expect(list.organizations).toEqual([]);
    expect(webAddress("javascript:alert(1)")).toBeUndefined();
    expect(webAddress("example.org/page")).toBe("https://example.org/page");
  });
});

describe("the README's section", () => {
  const readme = `# Goodfellow\n\n${README_START}\n${README_END}\n\n## Contributing\n`;

  it("stays empty until someone is listed", () => {
    expect(readmeSponsors(emptySponsors())).toBe("");
    expect(withReadmeSponsors(readme, emptySponsors())).toBe(readme);
  });

  it("shows logos and names, escaped", () => {
    const list = sponsorsList(
      [
        monthly("patron", 500, { sponsorEntity: sponsor("patron", { name: 'Big "Patron" <Co>' }) }),
        monthly("backer", 25, { sponsorEntity: sponsor("backer", { name: "[Backer](x)" }) }),
      ],
      NOW,
    );
    const updated = withReadmeSponsors(readme, list);
    expect(updated).toContain('alt="Big &quot;Patron&quot; &lt;Co&gt;"');
    expect(updated).toContain('width="128" height="128"');
    expect(updated).toContain("s=256");
    expect(updated).toContain("[\\[Backer\\]\\(x\\)](<https://backer.example.org/>)");
    expect(withReadmeSponsors(updated, emptySponsors())).toBe(readme);
  });

  it("refuses a README without its marks", () => {
    expect(() => withReadmeSponsors("# Goodfellow\n", emptySponsors())).toThrow(/marks/);
  });
});

describe("the list's file", () => {
  it("starts as the repository has it, so it only changes with the list", () => {
    expect(sponsorsFileText(emptySponsors())).toBe(
      '{\n  "version": 1,\n  "patrons": [],\n  "organizations": [],\n  "backers": []\n}\n',
    );
  });
});
