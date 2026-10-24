import type { Data } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import { shownSettings } from "./page-settings.js";

const page = (props: Record<string, unknown>): Data => ({ root: { props }, content: [] });

describe("shownSettings", () => {
  it("shows a page in search results where it hasn't chosen, and leaves that out of its file", () => {
    const original = page({ title: "About" });
    const settings = shownSettings(original, "/about");
    const shown = settings.show(original);
    expect(shown.root.props).toEqual({ title: "About", noIndex: false });
    expect(settings.keep(shown)).toEqual(original);
    expect(settings.keep({ ...shown, root: { props: { title: "About", noIndex: true } } }).root.props).toEqual({
      title: "About",
      noIndex: true,
    });
  });

  it("keeps a choice the page's file already has", () => {
    const original = page({ title: "About", noIndex: false });
    const settings = shownSettings(original, "/about");
    expect(settings.show(original)).toBe(original);
    expect(settings.keep(original)).toEqual(original);
  });

  it("shows Page not found as hidden from search results, with no choice, and keeps its file as it was", () => {
    const original = page({ title: "Page not found" });
    const settings = shownSettings(original, "/404");
    const shown = settings.show(original);
    expect(shown.root).toEqual({ props: { title: "Page not found", noIndex: true }, readOnly: { noIndex: true } });
    expect(settings.keep(shown)).toEqual(original);
  });

  it("shows templates in search results where they haven't chosen", () => {
    const original = page({ title: "{title}" });
    expect(shownSettings(original, undefined).show(original).root.props).toEqual({ title: "{title}", noIndex: false });
  });
});
