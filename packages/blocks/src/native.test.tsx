// @vitest-environment happy-dom
import { resolve } from "node:path";
import { defineConfig, loadSiteContent, shownContent, sitePages, todayIn } from "@goodfellow-cms/core";
import { fileSystemSource } from "@goodfellow-cms/core/node";
import { classStyle, GoodfellowPage, GoodfellowSite, memoryStorage, nativeTheme } from "@goodfellow-cms/expo";
import { contentApi } from "@goodfellow-cms/react/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { highlightedCode } from "./code-data.js";
import { blocks, categories } from "./index.js";
import { nativeBlocks } from "./native.js";

// Tests run in the package's folder; happy-dom gives modules web addresses, not files.
const STARTER = resolve(process.cwd(), "../../templates/starter");
const SITE = "https://parish.example/";

/** The starter's content API, as `goodfellow build` writes it, served by a fake of its address. */
async function starterApi(): Promise<typeof fetch> {
  const config = defineConfig({ blocks, categories });
  const content = shownContent(await loadSiteContent(fileSystemSource(STARTER)), new Date());
  const files = await contentApi(
    config,
    content,
    sitePages(content, todayIn(content.settings.timeZone), config.blocks),
  );
  const served = new Map(files.map((file) => [new URL(file.path.slice(1), SITE).href, file.content]));
  return (async (input: RequestInfo | URL) => {
    const text = served.get(String(input));
    return text === undefined ? new Response("Not found", { status: 404 }) : new Response(text);
  }) as typeof fetch;
}

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function shown(path: string, fetcher: typeof fetch): Promise<HTMLElement> {
  const element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  await act(async () => {
    root?.render(
      <GoodfellowSite site={SITE} storage={memoryStorage()} blocks={nativeBlocks} fetch={fetcher}>
        <GoodfellowPage path={path} />
      </GoodfellowSite>,
    );
  });
  for (let tries = 0; tries < 100 && !element.textContent?.trim(); tries++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  }
  // A moment more, for the page's own loading after the site's.
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  return element;
}

describe("nativeBlocks", () => {
  it("has a native version of every built-in block, by the same names", () => {
    expect(Object.keys(nativeBlocks).sort()).toEqual(Object.keys(blocks).sort());
  });

  it("draws the starter's pages from its content API, with no block left out", async () => {
    const fetcher = await starterApi();
    for (const path of ["/", "/about", "/news"]) {
      const page = await shown(path, fetcher);
      const text = page.textContent ?? "";
      expect(text.length, path).toBeGreaterThan(20);
      expect(text, path).not.toContain("Open this page on the website");
      act(() => root?.unmount());
      root = undefined;
    }
  });

  it("draws the home page's heading and the header's site name", async () => {
    const page = await shown("/", await starterApi());
    const headings = [...page.querySelectorAll('[role="heading"]')].map((heading) => heading.textContent);
    expect(headings.length).toBeGreaterThan(0);
    expect(page.textContent).toContain("My site");
  });
});

/** The home page with its blocks' Style settings changed, by block id. */
function withClasses(fetcher: typeof fetch, classes: Record<string, string>): typeof fetch {
  const restyle = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(restyle);
    if (!value || typeof value !== "object") return value;
    const object = Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, restyle(inner)]));
    const props = object.props as Record<string, unknown> | undefined;
    if (props && typeof props.id === "string" && classes[props.id] !== undefined) props.className = classes[props.id];
    return object;
  };
  return (async (input: RequestInfo | URL) => {
    const response = await fetcher(input);
    if (!String(input).endsWith("/api/pages/index.json")) return response;
    return new Response(JSON.stringify(restyle(await response.json())));
  }) as typeof fetch;
}

