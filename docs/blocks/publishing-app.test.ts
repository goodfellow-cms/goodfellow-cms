import { describe, expect, it } from "vitest";
import { appCodes, appReturnFor, appReturnOf, newAppState, setupLink, workersAddressIn } from "./publishing-app";

const STATE = "0123456789abcdef0123456789abcdef";

describe("the publishing app's return page", () => {
  it("reads the code for a made app, or an installation, with the setup page's state", () => {
    expect(appReturnOf(`?code=abc123&state=${STATE}`)).toEqual({ kind: "created", code: "abc123", state: STATE });
    expect(appReturnOf(`?installation_id=42&setup_action=install&state=${STATE}`)).toEqual({
      kind: "installed",
      installation: 42,
      state: STATE,
    });
    // Without the state, or with anything else.
    expect(appReturnOf("?code=abc123")).toBeUndefined();
    expect(appReturnOf(`?code=a%20b&state=${STATE}`)).toBeUndefined();
    expect(appReturnOf(`?installation_id=4x&state=${STATE}`)).toBeUndefined();
    expect(newAppState()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is heard only by the tab whose state it carries", () => {
    expect(appReturnFor({ kind: "created", code: "abc", state: STATE }, STATE)).toEqual({
      kind: "created",
      code: "abc",
      state: STATE,
    });
    expect(appReturnFor({ kind: "created", code: "abc", state: STATE }, "f".repeat(32))).toBeUndefined();
    expect(appReturnFor({ kind: "created", code: "<x>", state: STATE }, STATE)).toBeUndefined();
    expect(appReturnFor("created", STATE)).toBeUndefined();
  });
});

describe("the setup page's links", () => {
  it("finds the Worker's address once Set up Cloudflare has written it", () => {
    expect(workersAddressIn('"vars": { "GOODFELLOW_SITE_URL": "https://www.example.com" }')).toBeUndefined();
    expect(workersAddressIn('"vars": { "GOODFELLOW_SITE_URL": "https://acme.acme-co.workers.dev" }')).toBe(
      "https://acme.acme-co.workers.dev",
    );
  });

  it("puts the setup code where browsers never send it", () => {
    expect(setupLink("https://www.acme.example", "ABCD-EFGH")).toBe("https://www.acme.example/setup/#code=ABCD-EFGH");
  });
});

describe("the publishing app's codes", () => {
  it("turns only the first code since the app was asked for into the app, however soon the next comes", () => {
    const codes = appCodes();
    // None before it's asked for.
    expect(codes.take()).toBe(false);
    codes.asked();
    // Asked for again in another tab before either came back.
    codes.asked();
    expect(codes.take()).toBe(true);
    // The other tab's, while the first is still being made or just after, before the page has drawn it.
    expect(codes.take()).toBe(false);
    // Asked for once more, as after one that failed.
    codes.asked();
    expect(codes.take()).toBe(true);
  });
});
