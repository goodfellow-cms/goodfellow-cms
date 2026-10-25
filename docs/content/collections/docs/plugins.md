---
version: 1
title: Plugins
description: Add what blocks can't, such as screens in the admin panel, steps in the build and routes on a full-stack site's server, each held to the permissions it declares.
section: developers
order: 8.5
---

Plugins add what blocks can't: code and screens in the admin panel, steps in the build, and routes on [full-stack Next.js sites](/docs/full-stack-nextjs)' servers, as well as blocks of their own. Each runs where Goodfellow can hold it to the permissions it declares, and the docs say plainly where it can't.

Developers add plugins in the site's config. Installing them from the admin panel comes later; see the roadmap in the README.

## Add a plugin

Install its package, then list it in `goodfellow.config.tsx`:

```tsx
import { blocks } from "@goodfellow-cms/blocks";
import { defineConfig } from "@goodfellow-cms/core";
import { gallery } from "goodfellow-plugin-gallery";

export default defineConfig({
  blocks: { ...blocks },
  plugins: [gallery({ columns: 3 })],
});
```

`defineConfig()` adds the plugin's blocks to `blocks`, so the editor offers them and the site renders them. A site with a plugin named wrongly, or two blocks with the same name, doesn't load, and says why.

Rebuild the site, or restart `goodfellow dev` the first time, and the plugin's screens are listed at the end of **Site Settings**.

## What a plugin is

A plugin is an object made with `definePlugin()` from `@goodfellow-cms/core`, usually returned by a function its package exports so sites can pass it options. Its admin, build and server parts are named by module, never imported into the config, since the config is loaded in the browser too: each part is loaded only where it runs.

```ts
import { definePlugin } from "@goodfellow-cms/core";
import { GalleryBlock } from "./gallery-block";

export function gallery(options: { columns?: number } = {}) {
  return definePlugin({
    name: "goodfellow-plugin-gallery",
    title: "Gallery",
    version: "1.0.0",
    description: "Photo galleries from the gallery service.",
    permissions: {
      connect: ["https://api.gallery.example"],
      files: ["content/gallery.json"],
      secrets: ["GALLERY_KEY"],
      read: ["content/"],
      write: ["gallery/"],
    },
    blocks: { GalleryGrid: GalleryBlock(options) },
    admin: "goodfellow-plugin-gallery/admin",
    screens: [{ id: "settings", title: "Gallery" }],
    build: [{ id: "thumbnails", module: "goodfellow-plugin-gallery/build", title: "Make thumbnails" }],
    server: "goodfellow-plugin-gallery/server",
  });
}
```

- **`name`** is the npm package's name, `goodfellow-plugin-<name>` or `@scope/goodfellow-plugin-<name>`, and **`title`** what owners call it.
- **`blocks`** and **`categories`** work as in the config. A block's name is what content refers to it by, so it never changes, and it can't be the same as another block's: start them with your plugin's name.
- **`admin`** names the module run in the admin panel, a package export or a path from the site's root such as `./plugins/gallery/admin.ts`. Its default export is made with `definePluginAdmin()`.
- **`screens`** are drawn by the admin module, each listed in Site Settings by its `title`.
- **`build`** steps run in order after the site is built, each a module whose default export is a function.
- **`server`** names the module that answers requests on full-stack sites.

A plugin kept in the site's own repository, such as one only that site uses, is a folder with the same files, named with paths from the site's root.

## Permissions

A plugin gets nothing it doesn't declare. Leave out what it doesn't need.

| Permission | What it allows | How it's held to it |
| --- | --- | --- |
| `connect` | The addresses its admin module may request, as origins: `https://api.example.com`, or `https://*.example.com` | The plugin's frame has a Content Security Policy that reaches only these. |
| `files` | The content files and media its screens may read and publish: a file such as `content/gallery.json`, or a folder ending in `/`, under `content/` or `public/media/` | The admin panel refuses any other read or publish. The site's own code in `content/code/` can never be declared. |
| `secrets` | The environment variables its build steps get | A step's process gets these and nothing else of the build's environment. The tokens that can publish to the repository can never be declared. |
| `read` | Files and folders from the site's root its build steps may read, besides the built site, their own package and `node_modules` | Node's permission model refuses every other read. |
| `write` | Files and folders in the built site its build steps may write | Node's permission model refuses every other write. |

Services the admin module requests must allow requests from any origin (`Access-Control-Allow-Origin: *`): its frame is sandboxed, so it has no origin of its own.

## In the admin panel

