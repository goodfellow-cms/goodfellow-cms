import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseInstalledRecord } from "@goodfellow-cms/core";
import { blockWorks, formatShadcnBlock, ShadcnBlockError, type ShadcnRunner } from "@goodfellow-cms/core/shadcn";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addBlock } from "./blocks.js";

/**
 * `goodfellow blocks add` in a small site, with a stand-in for shadcn's CLI
 * that writes made-up components (and shadcn/ui's own, from the registry's
 * copy), so the tests never ask shadcn's registry for anything.
 */
const shadcnUi = resolve(import.meta.dirname, "../../registry/site/components/ui");
// Inside this package, so TypeScript and Vite find its packages, but not in node_modules, which TypeScript treats as packages'.
const sites = resolve(import.meta.dirname, "../test/.sites");

interface FakeItem {
  view: Record<string, unknown>;
  files: Record<string, string>;
}

const HERO = `import { cn } from "cn";

interface Link {
  text: string;
  url: string;
}

interface HeroProps {
  heading: string;
  description: string;
  link?: Link;
  image: { src: string; alt: string };
  tone?: "plain" | "bold";
  className?: string;
}

const defaultProps: HeroProps = {
  heading: "Welcome to the parish",
  description: "Mass on Sundays at 9 and 11.",
  link: { text: "Mass times", url: "/mass-times" },
  image: { src: "/media/church.jpg", alt: "The church in spring" },
};

const Hero = (props: Partial<HeroProps>) => {
  const { heading, description, link, image, className } = { ...defaultProps, ...props };
  return (
    <section className={cn("py-16", className)}>
      <h2 className="text-4xl font-bold">{heading}</h2>
      <p>{description}</p>
      {link && <a href={link.url}>{link.text}</a>}
      <img src={image.src} alt={image.alt} />
    </section>
  );
};

export { Hero };
`;

const LOGIN = `import { cn } from "cn";
import type * as React from "react";

export function LoginForm({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" />
        <button type="submit">Sign in</button>
      </form>
    </div>
  );
}
`;

const ACCORDION_DEMO = `import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export default function AccordionDemo() {
  return (
    <Accordion type="single" collapsible defaultValue="item-1">
      <AccordionItem value="item-1">
        <AccordionTrigger>When is Mass?</AccordionTrigger>
        <AccordionContent>Sundays at 9 and 11.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Is there parking?</AccordionTrigger>
        <AccordionContent>Behind the hall.</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
`;

const CALLBACK = `export function Countdown({ onDone }: { onDone: () => void; label: string }) {
  return <button type="button" onClick={onDone}>Done</button>;
}
`;

async function items(): Promise<Record<string, FakeItem>> {
  const ui = async (name: string) => readFile(join(shadcnUi, `${name}.tsx`), "utf8");
  return {
    button: {
      view: { name: "button", type: "registry:ui", files: [{ path: "registry/ui/button.tsx", type: "registry:ui" }] },
      files: { "components/ui/button.tsx": await ui("button") },
    },
    accordion: {
      view: {
        name: "accordion",
        type: "registry:ui",
        files: [{ path: "registry/ui/accordion.tsx", type: "registry:ui" }],
      },
      files: { "components/ui/accordion.tsx": await ui("accordion") },
    },
    "accordion-demo": {
      view: { name: "accordion-demo", type: "registry:example", files: [] },
      files: { "components/accordion-demo.tsx": ACCORDION_DEMO },
    },
    "@parish/hero": {
      view: {
        name: "hero",
        title: "Hero - With a picture",
        type: "registry:block",
        files: [{ path: "block/hero/hero.tsx", type: "registry:block" }],
        registryDependencies: ["button"],
        meta: { license: "https://parish.example/license" },
      },
      files: { "components/hero.tsx": HERO },
    },
    "login-01": {
      view: {
        name: "login-01",
        type: "registry:block",
        categories: ["authentication", "login"],
        files: [
          { path: "blocks/login-01/page.tsx", type: "registry:page" },
          { path: "blocks/login-01/components/login-form.tsx", type: "registry:component" },
        ],
      },
      files: { "components/login-form.tsx": LOGIN },
    },
    countdown: {
      view: {
        name: "countdown",
        type: "registry:component",
        files: [{ path: "countdown.tsx", type: "registry:component" }],
      },
      files: { "components/countdown.tsx": CALLBACK },
    },
  };
}

