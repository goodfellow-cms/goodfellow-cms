import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  EMPTY_RECORD,
  type FileChange,
  type GoodfellowConfig,
  planInstall,
  REGISTRY_PACKAGES,
  registryIndexSchema,
  registryItemSchema,
  type SiteContent,
  siteSettingsSchema,
} from "@goodfellow-cms/core";
import { blockParts } from "@goodfellow-cms/react";
import { createPageRenderer } from "@goodfellow-cms/react/server";
import type { ComponentConfig } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import registry from "../registry.json" with { type: "json" };

const built = fileURLToPath(new URL("../r/", import.meta.url));
const registries = { "@goodfellow": "https://registry.example/r/{name}.json" };
const fetchJson = async (url: string) => {
  const name = url.slice("https://registry.example/r/".length);
  return JSON.parse(await readFile(`${built}${name}`, "utf8"));
};
const blockNames = registry.items.map((item) => item.name);

describe("the built registry", () => {
  it("lists every block and shadcn component, each valid", async () => {
    const index = registryIndexSchema.parse(await fetchJson("https://registry.example/r/registry.json"));
    const files = (await readdir(built)).filter((file) => file !== "registry.json");
    expect(files.sort()).toEqual(index.items.map((item) => `${item.name}.json`).sort());
    for (const file of files) {
      const item = registryItemSchema.parse(JSON.parse(await readFile(`${built}${file}`, "utf8")));
      // Sites have these packages from the start, since the admin panel can't add packages.
      for (const dependency of item.dependencies) {
        expect(REGISTRY_PACKAGES, `${item.name} needs ${dependency}`).toContain(dependency.replace(/(.)@.*$/, "$1"));
      }
    }
    expect(index.items.filter((item) => item.meta?.goodfellow).map((item) => item.name)).toEqual(blockNames);
  });

  it.each(blockNames)("installs %s with every file it imports", async (name) => {
    const files = new Map<string, string>();
    const plan = await planInstall({
      ref: `@goodfellow/${name}`,
      registries,
      fetchJson,
      readFile: async (path) => files.get(path),
      record: EMPTY_RECORD,
      blocks: [],
    });
    for (const change of plan.changes as Array<Extract<FileChange, { content: string }>>) {
      files.set(change.path, change.content);
    }
    expect(files.get("blocks/installed/index.ts")).toContain(`"${name}": block0`);
    for (const [path, content] of files) {
      for (const [, imported] of content.matchAll(/from "@\/([^"]+)"/g)) {
        expect(
          [...files.keys()].some((file) => file.replace(/\.tsx?$/, "") === imported),
          `${path} imports @/${imported}`,
        ).toBe(true);
      }
    }
  });
});

describe("blocks", () => {
  const settings = siteSettingsSchema.parse({ version: 1, title: "St. Joseph" });
  const content: SiteContent = {
    settings,
    menus: {},
    header: { version: 1, data: { root: {}, content: [] } },
    footer: { version: 1, data: { root: {}, content: [] } },
    pages: [],
    collections: [],
    customCss: "",
  };

  it.each(blockNames)("renders %s with its default settings", async (name) => {
    const block = (await import(`../site/blocks/installed/${name}/block.tsx`)).default as ComponentConfig;
    const config: GoodfellowConfig = { blocks: { [name]: block } };
    const html = await createPageRenderer(config)(content, {
      path: "/",
      file: "content/pages/index.json",
      content: {
        version: 1,
        data: {
          root: { props: { title: "Home" } },
          content: [{ type: name, props: { id: "b", ...block.defaultProps } }],
        },
      },
    });
    expect(html).toContain('<main class="gf-main" data-pagefind-body="">');
    expect(html).not.toContain("<!--$!-->");
  });

  it.each(blockNames)("names %s's parts after the block, so they can't clash with others'", async (name) => {
    const block = (await import(`../site/blocks/installed/${name}/block.tsx`)).default as ComponentConfig;
    const parts = Object.keys(blockParts(block) ?? {});
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) expect(part === `gf-${name}` || part.startsWith(`gf-${name}-`), part).toBe(true);
  });

  it("keeps every answer and tab in the page, hidden until shown", async () => {
    const render = async (name: string, props: Record<string, unknown>) => {
      const block = (await import(`../site/blocks/installed/${name}/block.tsx`)).default as ComponentConfig;
      return createPageRenderer({ blocks: { [name]: block } })(content, {
        path: "/",
        file: "content/pages/index.json",
        content: {
          version: 1,
          data: { root: { props: {} }, content: [{ type: name, props: { id: "b", ...block.defaultProps, ...props } }] },
        },
      });
    };
    const faq = await render("shadcn-faq", {});
    expect(faq).toContain("A question people ask");
    expect(faq.match(/Its answer\./g)).toHaveLength(2);
    expect(faq).toContain("[&amp;&gt;[data-slot=accordion-content][data-state=closed]]:hidden");
    const tabs = await render("shadcn-tabs", {});
    expect(tabs).toContain("What the second tab shows.");
  });

  it("makes custom HTML safe unless told to use it as written", async () => {
    const name = "custom-html";
    const block = (await import(`../site/blocks/installed/${name}/block.tsx`)).default as ComponentConfig;
    const render = (props: Record<string, unknown>) =>
      createPageRenderer({ blocks: { "custom-html": block } })(content, {
        path: "/",
        file: "content/pages/index.json",
        content: {
          version: 1,
          data: {
            root: { props: {} },
            content: [{ type: "custom-html", props: { id: "b", ...block.defaultProps, ...props } }],
          },
        },
      });
    const html = '<p class="note" onclick="steal()">Hi</p><script>window.ran = true;</script>';
    const safe = await render({ html, className: "my-html" });
    expect(safe).toContain('<div class="gf-custom-html my-html"><p class="note">Hi</p></div>');
    expect(safe).not.toContain("window.ran");
    const asWritten = await render({ html, sanitize: false });
    expect(asWritten).toContain(`<div class="gf-custom-html">${html}</div>`);
  });
});