The admin module runs in a frame of its own, sandboxed with `allow-scripts` alone like the [editor's](/docs/security), so it never reaches the admin panel's sign-in or storage.

```ts
import { definePluginAdmin } from "@goodfellow-cms/core";

export default definePluginAdmin({
  services: {
    // Asked by the plugin's blocks in the editor.
    async albums(_args, api) {
      const response = await fetch("https://api.gallery.example/albums");
      return response.json();
    },
  },
  screens: {
    async settings(element, api) {
      const [settings] = Object.values(await api.read(["content/gallery.json"]));
      element.textContent = settings ?? "No settings yet";
    },
  },
});
```

**Screens** draw into the element they're given, with plain DOM or a framework of the plugin's own, and may return a function that cleans up. Their frame has the admin panel's colors as `--gfa-*` custom properties, which follow its light or dark choice, and plain styles for headings, fields and buttons.

**`api`**, which screens and services are given, asks the admin panel for:

- `read(paths)` and `readBytes(path)`: files the plugin declared, as the site is loaded.
- `list(folder)`: the files the plugin declared under a folder, such as `public/media/`.
- `publish(changes, message)`: changes to files the plugin declared, in one publish, after the same checks as any publish, answering whether it was published. A change is `{ path, text }`, `{ path, bytes }` or `{ path, delete: true }`.
- `server(path, request)`: the plugin's server module on a full-stack site, signed in as the editor.
- `navigate(href)`: another of the admin panel's screens, such as `#/media`.

**Services** answer the plugin's blocks in the editor, whose code runs in the editor's frame, which can fetch nothing. A block asks with `useSite().callPlugin`, which only the editor provides:

```tsx
"use client";

import { useSite } from "@goodfellow-cms/react";
import { useEffect, useState } from "react";

export function AlbumPicker() {
  const { callPlugin } = useSite();
  const [albums, setAlbums] = useState<string[]>([]);
  useEffect(() => {
    void callPlugin?.("goodfellow-plugin-gallery", "albums").then((found) => setAlbums(found as string[]));
  }, [callPlugin]);
  return <ul>{albums.map((album) => <li key={album}>{album}</li>)}</ul>;
}
```

Other plugins' blocks can ask a plugin's services too, so a service should offer only what it's fine for any code in the editor to have, never the access itself.

## In the build

`goodfellow build` and `goodfellow-next finish` bundle each plugin's admin module into its frame, at `admin/plugins/<id>/`, and run its build steps once the site's pages are written, before the search index and the [admin address's](/docs/custom-domains#an-admin-address) guards, which then cover what the steps wrote.

```js
export default async function thumbnails({ root, outDir, base, secrets }) {
  // Read what the plugin declared, and write into the built site where it declared.
}
```

Each step runs in a Node process of its own with Node's permission model on: it can't start other processes or workers, and reads and writes only what the plugin declared. It gets the environment variables it declared, those that are set, besides what Node needs to run. A step that fails stops the build.

`goodfellow-next finish` loads the config outside Next.js for this, only when the config has a `plugins` line, bundling the site's own files and leaving its packages for Node to load.

## On full-stack sites' servers

On a [full-stack Next.js site](/docs/full-stack-nextjs), a plugin's server module answers requests to `/api/goodfellow/plugins/<id>/…`. Pass the server modules to `goodfellowApi()` in the API route, since Next.js bundles only what the route imports:

```ts
import galleryServer from "goodfellow-plugin-gallery/server";
import config from "@/goodfellow.config";

export const { GET, POST } = goodfellowApi({
  config,
  authorize,
  signIn: "/sign-in",
  plugins: { "goodfellow-plugin-gallery": galleryServer },
});
```

Its default export gets the request and `{ path, editor }`: the path after its id, and who's signed in, which it's told only for requests from the site's own pages, such as its screens', through `api.server()`. Anyone can send the rest, as webhooks need.

## What can't be enforced

- **A server module** runs with everything the site's server has, its token and secrets included. Only a review backs what it declares.
- **A build step's network requests** aren't limited: Node's permission model covers files, processes and workers, not the network. The packages a step loads share its process and what it was given.
- **Blocks on the site's pages** run with everything visitors' browsers allow, like any block, since pages have no Content Security Policy.
- **A sandboxed frame can leave for another address**, so a plugin's policy limits what its admin module can send while it's there without sealing it. Its sandbox is what keeps it from the admin panel's sign-in.

So read a plugin's code, or trust its publisher, before adding one whose server module or build steps you'd rely on the declarations of.

## Publish a plugin

Publish it to npm as `goodfellow-plugin-<name>`, with the `goodfellow-plugin` keyword, and keep it in a repository of its own, called the same, with the `goodfellow-plugin` topic on GitHub or GitLab. Say which Goodfellow releases it works with as a `peerDependencies` range on `@goodfellow-cms/core`, and publish from GitHub Actions or GitLab CI with [npm's provenance](https://docs.npmjs.com/generating-provenance-statements).
