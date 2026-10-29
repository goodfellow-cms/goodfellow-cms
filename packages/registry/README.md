# @goodfellow-cms/registry

Goodfellow's block registry: blocks built with [shadcn/ui](https://ui.shadcn.com), and a few built with Tailwind alone for some sites only, which a site's admins add and remove on the admin panel's **Blocks** screen, with no developer. It's also the reference for anyone publishing a registry of Goodfellow blocks built with another component library.

| Block | Category | Recommended |
|---|---|---|
| Hero | Page sections | Yes |
| Cards | Page sections | Yes |
| Call to action | Page sections | Yes |
| Testimonials | Page sections | Yes |
| Notice | Page sections | Yes |
| Pricing table | Page sections | |
| FAQ | Interactive | Yes |
| Tabs | Interactive | Yes |
| News feed | Page sections | |
| Map | Page sections | |
| Social links | Page sections | |
| Panel | Page sections | |
| Image carousel | Interactive | |
| Slideshow with quick links | Interactive | |
| Content with section links | Navigation | |
| People | Page sections | |
| Logos | Page sections | |
| Numbers | Page sections | |
| Timeline | Page sections | |
| Countdown | Interactive | |
| Comments | Interactive | |
| Custom HTML | Advanced | |

New sites made with `create-goodfellow` start with the recommended blocks unless the admin chooses "Built-in blocks only".

## How a block gets into a site

Adding a block copies its code into the site, as `npx shadcn add` would, in one publish:

- the block's own files to `blocks/installed/<name>/`;
- the shadcn components it uses to `components/ui/`, and any other shared code to `components/`, `lib/` or `hooks/`, unless the site already has them;
- a record of what was added, `blocks/installed/installed.json`, with a hash of every file written;
- `blocks/installed/index.ts`, which the site's `goodfellow.config.tsx` imports and which lists every installed block.

The editor offers the block once the site has been rebuilt with it, which the host does after the publish (and `goodfellow dev` or `next dev` do straight away). Removing a block is refused while any page, collection page design, header or footer uses it. Removing deletes the files it added, except those someone has changed since or that another installed block uses.

The admin panel installs a release of this registry that matches its own: `https://cdn.jsdelivr.net/npm/@goodfellow-cms/registry@<version>/r/{name}.json`. In development, `goodfellow dev` and `next dev` serve the copy in the site's `node_modules`.

## Publishing your own registry

