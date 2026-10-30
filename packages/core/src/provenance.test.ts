import { describe, expect, it } from "vitest";
import {
  type InstalledRelease,
  mayInstallEarly,
  normalizedRepository,
  provenanceAttestation,
  readProvenanceSource,
} from "./provenance.js";
import { fakePlugins } from "./themes-testing.js";

const source = {
  repository: "https://github.com/example/goodfellow-plugin-guestbook",
  workflow: ".github/workflows/release.yml",
};

describe("mayInstallEarly", () => {
  const installed: InstalledRelease = { release: "1.0.0", provenance: source };

  it("never lets a first install skip the wait", () => {
    expect(mayInstallEarly(undefined, { version: "1.0.1", provenance: source })).toEqual({
      early: false,
      reason: "not-installed",
    });
  });

  it("lets an update skip it only when both releases were built by the same repository and workflow", () => {
    expect(mayInstallEarly(installed, { version: "1.1.0", provenance: source })).toEqual({ early: true, source });
    // However the repository's address is spelled, and whatever the version says.
    expect(
      mayInstallEarly(installed, {
        version: "2.0.0",
        provenance: { ...source, repository: "git+https://github.com/Example/goodfellow-plugin-guestbook.git" },
      }),
    ).toEqual({ early: true, source });
  });

  it("says why it doesn't", () => {
    const reason = (release: Parameters<typeof mayInstallEarly>[1], before = installed) => {
      const decision = mayInstallEarly(before, release);
      return decision.early ? "early" : decision.reason;
    };
    expect(reason({ version: "1.0.1" })).toBe("no-provenance");
    expect(reason({ version: "1.0.1", provenance: source }, { release: "1.0.0" })).toBe("installed-no-provenance");
    expect(
      reason({ version: "1.0.1", provenance: { ...source, repository: "https://github.com/evil/guestbook" } }),
    ).toBe("other-repository");
    expect(reason({ version: "1.0.1", provenance: { ...source, workflow: ".github/workflows/other.yml" } })).toBe(
      "other-workflow",
    );
    expect(reason({ version: "1.0.0", provenance: source })).toBe("not-newer");
    expect(reason({ version: "0.9.0", provenance: source })).toBe("not-newer");
  });
});

describe("provenance", () => {
  const npm = fakePlugins({
    plugins: [
      {
        name: "goodfellow-plugin-guestbook",
        releases: [
          { version: "1.0.0", provenance: true, repository: source.repository, files: {} },
          { version: "1.0.1", files: {} },
        ],
      },
    ],
  });

  it("reads where a release says it was built, and nothing for one without provenance", async () => {
    expect(await readProvenanceSource("goodfellow-plugin-guestbook", "1.0.0", npm)).toEqual(source);
    expect(await readProvenanceSource("goodfellow-plugin-guestbook", "1.0.1", npm)).toBeUndefined();
    expect(provenanceAttestation({ attestations: [{ predicateType: "other" }] })).toBeUndefined();
    expect(provenanceAttestation(null)).toBeUndefined();
  });

  it("spells repositories one way", () => {
    expect(normalizedRepository("git+https://github.com/Example/Site.git/")).toBe("https://github.com/example/site");
  });
});