/** shadcn's CLI as far as the command uses it: `view` says what an item is, `add` writes its files. */
function fakeShadcn(known: Record<string, FakeItem>, calls: string[][]): ShadcnRunner {
  return async (args, { cwd }) => {
    calls.push(args);
    const [command, ref = ""] = args;
    const item = known[ref];
    if (!item) throw new Error(`Couldn't find ${ref}`);
    if (command === "view") return JSON.stringify([item.view]);
    for (const [path, content] of Object.entries(item.files)) {
      await mkdir(dirname(join(cwd, path)), { recursive: true });
      await writeFile(join(cwd, path), content);
    }
    return "";
  };
}

async function makeSite(name: string): Promise<string> {
  const root = join(sites, name);
  await rm(root, { recursive: true, force: true });
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name, private: true, type: "module", dependencies: {} }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        paths: { "@/*": ["./*"] },
      },
      include: ["goodfellow.config.tsx", "blocks", "components", "lib", "hooks"],
    }),
    "components.json": `{\n  "style": "new-york",\n  "rsc": false,\n  "tsx": true\n}\n`,
    "goodfellow.config.tsx": [
      'import { blocks } from "@goodfellow-cms/blocks";',
      'import { defineConfig } from "@goodfellow-cms/core";',
      'import { installedBlocks } from "./blocks/installed";',
      "",
      "export default defineConfig({ blocks: { ...blocks, ...installedBlocks } });",
      "",
    ].join("\n"),
    // A header of built-in blocks, which render with the site's context as the new block does.
    "content/layout/header.json": `${JSON.stringify({
      version: 1,
      data: {
        root: { props: {} },
        content: [
          {
            type: "Section",
            props: { id: "header-section", content: [{ type: "SiteBrand", props: { id: "brand" } }] },
          },
        ],
      },
    })}\n`,
    "blocks/installed/index.ts": [
      'import type { ComponentConfig } from "@puckeditor/core";',
      "// biome-ignore lint/suspicious/noExplicitAny: blocks have arbitrary props",
      "export const installedBlocks: Record<string, ComponentConfig<any>> = {};",
      "",
    ].join("\n"),
    "content/site.json": `${JSON.stringify({ version: 1, title: "St. Joseph" })}\n`,
    "content/pages/index.json": `${JSON.stringify({ version: 1, data: { root: { props: { title: "Home" } }, content: [] } })}\n`,
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

