import { type HTMLElement, type HTMLInputElement, type HTMLSelectElement, Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_ATTRIBUTE,
  ANNOUNCEMENT_CLOSE_ATTRIBUTE,
  ANNOUNCEMENT_STORAGE_KEY,
  announcementHideScript,
  announcementScript,
  BLOCK_SCRIPTS,
  blockScriptsFor,
  COPY_ATTRIBUTE,
  copyScript,
  DARK_MODE_ATTRIBUTE,
  darkModeScript,
  LIGHTBOX_ATTRIBUTE,
  LIGHTBOX_DIALOG_ATTRIBUTE,
  LIGHTBOX_ITEM_ATTRIBUTE,
  lightboxScript,
  SEARCH_BOX_ATTRIBUTE,
  searchScript,
} from "./block-scripts.js";
import { COLOR_SCHEME_ATTRIBUTE, COLOR_SCHEME_STORAGE_KEY } from "./color-scheme.js";

let window: Window | undefined;
afterEach(async () => {
  await window?.happyDOM.close();
  window = undefined;
});

/** A page with `body`, and `scripts` run in it, as a built page runs them at the end of its body. */
function open(body: string, scripts: string[]) {
  window = new Window({
    url: "https://example.org/",
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
      disableJavaScriptFileLoading: true,
    },
  });
  window.document.write(`<!DOCTYPE html><html><head></head><body>${body}</body></html>`);
  for (const script of scripts) window.eval(script);
  const document = window.document;
  const find = <T = HTMLElement>(selector: string) => document.querySelector(selector) as unknown as T;
  return { window, document, find };
}

const tick = () => new Promise((done) => setTimeout(done, 0));

