import { describe, expect, it } from "vitest";
import { headElementHtml } from "./content/code.js";
import { consentKinds, consentSchema, siteSettingsSchema } from "./content/schemas.js";
import {
  GOATCOUNTER_SCRIPT,
  heldStats,
  PLAUSIBLE_SCRIPT,
  readStatsCode,
  type StatsSettings,
  statsAddress,
  statsDashboard,
  statsElements,
  UMAMI_SCRIPT,
} from "./stats.js";

const WEBSITE = "94db1cb1-74f4-4a40-ad6c-962362670409";
const html = (stats: StatsSettings) => statsElements(stats).map(headElementHtml).join("");

describe("readStatsCode", () => {
  it("reads each service's embed code", () => {
    expect(
      readStatsCode(
        "plausible",
        '<script defer data-domain="example.org" src="https://plausible.io/js/script.js"></script>',
      ),
    ).toEqual({ service: "plausible", domain: "example.org", script: PLAUSIBLE_SCRIPT });
    expect(
      readStatsCode(
        "umami",
        `<script defer src="https://cloud.umami.is/script.js" data-website-id="${WEBSITE}"></script>`,
      ),
    ).toEqual({ service: "umami", website: WEBSITE, script: UMAMI_SCRIPT });
    expect(
      readStatsCode(
        "goatcounter",
        '<script data-goatcounter="https://parish.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>',
      ),
    ).toEqual({ service: "goatcounter", endpoint: "https://parish.goatcounter.com/count" });
  });

  it("reads Plausible's site scripts, which leave the domain to be asked for", () => {
    const code = `<script async src="https://plausible.io/js/pa-AbC123.js"></script>
<script>window.plausible=window.plausible||function(){};plausible.init()</script>`;
    expect(readStatsCode("plausible", code)).toEqual({
      service: "plausible",
      domain: "",
      script: "https://plausible.io/js/pa-AbC123.js",
    });
  });

  it("takes the plain values each service names a site by", () => {
    expect(readStatsCode("plausible", "https://example.org/")).toMatchObject({ domain: "example.org" });
    expect(readStatsCode("umami", WEBSITE.toUpperCase())).toMatchObject({ website: WEBSITE });
    expect(readStatsCode("goatcounter", "parish")).toEqual({
      service: "goatcounter",
      endpoint: "https://parish.goatcounter.com/count",
    });
    expect(readStatsCode("goatcounter", "stats.example.org")).toEqual({
      service: "goatcounter",
      endpoint: "https://stats.example.org/count",
    });
  });

  it("reads nothing it can't use", () => {
    expect(readStatsCode("umami", "not an id")).toBeUndefined();
    expect(
      readStatsCode("umami", `<script src="http://127.0.0.1/script.js" data-website-id="${WEBSITE}"></script>`),
    ).toBeUndefined();
    expect(
      readStatsCode("goatcounter", '<script data-goatcounter="javascript:alert(1)" src="x"></script>'),
    ).toBeUndefined();
  });
});

describe("statsElements", () => {
  it("writes each service's script, loading without holding the page up", () => {
    expect(html({ service: "plausible", domain: "example.org", script: PLAUSIBLE_SCRIPT })).toBe(
      '<script async data-domain="example.org" src="https://plausible.io/js/script.js"></script>',
    );
    expect(html({ service: "umami", website: WEBSITE, script: UMAMI_SCRIPT })).toBe(
      `<script async data-website-id="${WEBSITE}" src="https://cloud.umami.is/script.js"></script>`,
    );
    expect(html({ service: "goatcounter", endpoint: "https://parish.goatcounter.com/count" })).toBe(
      `<script async data-goatcounter="https://parish.goatcounter.com/count" src="${GOATCOUNTER_SCRIPT}"></script>`,
    );
  });

  it("starts Plausible's site scripts as Plausible does", () => {
    const elements = statsElements({
      service: "plausible",
      domain: "example.org",
      script: "https://plausible.io/js/pa-x.js",
    });
    expect(elements).toHaveLength(2);
    expect(elements[1]?.content).toContain("plausible.init()");
  });

  it("writes nothing for settings it can't use", () => {
    expect(statsElements(undefined)).toEqual([]);
    expect(statsElements({ service: "plausible", domain: "", script: PLAUSIBLE_SCRIPT })).toEqual([]);
    expect(statsElements({ service: "umami", website: WEBSITE, script: "http://stats.example.org/s.js" })).toEqual([]);
    expect(statsElements({ service: "goatcounter", endpoint: "https://localhost/count" })).toEqual([]);
  });
});

describe("statsDashboard", () => {
  it("links to each service's dashboard, on its servers or the site's own", () => {
    expect(statsDashboard({ service: "plausible", domain: "example.org", script: PLAUSIBLE_SCRIPT })).toBe(
      "https://plausible.io/example.org",
    );
    expect(
      statsDashboard({ service: "plausible", domain: "example.org", script: "https://stats.example.org/js/script.js" }),
    ).toBe("https://stats.example.org/example.org");
    expect(statsDashboard({ service: "umami", website: WEBSITE, script: UMAMI_SCRIPT })).toBe(
      `https://cloud.umami.is/websites/${WEBSITE}`,
    );
    expect(statsDashboard({ service: "umami", website: WEBSITE, script: "https://umami.example.org/s.js" })).toBe(
      `https://umami.example.org/websites/${WEBSITE}`,
    );
    expect(statsDashboard({ service: "goatcounter", endpoint: "https://parish.goatcounter.com/count" })).toBe(
      "https://parish.goatcounter.com/",
    );
  });
});

describe("consent", () => {
  const consent = consentSchema.parse({});
  const stats: StatsSettings = { service: "goatcounter", endpoint: "https://parish.goatcounter.com/count" };

  it("waits for visitors to allow statistics on a site that asks, unless the site says it needn't", () => {
    expect(heldStats(undefined, stats)).toBe(false);
    expect(heldStats(consent, stats)).toBe("statistics");
    expect(heldStats(consent, { ...stats, purpose: "needed" })).toBe(false);
    expect(consentKinds(consent)).toEqual(["content"]);
    expect(consentKinds(consent, stats)).toEqual(["content", "statistics"]);
    expect(consentKinds(consent, { ...stats, purpose: "needed" })).toEqual(["content"]);
  });
});

describe("the setting", () => {
  it("takes usable settings and refuses others", () => {
    const parse = (stats: unknown) => siteSettingsSchema.safeParse({ version: 1, stats }).success;
    expect(parse({ service: "umami", website: WEBSITE, script: UMAMI_SCRIPT })).toBe(true);
    expect(parse({ service: "plausible", domain: "example.org", script: PLAUSIBLE_SCRIPT, purpose: "needed" })).toBe(
      true,
    );
    expect(parse({ service: "plausible", domain: "", script: PLAUSIBLE_SCRIPT })).toBe(false);
    expect(parse({ service: "goatcounter", endpoint: "http://parish.goatcounter.com/count" })).toBe(false);
    expect(parse({ service: "matomo", endpoint: "https://example.org" })).toBe(false);
    expect(statsAddress("//gc.zgo.at/count.js")).toBe(GOATCOUNTER_SCRIPT);
  });
});
