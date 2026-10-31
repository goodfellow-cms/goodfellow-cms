import { describe, expect, it } from "vitest";
import file from "../../.github/sponsors.json";
import { anySponsors, cleanSponsors, sponsorsScript } from "./sponsors-data";

describe("cleanSponsors", () => {
  it("reads the repository's own file, which lists nobody yet", () => {
    expect(anySponsors(cleanSponsors(file))).toBe(false);
  });

  it("keeps only names, web addresses and https logos", () => {
    const list = cleanSponsors({
      version: 1,
      patrons: [
        { name: "Patron", url: "https://patron.example.org/", logo: "https://avatars.githubusercontent.com/u/1" },
        { name: "Insecure logo", url: "https://a.example/", logo: "http://a.example/logo.png" },
      ],
      organizations: [{ name: "Script", url: "javascript:alert(1)", logo: "https://a.example/logo.png" }],
      backers: [{ name: "  Backer  ", url: "http://backer.example/" }, { name: "", url: "https://b.example/" }, "nope"],
    });
    expect(list).toEqual({
      patrons: [
        { name: "Patron", url: "https://patron.example.org/", logo: "https://avatars.githubusercontent.com/u/1" },
      ],
      organizations: [],
      backers: [{ name: "Backer", url: "http://backer.example/" }],
    });
  });

  it("shows nobody from a file of another version", () => {
    expect(anySponsors(cleanSponsors({ version: 2, backers: [{ name: "A", url: "https://a.example/" }] }))).toBe(false);
  });
});

describe("sponsorsScript", () => {
  it("reads the list from master, with nothing that could end its script element", () => {
    const script = sponsorsScript();
    expect(script).toContain(
      "https://raw.githubusercontent.com/goodfellow-cms/goodfellow-cms/master/.github/sponsors.json",
    );
    expect(script).not.toMatch(/<\/script/i);
    expect(() => new Function(script)).not.toThrow();
  });
});
