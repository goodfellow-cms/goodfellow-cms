import type { Config, Data } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import { shownSettings, withoutVisibility } from "./page-settings.js";

const page = (props: Record<string, unknown>): Data => ({ root: { props }, content: [] });
const DEFAULTS = {
  noIndex: false,
  noSearch: false,
  visibility: "everyone",
  noFollow: false,
  noSnippet: false,
  card: "auto",
};

describe("shownSettings", () => {
  it("shows a page in search results where it hasn't chosen, and leaves that out of its file", () => {
    const original = page({ title: "About" });
    const settings = shownSettings(original, "/about");
    const shown = settings.show(original);
    expect(shown.root.props).toEqual({ title: "About", ...DEFAULTS });
    expect(settings.keep(shown)).toEqual(original);
    expect(settings.keep(page({ title: "About", ...DEFAULTS, noIndex: true, card: "small" })).root.props).toEqual({
      title: "About",
      noIndex: true,
      card: "small",
    });
  });

  it("keeps a choice the page's file already has", () => {
    const original = page({ title: "About", ...DEFAULTS });
    const settings = shownSettings(original, "/about");
    expect(settings.show(original)).toBe(original);
    expect(settings.keep(original)).toEqual(original);
  });

  it("shows Page not found as hidden from search results and the site's search, with no choice, and keeps its file as it was", () => {
    const original = page({ title: "Page not found" });
    const settings = shownSettings(original, "/404");
    const shown = settings.show(original);
    expect(shown.root).toEqual({
      props: { title: "Page not found", ...DEFAULTS, noIndex: true, noSearch: true },
      readOnly: { noIndex: true, noSearch: true },
    });
    expect(settings.keep(shown)).toEqual(original);
    // Whatever the editor's frame hands back for them, its file keeps what it said.
    const changed = {
      ...shown,
      root: { ...shown.root, props: { ...shown.root.props, noIndex: false, noSearch: false } },
    };
    expect(settings.keep(changed)).toEqual(original);
  });

  it("shows templates in search results where they haven't chosen", () => {
    const original = page({ title: "{title}" });
    expect(shownSettings(original, undefined).show(original).root.props).toEqual({ title: "{title}", ...DEFAULTS });
  });
});

describe("withoutVisibility", () => {
  it('leaves "Who can see this page" out where the site has no server to keep pages to members', () => {
    const config: Config = {
      components: {},
      root: { fields: { title: { type: "text" }, visibility: { type: "radio", options: [] } } },
    };
    expect(Object.keys(withoutVisibility(config).root?.fields ?? {})).toEqual(["title"]);
    // Configs without it, such as the header's and footer's, are left as they are.
    const layout: Config = { components: {} };
    expect(withoutVisibility(layout)).toBe(layout);
  });
});
