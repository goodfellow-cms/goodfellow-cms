---
version: 1
title: Block registries
description: Publish blocks that sites add from the admin panel, built with shadcn/ui or any other component library.
section: developers
order: 8
---

Goodfellow's blocks built with component libraries come from block registries: [shadcn registries](https://ui.shadcn.com/docs/registry) whose items are Goodfellow blocks. Goodfellow publishes one for shadcn/ui, `@goodfellow-cms/registry`. Anyone can publish one for another library in the same format: build it with `npx shadcn build` and host the files anywhere that allows requests from browsers (CORS), such as GitHub Pages or npm through jsDelivr.

## Items

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
    "goodfellow": { "category": "Pictures", "recommended": false, "image": "images/acme-gallery.png", "version": "1.2.0" }
  }
}
```

- **`name`** becomes the block's key in the site's content, so it never changes once published. Start names with your registry's own prefix so they don't clash with other registries' blocks.
- **`title`** and **`description`** are what admins see on the Blocks screen; write them for people who aren't developers.
- **`meta.goodfellow`**: `category` is the group the block is listed under, `recommended` marks blocks new sites start with, `image` is a picture of the block (relative to the item's address), and `version` is recorded in the site when the block is added.
- **Files:** exactly one `registry:block` file, which default-exports the block's Puck `ComponentConfig`. The item's other files go in the block's folder too, `blocks/installed/<name>/`, so import them with relative paths. Items without `meta.goodfellow`, such as shared components, go in `components/ui/`, `components/`, `lib/` or `hooks/`, imported as `@/components/ui/dialog` and so on.
- **`registryDependencies`** name items as `@namespace/name`, or as a plain name for shadcn/ui's own components (`"button"`).
- **`registry.json`**, beside the items, lists them for the Blocks screen.

## Packages

The admin panel can't install npm packages, so every site includes the same set, and blocks can use only those: besides React, Puck and `@goodfellow-cms/react`, they are `class-variance-authority`, `clsx`, `cn`, `embla-carousel-react`, `lucide-react`, `radix-ui`, `tailwind-merge` and `tw-animate-css`.

## Writing the blocks

Registry blocks follow the [rules for every block](/docs/write-blocks#rules). Interactive ones put every part that shares React context, such as an accordion with its items, in one `"use client"` file, since [islands](/docs/interactive-blocks#what-islands-cant-do) don't share context, and keep hidden content in the HTML, hidden with CSS, so search engines and search boxes see it.

## Letting a site use it

A site's developer lists the registries its admins may add blocks from, since a block's code runs in the admin panel with the editor's access to the site:

```tsx
export default defineConfig({
  blocks: { ...blocks, ...installedBlocks },
  registries: { "@acme": "https://acme.example/r/{name}.json" },
});
```

## Making it easy to find

Call the registry's repository `goodfellow-blocks-<name>`, such as `goodfellow-blocks-acme`, and give it the `goodfellow-blocks` topic on GitHub or GitLab, so developers looking for Goodfellow blocks find it by searching either. Plugins and themes are named the same way, `goodfellow-plugin-<name>` and `goodfellow-theme-<name>`. You can also ask for it to be listed in [shadcn's directory of registries](https://ui.shadcn.com/docs/directory), where shadcn's users look. Goodfellow's own registry is the exception: it's `@goodfellow-cms/registry`, in Goodfellow's repository, since the admin panel installs the release that matches it.
