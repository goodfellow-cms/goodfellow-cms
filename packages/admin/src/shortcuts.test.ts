import type { SiteContent } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import {
  findPlaces,
  type GoToPlace,
  goToPlaces,
  isForwardedShortcut,
  isTyping,
  type KeyPress,
  onShortcut,
  runShortcut,
  shortcutFor,
  usesCommandKey,
} from "./shortcuts.js";

const press = (key: string, keys: Partial<KeyPress> = {}): KeyPress => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...keys,
});

describe("shortcutFor", () => {
  it("adds to a draft and opens the Go to box with Ctrl or ⌘, even while typing", () => {
    for (const typing of [false, true]) {
      expect(shortcutFor(press("s", { ctrlKey: true }), typing)).toBe("save");
      expect(shortcutFor(press("S", { metaKey: true }), typing)).toBe("save");
      expect(shortcutFor(press("k", { ctrlKey: true }), typing)).toBe("goTo");
    }
    // Ctrl+Alt is another character on some keyboards, and Shift another command.
    expect(shortcutFor(press("s", { ctrlKey: true, altKey: true }), false)).toBeUndefined();
    expect(shortcutFor(press("s", { ctrlKey: true, shiftKey: true }), false)).toBeUndefined();
    expect(shortcutFor(press("s"), false)).toBeUndefined();
  });

  it("undoes, redoes and lists the shortcuts only outside text fields", () => {
    expect(shortcutFor(press("z", { ctrlKey: true }), false)).toBe("undo");
    expect(shortcutFor(press("Z", { metaKey: true, shiftKey: true }), false)).toBe("redo");
    expect(shortcutFor(press("y", { ctrlKey: true }), false)).toBe("redo");
    expect(shortcutFor(press("?", { shiftKey: true }), false)).toBe("help");
    expect(shortcutFor(press("z", { ctrlKey: true }), true)).toBeUndefined();
    expect(shortcutFor(press("y", { ctrlKey: true }), true)).toBeUndefined();
    expect(shortcutFor(press("?", { shiftKey: true }), true)).toBeUndefined();
    expect(shortcutFor(press("?", { ctrlKey: true }), false)).toBeUndefined();
  });

  it("lets frames pass on only adding to a draft, the Go to box and the list", () => {
    expect(["save", "goTo", "help"].every(isForwardedShortcut)).toBe(true);
    expect(isForwardedShortcut("undo")).toBe(false);
    expect(isForwardedShortcut("navigate")).toBe(false);
    expect(isForwardedShortcut({ toString: () => "save" })).toBe(false);
  });

  it("runs shortcuts frames pass on until told to stop", () => {
    const ran: string[] = [];
    const stop = onShortcut((shortcut) => ran.push(shortcut));
    runShortcut("save");
    stop();
    runShortcut("goTo");
    expect(ran).toEqual(["save"]);
  });

  it("tells text fields from other controls", () => {
    const element = (tagName: string, extra: object = {}) => ({ tagName, isContentEditable: false, ...extra }) as never;
    expect(isTyping(element("TEXTAREA"))).toBe(true);
    expect(isTyping(element("INPUT", { type: "text" }))).toBe(true);
    expect(isTyping(element("INPUT", { type: "search" }))).toBe(true);
    expect(isTyping(element("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isTyping(element("DIV", { isContentEditable: true }))).toBe(true);
    expect(isTyping(element("BUTTON"))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });

  it("names ⌘ on Apple's computers", () => {
    expect(usesCommandKey("MacIntel")).toBe(true);
    expect(usesCommandKey("macOS")).toBe(true);
    expect(usesCommandKey("iPad")).toBe(true);
    expect(usesCommandKey("Win32")).toBe(false);
    expect(usesCommandKey("Linux x86_64")).toBe(false);
  });
});

describe("the Go to box", () => {
  const content = {
    pages: [
      { path: "/", content: { data: { root: { props: { title: "Home" } } } } },
      { path: "/about", content: { data: { root: { props: { title: "About us" } } } } },
      { path: "/mass-times", content: { data: { root: { props: {} } } } },
    ],
    collections: [
      {
        id: "news",
        settings: { name: "News" },
        entries: [{ collection: "news", slug: "fete", content: { fields: { title: "Parish fête" } } }],
      },
    ],
    syncedBlocks: [{ name: "mass-times", content: { title: "Mass times" } }],
  } as unknown as SiteContent;
  const screens: GoToPlace[] = [{ kind: "screen", label: "Media", href: "#/media" }];
  const places = goToPlaces(content, screens);

  it("lists the screens, then pages, collections, items and synced blocks", () => {
    expect(places.map((place) => [place.kind, place.label, place.href])).toEqual([
      ["screen", "Media", "#/media"],
      ["page", "Home", "#/pages/edit?path=%2F"],
      ["page", "About us", "#/pages/edit?path=%2Fabout"],
      ["page", "/mass-times", "#/pages/edit?path=%2Fmass-times"],
      ["collection", "News", "#/collections/news"],
      ["item", "Parish fête", "#/collections/news/edit?slug=fete"],
      ["synced", "Mass times", "#/synced-blocks/edit?name=mass-times"],
    ]);
  });

  it("finds places by every word typed, without case or accents, names that start with it first", () => {
    expect(findPlaces(places, "")).toEqual(places);
    expect(findPlaces(places, "fete").map((place) => place.label)).toEqual(["Parish fête"]);
    expect(findPlaces(places, "NEWS").map((place) => place.label)).toEqual(["News", "Parish fête"]);
    expect(findPlaces(places, "mass").map((place) => place.label)).toEqual(["Mass times", "/mass-times"]);
    expect(findPlaces(places, "us about").map((place) => place.label)).toEqual(["About us"]);
    expect(findPlaces(places, "nothing")).toEqual([]);
    expect(findPlaces(places, "", 2)).toHaveLength(2);
  });
});