A Goodfellow block registry is a [shadcn registry](https://ui.shadcn.com/docs/registry) whose block items follow a few extra rules. Build it with `npx shadcn build` and host the files anywhere that allows requests from browsers (CORS), such as GitHub Pages, npm through jsDelivr, or your own site.

### Items

A block is a `registry:block` item with `meta.goodfellow`:

```json
{
  "$schema": "https://ui.shadcn.com/schema/registry-item.json",
  "name": "acme-gallery",
  "type": "registry:block",
  "title": "Gallery",
  "description": "Pictures in a grid that open larger when clicked.",
  "registryDependencies": ["@acme/dialog"],
  "dependencies": ["radix-ui"],
  "files": [
    { "path": "blocks/acme-gallery/block.tsx", "type": "registry:block", "content": "…" },
    { "path": "blocks/acme-gallery/gallery-grid.tsx", "type": "registry:component", "content": "…" }
  ],
  "meta": {
    "goodfellow": {
      "category": "Pictures",
      "recommended": false,
      "image": "images/acme-gallery.png",
      "version": "1.2.0"
    }
  }
}
```

- **`name`** becomes the block's key in the site's content, so never change it once published. Use lowercase letters, numbers and dashes, and start names with your registry's own prefix so they don't clash with other registries' blocks.
- **`title`** and **`description`** are what admins see on the Blocks screen. Write them for people who aren't developers.
- **`meta.goodfellow.category`** is the group the block is listed under, on the Blocks screen and in the editor. `recommended` marks blocks a new site should start with. `image` is a picture of the block, relative to the item's address. `version` is recorded in the site when the block is added.
- **Files:** the item has exactly one `registry:block` file, whose default export is the block's Puck `ComponentConfig`. Every other file of the item goes into the block's folder too (`blocks/installed/<name>/`), so import them with relative paths (`./gallery-grid`). Items without `meta.goodfellow`, such as shared components, are dependencies: their files go to `components/ui/` (`registry:ui`), `components/` (`registry:component`), `lib/` (`registry:lib`) or `hooks/` (`registry:hook`), and blocks import them as `@/components/ui/dialog` and so on. A file's `target` can name another place within those folders. Other file types, and files elsewhere in the site, are refused.
- **`registryDependencies`** name items as `@namespace/name`, or as a plain name for shadcn/ui's own components (`"button"`), as with the shadcn CLI.
- **`registry.json`**, at the same address as the items (`…/r/registry.json` for `…/r/{name}.json`), lists them, so the Blocks screen can show them without loading every item.

### Packages

The admin panel can't install npm packages, so every site includes the same set and blocks can use only those. Besides `react`, `@goodfellow-cms/core`, `@goodfellow-cms/react` and `@puckeditor/core`, which every site has, they are `class-variance-authority`, `clsx`, `cn`, `embla-carousel-react`, `lucide-react`, `radix-ui`, `tailwind-merge` and `tw-animate-css`. An item whose `dependencies` name anything else can't be added. To suggest a package for the list, open an issue.

### Writing the blocks

Registry blocks follow the same rules as any Goodfellow block (see [AGENTS.md](https://github.com/goodfellow-cms/goodfellow-cms/blob/master/AGENTS.md#blocks)):

- Every block has a `className` prop (`className: classNameField`), applied to its outermost element and combined with `cx()` from `@goodfellow-cms/react`, last.
- Use the theme's classes (`bg-primary`, `text-muted-foreground`, `rounded-lg`), which shadcn's components use too, so blocks follow the site's colors and fonts.
- **Give it words to be found by** in the editor's block search, besides its label: `export default withKeywords(block, ["faq", "questions"])` from `@goodfellow-cms/react`, lowercase. It can wrap `withParts()`, or the other way round.
- **Name the block's parts**, so a site's theme can restyle them: `const part = useParts()` at the start of `render`, then `className={part("gf-my-block-title", "text-xl font-bold", className)}` on each part (the block's own classes, then anything an editor chose, `className` last), and declare them with what owners call them: `export default withParts(block, { "gf-my-block-title": "Title" })`. Start every name with `gf-` and the item's name, so they never clash with another block's, and never rename or remove one once it's published, since themes refer to them. Client Components get their parts' classes as plain props from the block, as `shadcn-faq` does.
- Render links and images with `SiteLink` and `SiteImage` from `@goodfellow-cms/react`, and image fields with `mediaField()`. To style a link as a button, give `SiteLink` the classes from shadcn's `buttonVariants()`.
- Labels and options are for non-technical people: "Space above and below", not "padding-y".
- `render` uses no hooks besides `useSite()`. Interactive parts go in a file starting with `"use client"`, which gets plain values and content (`children`, rich text) only.
- **One Client Component per interactive part.** Sites built with `goodfellow build` run each Client Component a block renders as its own small React app (an island), and islands don't share React context. Components whose parts talk to each other through context, as Radix's `Accordion`, `AccordionItem` and `AccordionContent` do, must all be put together inside one `"use client"` file, which the block renders with its content as props. See `site/blocks/installed/shadcn-faq/` here.
- **Keep content in the page.** Hidden content, such as closed answers or other tabs, should still be in the HTML (Radix's `forceMount`, hidden with CSS), so search engines and visitors without JavaScript see it.
- Prefer HTML and CSS where they're enough: a `<details>` element rather than a Client Component, since a page with a Client Component loads React.

### Letting a site use it

Admins can only add blocks from registries the site's developer trusts, since a block's code runs in the admin panel with the editor's access to the site. Add yours to the site's `goodfellow.config.tsx`, and its blocks appear on the Blocks screen beside Goodfellow's:

```tsx
export default defineConfig({
  blocks: { ...blocks, ...installedBlocks },
  registries: { "@acme": "https://acme.example/r/{name}.json" },
});
```

### Making it easy to find

Call the registry's repository `goodfellow-blocks-<name>` and give it the `goodfellow-blocks` topic on GitHub or GitLab, so searching either finds it, as `goodfellow-plugin-<name>` and `goodfellow-theme-<name>` do for plugins and themes. You can also ask for it to be listed in [shadcn's directory of registries](https://ui.shadcn.com/docs/directory). This registry is the exception, since it's released with Goodfellow.

## Working on this registry

- `registry.json` lists the blocks, whose files are in `site/blocks/installed/`, laid out as they'll be in a site.
- `site/components/ui/` and `shadcn.json` are a snapshot of the shadcn/ui components the blocks use, so a release always installs the same code. `pnpm --filter @goodfellow-cms/registry update-shadcn` (`scripts/snapshot.mjs`) fetches them again; review and commit what it writes. Don't edit the snapshot by hand.
- `pnpm build` (`scripts/build.mjs`) writes `r/`, which is what's published: an item per block and component, with its files, and `r/registry.json`.
- The tests check that every item is valid, uses only the allowed packages, installs with every file it imports, and renders.

The shadcn/ui components are © shadcn, under the MIT license in `LICENSE-shadcn.md`.
