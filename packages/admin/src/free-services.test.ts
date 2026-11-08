import { siteSettingsSchema } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { FREE_SITE_SERVICES, freeServicesSetUp } from "./free-services.js";

describe("freeServicesSetUp", () => {
  it("says which free services the site's settings set up", () => {
    const settings = siteSettingsSchema.parse({ version: 1, title: "Parish" });
    expect(freeServicesSetUp(settings)).toEqual({ forms: false, comments: false, stats: false });
    expect(
      freeServicesSetUp({ ...settings, forms: { service: "web3forms", key: "abc" }, stats: { endpoint: "https://parish.goatcounter.com/count" } } as never),
    ).toEqual({ forms: true, comments: false, stats: true });
  });

  it("links each to where it's set up", () => {
    expect(FREE_SITE_SERVICES.map((service) => service.href)).toEqual([
      "#/settings/general?section=forms",
      "#/settings/comments",
      "#/settings/stats",
    ]);
  });
});