describe("goodfellow blocks add", () => {
  let known: Record<string, FakeItem>;
  let root: string;
  const calls: string[][] = [];
  const add = (item: string, options: { registry?: string } = {}) =>
    addBlock({ root, item, shadcn: fakeShadcn(known, calls), ...options });
  const read = (path: string) => readFile(join(root, path), "utf8");

  beforeAll(async () => {
    known = await items();
    root = await makeSite("blocks-add");
  });
  afterAll(() => rm(sites, { recursive: true, force: true }));

  it("makes a component's variants choices and its words its label, and records the block as the Blocks screen's are", async () => {
    const result = await add("button");
    expect(result).toMatchObject({
      name: "button",
      entry: "blocks/installed/button/block.tsx",
      fields: ["variant", "size", "children"],
    });
    expect(blockWorks(result)).toBe(true);
    expect(result.notes.map((note) => note.kind)).toEqual(["rsc"]);
    expect(await read("components.json")).toContain('"rsc": true');
    const block = await read("blocks/installed/button/block.tsx");
    expect(block).toContain('{ label: "Destructive", value: "destructive" },');
    expect(block).toContain("<Button variant={variant} size={size}>{children}</Button>");
    const record = parseInstalledRecord(await read("blocks/installed/installed.json"));
    expect(record.blocks.button).toMatchObject({
      source: "button",
      title: "Button",
      category: "Components",
      entry: "blocks/installed/button/block.tsx",
    });
    expect(Object.keys(record.blocks.button?.files ?? {}).sort()).toEqual([
      "blocks/installed/button/block.tsx",
      "components/ui/button.tsx",
    ]);
    expect(await read("blocks/installed/index.ts")).toContain('"button": block0,');
    expect(formatShadcnBlock(result)).toContain("Made the block button (Button)");
  }, 60_000);

  it("refuses a block the site already has", async () => {
    await expect(add("button")).rejects.toThrow(ShadcnBlockError);
  });

  it("takes a section's fields from its props, its defaults from its code, and says what it breaks", async () => {
    const result = await add("@parish/hero");
    expect(result.title).toBe("Hero");
    expect(result.fields).toEqual(["heading", "description", "link", "image", "tone"]);
    const block = await read("blocks/installed/hero/block.tsx");
    expect(block).toContain('src: mediaField("Picture"),');
    expect(block).toContain('heading: "Welcome to the parish",');
    expect(block).toContain('link: { text: "Mass times", url: "/mass-times" },');
    expect(block).toContain('className={part("gf-hero", undefined, className)}');
    const notes = result.notes.map((note) => note.text);
    expect(notes).toContainEqual(expect.stringContaining("uses <a>"));
    expect(notes).toContainEqual(expect.stringContaining("uses <img>"));
    expect(notes).toContainEqual("hero comes with its own license: https://parish.example/license");
    expect(parseInstalledRecord(await read("blocks/installed/installed.json")).blocks.hero?.category).toBe(
      "Page sections",
    );
    expect(blockWorks(result)).toBe(true);
  }, 60_000);

  it("shows parts that share context as shadcn's example of them, in one Client Component, which renders as an island", async () => {
    const result = await add("accordion");
    expect(blockWorks(result)).toBe(true);
    expect(calls).toContainEqual(["add", "accordion-demo", "--yes"]);
    const parts = await read("blocks/installed/accordion/accordion-parts.tsx");
    expect(parts.startsWith('"use client";')).toBe(true);
    expect(existsSync(join(root, "components/accordion-demo.tsx"))).toBe(false);
    expect(await read("blocks/installed/accordion/block.tsx")).toContain(
      'import AccordionDemo from "@/blocks/installed/accordion/accordion-parts";',
    );
    expect(result.notes.map((note) => note.kind)).toEqual(expect.arrayContaining(["parts", "hidden"]));
  }, 60_000);

  it("warns about app UI with nothing behind it, and leaves out what isn't part of a page", async () => {
    const result = await add("login-01");
    expect(result.fields).toEqual([]);
    const kinds = result.notes.map((note) => note.kind);
    expect(kinds).toEqual(expect.arrayContaining(["skipped", "app"]));
    expect(await read("blocks/installed/login-01/block.tsx")).toContain(
      '<LoginForm className={part("gf-login-01", undefined, className)} />',
    );
  }, 60_000);

  it("says a block doesn't work yet when a prop it needs has no field", async () => {
    const result = await add("countdown");
    expect(blockWorks(result)).toBe(false);
    expect(result.notes).toContainEqual(
      expect.objectContaining({ kind: "left-out", text: expect.stringContaining("onDone") }),
    );
    expect(result.notes.some((note) => note.kind === "typecheck")).toBe(true);
    expect(formatShadcnBlock(result)).toContain("It doesn't work yet:");
  }, 60_000);

  it("writes the block into a block registry instead, with the item's own code", async () => {
    const registry = join(sites, "registry");
    await rm(registry, { recursive: true, force: true });
    const site = await makeSite("blocks-registry");
    await cp(join(root, "components"), join(site, "components"), { recursive: true });
    const result = await addBlock({ root: site, item: "@parish/hero", registry, shadcn: fakeShadcn(known, calls) });
    expect(result.registry).toBeDefined();
    const index = JSON.parse(await readFile(join(registry, "registry.json"), "utf8"));
    expect(index.items).toEqual([
      expect.objectContaining({
        name: "hero",
        type: "registry:block",
        registryDependencies: ["button"],
        files: [
          { path: "blocks/hero/block.tsx", type: "registry:block" },
          { path: "components/hero.tsx", type: "registry:component", target: "~/components/hero.tsx" },
        ],
        meta: { goodfellow: { category: "Page sections" } },
      }),
    ]);
    expect(await readFile(join(registry, "components/hero.tsx"), "utf8")).toBe(HERO);
    expect(existsSync(join(site, "blocks/installed/hero"))).toBe(false);
  }, 60_000);
});
