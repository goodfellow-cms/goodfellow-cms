import { describe, expect, it } from "vitest";
import { adminRoute } from "./route.js";

describe("adminRoute", () => {
  it("keeps the admin panel's screen, without what a sign-in brought back", () => {
    expect(adminRoute("#/pages")).toBe("#/pages");
    expect(adminRoute("#/settings/general?section=forms")).toBe("#/settings/general?section=forms");
    expect(adminRoute("#/settings/editors?goodfellow_sign_in=sealed&tab=1")).toBe("#/settings/editors?tab=1");
    expect(adminRoute("#/settings/editors?goodfellow_sign_in_error=cancelled")).toBe("#/settings/editors");
    expect(adminRoute("#/x?code=abc&state=def")).toBe("#/x");
  });

  it("names no screen for anything else, such as Bitbucket's token", () => {
    expect(adminRoute("#access_token=secret&state=x")).toBeUndefined();
    expect(adminRoute("")).toBeUndefined();
    expect(adminRoute("#top")).toBeUndefined();
  });
});
