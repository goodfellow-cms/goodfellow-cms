import { describe, expect, it } from "vitest";
import { signInReturn } from "./sign-in.js";

describe("signInReturn", () => {
  it("reads the grant from after the # and keeps the screen", () => {
    expect(signInReturn("https://parish.example/admin/#/settings/editors?goodfellow_sign_in=abc&tab=1")).toEqual({
      grant: "abc",
      cleaned: "https://parish.example/admin/#/settings/editors?tab=1",
    });
  });

  it("reads a grant with no screen", () => {
    expect(signInReturn("https://parish.example/admin/#?goodfellow_sign_in=abc")).toEqual({
      grant: "abc",
      cleaned: "https://parish.example/admin/",
    });
  });

  it("reads a problem from after the #", () => {
    expect(signInReturn("https://parish.example/admin/#/pages?goodfellow_sign_in_error=not-installed")).toEqual({
      failed: "not-installed",
      cleaned: "https://parish.example/admin/#/pages",
    });
  });

  it("still reads an older worker's query", () => {
    expect(signInReturn("https://parish.example/admin/?goodfellow_sign_in=abc#/settings")).toEqual({
      grant: "abc",
      cleaned: "https://parish.example/admin/#/settings",
    });
  });

  it("leaves an address without a sign-in alone", () => {
    expect(signInReturn("https://parish.example/new-site/create/?host=github#/x?y=1")).toEqual({
      cleaned: "https://parish.example/new-site/create/?host=github#/x?y=1",
    });
  });
});