describe("blocks' Style in apps", () => {
  const settings = { theme: { colors: { primary: "#1d4ed8" }, fonts: {}, radius: "0.5rem", darkMode: true } };

  it("reads classes as box and text styles, with the theme's colors and corners", () => {
    const theme = nativeTheme(settings as never, false);
    const style = classStyle("text-center text-primary bg-[#ff0000] p-[13px] -mt-4 rounded-xl text-lg", {
      settings: settings as never,
      theme,
      width: 400,
    });
    expect(style.text).toEqual({ textAlign: "center", color: "#1d4ed8", fontSize: 18, lineHeight: 28 });
    expect(style.view).toMatchObject({ backgroundColor: "#ff0000", paddingTop: 13, marginTop: -16, borderRadius: 12 });
  });

  it("applies breakpoints' classes on wide screens and dark ones where the site shows dark, saying nothing of the rest", () => {
    const warn = vi.spyOn(console, "warn");
    const className = "p-2 md:p-8 dark:bg-primary hover:bg-muted grid gf-own";
    const light = nativeTheme(settings as never, false);
    const dark = nativeTheme(settings as never, true);
    expect(classStyle(className, { settings: settings as never, theme: light, width: 400 }).view).toEqual({
      paddingTop: 8,
      paddingRight: 8,
      paddingBottom: 8,
      paddingLeft: 8,
    });
    const wide = classStyle(className, { settings: settings as never, theme: dark, width: 800 }).view;
    expect(wide).toMatchObject({ paddingTop: 32, backgroundColor: dark.colors.primary });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("gives a button its Style itself, rather than a box around it", async () => {
    const page = await shown("/", withClasses(await starterApi(), { "Button-primary": "bg-[#ff0000] rounded-[3px]" }));
    // happy-dom keeps colors as written.
    const red = [...page.querySelectorAll("*")].filter((element) =>
      /255, 0, 0|#ff0000/i.test(getComputedStyle(element).backgroundColor),
    );
    expect(red).toHaveLength(1);
    expect(red[0]?.getAttribute("role")).toBe("link");
  });

  it("gives a block's box and text the styles its classes say, with the theme's colors", async () => {
    const page = await shown(
      "/",
      withClasses(await starterApi(), {
        "Heading-hero": "text-center text-[18px] text-primary-foreground hover:text-primary",
        "Section-hero": "p-[13px] rounded-xl mt-8 grid",
      }),
    );
    const heading = [...page.querySelectorAll('[role="heading"]')].find(
      (element) => element.textContent === "Welcome to my site",
    ) as HTMLElement;
    const style = getComputedStyle(heading);
    expect(style.textAlign).toBe("center");
    expect(style.fontSize).toBe("18px");
    const box = [...page.querySelectorAll("div")].find((element) => getComputedStyle(element).padding === "13px");
    expect(box, "the Section's box").toBeDefined();
    expect(box?.textContent).toContain("Welcome to my site");
    expect(getComputedStyle(box as HTMLElement).marginTop).toBe("32px");
  });
});

describe("highlightedCode", () => {
  it("reads Shiki's colors as lines of colored text, decoding what it escaped", () => {
    const html =
      '<pre class="shiki" style="background-color:#fff;--shiki-dark-bg:#24292e;color:#24292e;--shiki-dark:#e1e4e8" tabindex="0"><code>' +
      '<span class="line"><span style="color:#D73A49;--shiki-dark:#F97583">if</span><span style="color:#24292E"> (a &lt; b) {}</span></span>\n' +
      '<span class="line"><span style="color:#6A737D">// &quot;done&quot; &#x26; &#39;ok&#39;</span></span></code></pre>';
    expect(highlightedCode(html)).toEqual({
      lines: [
        [
          { text: "if", color: "#D73A49", darkColor: "#F97583" },
          { text: " (a < b) {}", color: "#24292E" },
        ],
        [{ text: "// \"done\" & 'ok'", color: "#6A737D" }],
      ],
      background: "#fff",
      darkBackground: "#24292e",
      color: "#24292e",
      darkColor: "#e1e4e8",
    });
  });

  it("leaves out the page's own colors, which apps can't read, and HTML that isn't Shiki's", () => {
    expect(
      highlightedCode('<pre style="background-color:var(--muted)"><code><span class="line">x</span></code></pre>'),
    ).toEqual({ lines: [[{ text: "x" }]] });
    expect(highlightedCode("<p>Hello</p>")).toBeUndefined();
    expect(highlightedCode(undefined)).toBeUndefined();
  });
});