describe("the built-in blocks' scripts", () => {
  it("are added only to pages with their blocks, each once", () => {
    expect(blockScriptsFor("<main><p>Nothing to run</p></main>")).toEqual([]);
    expect(blockScriptsFor(`<button ${COPY_ATTRIBUTE}="">Copy</button>`)).toEqual([copyScript()]);
    expect(
      blockScriptsFor(`<button ${DARK_MODE_ATTRIBUTE}="switch"></button><search ${SEARCH_BOX_ATTRIBUTE}=""></search>`),
    ).toEqual([darkModeScript(), searchScript()]);
    // Text about an attribute, as in the docs, isn't one.
    expect(blockScriptsFor(`<code>${COPY_ATTRIBUTE}</code>`)).toEqual([]);
  });

  it("are scripts browsers can run, with no `</script>` to end them early", () => {
    for (const { script } of [...BLOCK_SCRIPTS, { script: announcementHideScript }]) {
      expect(() => new Function(script())).not.toThrow();
      expect(script()).not.toMatch(/<\/script/i);
    }
  });

  it("copy a code block's text, and show they did for a moment", async () => {
    const { window, find } = open(
      `<figure><div><pre><code><span>npm create</span>\n<span>goodfellow</span></code></pre></div><button type="button" ${COPY_ATTRIBUTE}=""><svg></svg></button></figure>`,
      [copyScript(), copyScript()],
    );
    let copied: string[] = [];
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText: async (text: string) => void copied.push(text) },
    });
    find("button").click();
    await tick();
    // Once, though the page ran the script twice.
    expect(copied).toEqual(["npm create\ngoodfellow"]);
    expect(find("button").hasAttribute("data-gf-copied")).toBe(true);
    copied = [];
    find("svg").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await tick();
    expect(copied).toEqual(["npm create\ngoodfellow"]);
  });

  it("make the Dark mode switch work, keeping the choice for other pages", () => {
    const { window, document, find } = open(
      `<button type="button" role="switch" aria-checked="false" disabled ${DARK_MODE_ATTRIBUTE}="switch"></button>
<select disabled ${DARK_MODE_ATTRIBUTE}="menu"><option value="light">Light</option><option value="dark">Dark</option><option value="system" selected>Follow</option></select>`,
      [darkModeScript()],
    );
    const toggle = find("button");
    const menu = find<HTMLSelectElement>("select");
    // Working once the script runs, and ready for a menu to show.
    expect(toggle.hasAttribute("disabled")).toBe(false);
    expect(menu.disabled).toBe(false);
    expect(menu.hasAttribute("data-gf-ready")).toBe(true);

    toggle.click();
    expect(document.documentElement.getAttribute(COLOR_SCHEME_ATTRIBUTE)).toBe("dark");
    expect(window.localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)).toBe("dark");
  });

  it("show what's chosen elsewhere on every switch, and follow the computer again from the menu", async () => {
    const { window, document, find } = open(
      `<button type="button" role="switch" aria-checked="false" disabled ${DARK_MODE_ATTRIBUTE}="switch"></button>
<select disabled ${DARK_MODE_ATTRIBUTE}="menu"><option value="light">Light</option><option value="dark">Dark</option><option value="system" selected>Follow</option></select>`,
      [darkModeScript()],
    );
    document.documentElement.setAttribute(COLOR_SCHEME_ATTRIBUTE, "dark");
    await tick();
    expect(find("button").getAttribute("aria-checked")).toBe("true");
    expect(find<HTMLSelectElement>("select").value).toBe("dark");

    const menu = find<HTMLSelectElement>("select");
    menu.value = "system";
    menu.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(document.documentElement.hasAttribute(COLOR_SCHEME_ATTRIBUTE)).toBe(false);
    expect(window.localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)).toBeNull();

    // A switch a navigation adds shows what's shown too.
    document.documentElement.setAttribute(COLOR_SCHEME_ATTRIBUTE, "dark");
    document.body.insertAdjacentHTML(
      "beforeend",
      `<button id="later" type="button" role="switch" aria-checked="false" disabled ${DARK_MODE_ATTRIBUTE}="switch"></button>`,
    );
    await tick();
    expect(find("#later").getAttribute("aria-checked")).toBe("true");
  });

  it("show the Search box's results only while it's in use, saying so where search isn't available", async () => {
    const { window, document, find } = open(
      `<search ${SEARCH_BOX_ATTRIBUTE}="" data-gf-base="/" data-gf-no-results="Nothing matches “{query}”." data-gf-unavailable="Search works on the published site.">
<input type="search"><div hidden data-gf-search-results=""><p hidden data-gf-search-message=""></p><ul data-gf-search-list=""></ul></div></search>`,
      [searchScript()],
    );
    const input = find<HTMLInputElement>("input");
    const results = find("[data-gf-search-results]");
    input.value = "pagefind";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(results.hidden).toBe(false);
    // The site isn't built here, so Pagefind can't load.
    await expect.poll(() => find("[data-gf-search-message]").textContent).toBe("Search works on the published site.");

    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    expect(results.hidden).toBe(true);
    input.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true }));
    expect(results.hidden).toBe(false);
    document.body.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
    expect(results.hidden).toBe(true);

    input.value = "  ";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(results.hidden).toBe(true);
  });

  it("open a Gallery's pictures larger, move between them and give the focus back when closed", () => {
    const item = (src: string, alt: string, caption?: string) =>
      `<li><figure><a href="${src}" ${LIGHTBOX_ITEM_ATTRIBUTE}=""><img src="${src}" alt="${alt}"></a>${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure></li>`;
    const { window, document, find } = open(
      `<figure ${LIGHTBOX_ATTRIBUTE}=""><ul>${item("/media/a.jpg", "The church", "Our church")}${item("/media/b.jpg", "The hall")}</ul>
      <dialog ${LIGHTBOX_DIALOG_ATTRIBUTE}=""><button data-gf-lightbox-previous="">Previous</button><figure><img alt="" aria-hidden="true" data-gf-lightbox-image=""><figcaption data-gf-lightbox-caption=""></figcaption></figure><button data-gf-lightbox-next="">Next</button><button data-gf-lightbox-close="">Close</button></dialog></figure>`,
      [lightboxScript(), lightboxScript()],
    );
    const links = document.querySelectorAll(`[${LIGHTBOX_ITEM_ATTRIBUTE}]`) as unknown as HTMLElement[];
    const dialog = find<HTMLElement & { open: boolean }>("dialog");
    const image = find<HTMLElement & { src: string; alt: string }>("[data-gf-lightbox-image]");
    const caption = find("[data-gf-lightbox-caption]");
    links[0]?.click();
    expect(dialog.open).toBe(true);
    expect(image.src).toBe("https://example.org/media/a.jpg");
    expect(image.alt).toBe("The church");
    expect(image.hasAttribute("aria-hidden")).toBe(false);
    expect(caption.textContent).toBe("Our church");
    expect(dialog.getAttribute("aria-label")).toBe("The church");
    find("[data-gf-lightbox-next]").click();
    expect(image.alt).toBe("The hall");
    expect(caption.hidden).toBe(true);
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(image.alt).toBe("The church");
    find("[data-gf-lightbox-close]").click();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(links[0]);
    // A click with a key held, to open the file elsewhere, is the browser's.
    links[1]?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    expect(dialog.open).toBe(false);
  });

  it("close an Announcement bar and keep it closed on the next page, until its message changes", async () => {
    const bar = (hash: string) =>
      `<section ${ANNOUNCEMENT_ATTRIBUTE}="${hash}"><p>News</p><button ${ANNOUNCEMENT_CLOSE_ATTRIBUTE}="">×</button></section>`;
    const first = open(bar("abc123"), [announcementScript()]);
    first.find(`[${ANNOUNCEMENT_CLOSE_ATTRIBUTE}]`).click();
    expect(first.find(`[${ANNOUNCEMENT_ATTRIBUTE}]`).hidden).toBe(true);
    expect(JSON.parse(first.window.localStorage.getItem(ANNOUNCEMENT_STORAGE_KEY) ?? "")).toEqual(["abc123"]);

    await first.window.happyDOM.close();
    const next = open("", []);
    // Only hashes are read back, so the page's storage can't add anything else to the page.
    next.window.localStorage.setItem(ANNOUNCEMENT_STORAGE_KEY, JSON.stringify(["abc123", "x}body{display:none"]));
    next.window.eval(announcementHideScript());
    const style = next.document.head.querySelector("style");
    expect(style?.textContent).toBe(`[${ANNOUNCEMENT_ATTRIBUTE}='abc123']{display:none!important}`);
  });
});
