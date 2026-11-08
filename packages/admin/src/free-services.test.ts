import { siteSettingsSchema } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { FREE_SITE_SERVICES, freeServicesSetUp } from "./free-services.js";

describe("freeServicesSetUp", () => {
  it("says which free services the site's settings set up", () => {
    const settings = siteSettingsSchema.parse({ version: 1, title: "Parish" });
    expect(freeServicesSetUp(settings)).toEqual({ forms: false, comments: false, stats: false });
    expect(
      freeServicesSetUp({
        ...settings,
        forms: { service: "web3forms", accessKey: "0b6e2c1a-4f3d-4a7e-9c2b-5d8f1e3a6b7c" },
        stats: { endpoint: "https://parish.goatcounter.com/count" },
      } as never),
    ).toEqual({ forms: true, comments: false, stats: true });
  });

  it("counts forms set up only once a form could send", () => {
    const settings = siteSettingsSchema.parse({ version: 1, title: "Parish" });
    for (const forms of [{ service: "web3forms" }, { service: "web3forms", accessKey: "my-email@example.org" }]) {
      expect(freeServicesSetUp({ ...settings, forms } as never).forms).toBe(false);
    }
  });

  it("links each to where it's set up", () => {
    expect(FREE_SITE_SERVICES.map((service) => service.href)).toEqual([
      "#/settings/general?section=forms",
      "#/settings/comments",
      "#/settings/stats",
    ]);
  });
});
