---
version: 1
title: Plugins
description: Add what blocks can't, such as screens in the admin panel, steps in the build and routes on a full-stack site's server, each held to the permissions it declares.
section: developers
order: 8.5
---

Plugins add what blocks can't: code and screens in the admin panel, steps in the build, and routes on [full-stack Next.js sites](/docs/full-stack-nextjs)' servers, as well as blocks of their own. Each runs where Goodfellow can hold it to the permissions it declares, and the docs say plainly where it can't.

Owners install plugins from the admin panel's **Site Settings → Plugins**, where the admin panel is out of the site's pages' reach; developers add them in the site's config, on any site.

## Install a plugin from the admin panel

**Site Settings → Plugins** finds plugins on npm. Choose one to see:

- **Its release:** the newest that's at least three days old, since most harmful releases are found by then, and that says it works with the site's Goodfellow release (its `peerDependencies` range on `@goodfellow-cms/core`), with where npm says it was built from, if it has [provenance](https://docs.npmjs.com/generating-provenance-statements).
- **What it asks to do:** the permissions and parts in its `goodfellow-plugin.json` (see [Publish a plugin](#publish-a-plugin)), in plain words. An update lists what it asks for that the installed release didn't.
- **What its code does:** the admin panel reads the plugin's package, and the packages it needs at the releases the site's build would take, from jsDelivr, and notes network requests, other programs, code made from text (`eval`, `new Function`), native code and install scripts. It reads code as text, so code can hide what it does: it's a place to start reading, not a promise.

**Install** publishes three changes in one: `package.json` names the plugin at that exact release, `plugins/installed/installed.json` records what was approved, and `plugins/installed/index.ts`, which the config imports, lists it. Sites made before the config imported it get the import in the same publish, and where the config lists plugins of its own, a developer adds `...installedPlugins` to them first.

The site's build then writes `package-lock.json`, with `npm install --package-lock-only --ignore-scripts`: it installs nothing and runs none of the plugin's code, and takes only releases at least three days old for the packages the plugin needs. It publishes the lockfile, and builds the site with it. The starters' setups for GitHub Pages, GitLab Pages and Cloudflare Pages do this, and so does the `bitbucket-pipelines.yml` of sites on Bitbucket; the admin panel says when a site's setup doesn't, and installs nothing until a developer updates it from the starter's. Vercel builds sites itself, so on Vercel, other than from Bitbucket, developers add plugins in code for now.

A plugin that asks for more than its owner approved, in a later release or by changing what its package exports, stops the site from loading, and says what it asked for: install it again from the Plugins screen to approve it.

### Where plugins can be installed

A plugin's code is included when the site builds, so the admin panel installs plugins only where the site's own pages can't publish code:

- **At an admin address of its own** ([Security](/docs/security)), where the Plugins screen asks before installing, outside the editor's sandbox.
- **With a token broker** ([Security](/docs/security)), which asks again in its own dialog, naming the plugin and what it asks to do.
- **On full-stack Next.js sites**, whose builds and servers hold the site's secrets, installing, updating or removing a plugin is submitted for review, for a developer to accept. Only owners can.

Elsewhere the screen lists plugins and explains, and developers add them in code. Plugins whose blocks are on a page can't be removed until the page no longer uses them. The Updates screen warns when a Goodfellow release is outside an installed plugin's range; installing such a release fails, as npm refuses it, and the site stays as it was.

New sites can start with plugins: `npm create goodfellow@latest my-site -- --plugin goodfellow-plugin-guestbook` installs the same way.

## Add a plugin in code

Install its package, then list it in `goodfellow.config.tsx`:

```tsx
import { blocks } from "@goodfellow-cms/blocks";
import { defineConfig } from "@goodfellow-cms/core";
import { gallery } from "goodfellow-plugin-gallery";
import { installedPlugins } from "./plugins/installed";

export default defineConfig({
  blocks: { ...blocks },
  plugins: [...installedPlugins, gallery({ columns: 3 })],
});
```

Keep `...installedPlugins` (from `./plugins/installed`), which lists those installed from the admin panel.

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
    tasks: [{ id: "publish-album", module: "goodfellow-plugin-gallery/publish-album", title: "Publish an album" }],
    server: "goodfellow-plugin-gallery/server",
  });
}
```

- **`name`** is the npm package's name, `goodfellow-plugin-<name>` or `@scope/goodfellow-plugin-<name>`, and **`title`** what owners call it.
- **`blocks`** and **`categories`** work as in the config. A block's name is what content refers to it by, so it never changes, and it can't be the same as another block's: start them with your plugin's name.
- **`admin`** names the module run in the admin panel, a package export or a path from the site's root such as `./plugins/gallery/admin.ts`. Its default export is made with `definePluginAdmin()`.
- **`screens`** are drawn by the admin module, each listed in Site Settings by its `title`.
- **`build`** steps run in order after the site is built, each a module whose default export is a function.
- **`tasks`** run in the site's CI when the admin module asks, with the secrets the plugin declared (see [Tasks](#tasks)).
- **`server`** names the module that answers requests on full-stack sites.
- **`mediaStorage`** says it keeps the site's media outside the repository, as [S3 storage](#keeping-media) does, with the largest file it takes as `maxBytes`.
- **`editor`** says its admin module draws a page editor that people can choose in place of the standard one, with the `title` they choose it by and the `kinds` it edits (see [A page editor of its own](#a-page-editor-of-its-own)).
- **`options`** is anything else the site's config chooses for it, as JSON, which its admin module reads as `api.plugin.options`, such as more services to offer. It's published with the site's description, so never put secrets in it.

A plugin kept in the site's own repository, such as one only that site uses, is a folder with the same files, named with paths from the site's root.

## Permissions

A plugin gets nothing it doesn't declare. Leave out what it doesn't need.

| Permission | What it allows | How it's held to it |
| --- | --- | --- |
| `connect` | The addresses its admin module may request, as origins: `https://api.example.com`, or `https://*.example.com` | The plugin's frame has a Content Security Policy that reaches only these. |
| `files` | The content files and media its screens may read and publish: a file such as `content/gallery.json`, or a folder ending in `/`, under `content/` or `public/media/` | The admin panel refuses any other read or publish. The site's own code in `content/code/` can never be declared. |
| `secrets` | The environment variables its build steps and tasks get | A step's or task's process gets these and nothing else of the build's environment. The tokens that can publish to the repository can never be declared. |
| `read` | Files and folders from the site's root its build steps and tasks may read, besides the built site, their own package and `node_modules` | Node's permission model refuses every other read. |
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

**Screens** draw into the element they're given, with plain DOM or a framework of the plugin's own, and may return a function that cleans up. A screen's frame is the whole screen, as wide as the admin panel's other screens and as tall as what it draws, so start with the screen's own heading (`<h1>`). The frame has the admin panel's colors as `--gfa-*` custom properties, which follow its light or dark choice, and plain styles for headings, sections, fields, buttons, lists and code.

**`api`**, which screens and services are given, asks the admin panel for:

- `read(paths)` and `readBytes(path)`: files the plugin declared, as the site is loaded.
- `list(folder)`: the files the plugin declared under a folder, such as `public/media/`.
- `publish(changes, message)`: changes to files the plugin declared, in one publish, after the same checks as any publish, answering whether it was published. A change is `{ path, text }`, `{ path, bytes }` or `{ path, delete: true }`.
- `server(path, request)`: the plugin's server module on a full-stack site, signed in as the editor. `path` is under the plugin's own address, so paths that would leave it (`..`, in any spelling) are refused.
- `task(id, input)`: one of the plugin's [tasks](#tasks), run in the site's CI, answering with what it returned. It takes about a minute.
- `secretsHelp()`: how the site's owner adds the secrets the plugin declared, for this site as it's set up, in the admin panel's words: on GitHub, the form for a new Actions secret and what to type in it; on GitLab, the CI/CD variables; on Bitbucket, the repository variables; in `goodfellow dev` and `next dev`, the lines of `.env.local`; on a full-stack site, the server's environment, then the CI. Show its steps as they are.
- `openSecretsLink(url)`: opens one of the links `secretsHelp()` gave in a new tab, which the frame's sandbox can't do itself.
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

Serving a frame hands its code to whoever opens it, so every build, the development servers' included, writes `admin/plugins/<id>/LICENSES.txt` beside it, and its page links to it. It lists every package the frame bundles, the plugin's own and the ones it needs, with its version, its license and where its source is (its repository, or else its page on npm), then each license text once, after the packages it covers.

```js
export default async function thumbnails({ root, outDir, base, secrets }) {
  // Read what the plugin declared, and write into the built site where it declared.
}
```

Each step runs in a Node process of its own with Node's permission model on: it can't start other processes or workers, and reads and writes only what the plugin declared. It gets the environment variables it declared, those that are set, besides what Node needs to run. A step that fails stops the build.

`goodfellow-next finish` loads the config outside Next.js for this, only when the config has a `plugins` line, bundling the site's own files and leaving its packages for Node to load.

## Tasks

A task is work the admin module asks the site's CI to do with secrets the admin panel must never hold, such as signing uploads to a storage service with its keys. The admin module calls `api.task(id, input)`; the admin panel starts the task with a key pair it makes for that request alone, and the site's CI runs `goodfellow task` (`goodfellow-next task` in Next.js sites), which loads the site's config in a process of its own that's given none of the job's secrets, runs the task, and seals its answer to that request's public key, so only the admin panel that asked can read it. It takes about a minute.

```js
// goodfellow-plugin-gallery/publish-album
export default async function publishAlbum(input, { root, secrets }) {
  // Use secrets.GALLERY_KEY; return anything JSON keeps, or throw an Error whose message the admin module gets.
  return { published: input.album };
}
```

Each task runs in a Node process of its own, held as build steps are: it reads only its own package, `node_modules` and what it declared in `read`, writes nothing, starts no other processes, and gets only the secrets it declared. Its input and answer are JSON, at most 32,000 and 512,000 characters.

- **On GitHub**, the starters' `.github/workflows/plugin-task.yml` runs it, started by a `repository_dispatch` event, which any sign-in that can publish can send. Its `task` job runs the site's code with read access only and `${{ toJSON(secrets) }}` in its environment, and a second job, which runs none of it, puts the sealed answer on a branch of its own, `goodfellow-task-<request>`, which the admin panel reads and deletes. Add the secrets under the repository's **Settings → Secrets and variables → Actions**.
- **On GitLab**, the starters' `.gitlab-ci.yml` has a `plugin-task` job, run in a pipeline the admin panel starts with the request's variables, whose artifact holds the sealed answer. Add the secrets under **Settings → CI/CD → Variables**, masked, and protected, since tasks run on the main branch.
- **On Bitbucket**, the site's `bitbucket-pipelines.yml` has a `plugin-task` custom pipeline, which the admin panel starts with the request's variables, and which puts the sealed answer on a branch of its own, `goodfellow-task-<request>`, which the admin panel reads and deletes. Add the secrets under **Repository settings → Pipelines → Repository variables**, with **Secured** ticked. Bitbucket gives every pipeline step every repository variable, not only the ones a task declared, so the task itself still gets only those, but the site's other pipelines could read the rest. Each task uses a minute or so of the workspace's build minutes.
- **Sites made before tasks** copy `plugin-task.yml`, or the `plugin-task` job and the `rules` line it adds to the `pages` job, from the starter. Without them, the admin panel says the site's setup can't run tasks yet.
- **In `goodfellow dev` and `next dev`,** tasks run on your computer, with the site's `.env.local` (read as each task runs, and ignored by git) and the development server's environment as their secrets.
- **On full-stack sites,** tasks run in the site's CI as on any other, through the site's server, which passes the sealed answer on. A plugin can offer a server module that does the same work straight away with secrets in the server's environment, as S3 storage does.
- **Sites whose content is in a repository of its own** can't run tasks yet, since the content repository's CI doesn't have the site's code.

## Keeping media

A plugin with `mediaStorage` keeps the site's media outside the repository, in place of `public/media/`. Its admin module's `media` answers the [Media screen](/docs/media#media-kept-in-a-storage-service):

```ts
export default definePluginAdmin({
  media: {
    // Whether it can take files now, or what needs doing first, with a screen of its own to do it on.
    async ready(api) {
      return { ready: true };
    },
    // Keeps files at their addresses, all together, since each batch may wait for a task.
    async upload(files, api) {},
    // Removes files the site no longer lists.
    async remove(addresses, api) {},
  },
});
```

Its screens turn it on by publishing `content/media-storage.json` (declared in its `files`), with the plugin's name and the public address it keeps files at. The admin panel then lists every file it keeps there, by the `/media/…` address content uses, and builds show those files from that address, so pages never change when the site's media moves. The Media screen offers to move the site's own files to it and back, and the Plugins screen won't remove it while it keeps files the site shows.

## A page editor of its own

A plugin with `editor` offers a page editor of its own, such as one people already know from elsewhere. Each person editing the site chooses it, or the standard editor, from **Editor** in the editor's header, and their browser remembers the choice. It edits pages unless it lists other `kinds`: `"header"`, `"footer"` and `"template"` (collections' templates) are the others. Items' fields are always edited in the standard editor.

```ts
definePlugin({
  name: "goodfellow-plugin-outline",
  title: "Outline",
  admin: "goodfellow-plugin-outline/admin",
  editor: { title: "Outline editor", kinds: ["page", "header", "footer"] },
});
```

Its admin module's `editor` draws the editor in the plugin's frame, sandboxed away from the admin panel's sign-in like every plugin's frame, which fills the space Puck would. The frame has the admin panel's colors and font, but none of the spacing and plain styles a screen's frame has, since what an editor draws is its own, and the site's blocks among it. Its policy also lets it load the theme's Google Fonts, as the standard editor's frames do. The admin panel keeps the header: Publish, Add to draft, the AI assistant, and Undo and Redo where the editor has them.

```ts
export default definePluginAdmin({
  editor: {
    mount(element, session, api) {
      // session.data is what's edited, as Puck keeps it: the page's settings (root.props) and its
      // blocks, with blocks inside blocks in their slots. session.blocks are the blocks it may use,
      // with their fields as JSON; session.root the page settings' fields.
      // Say what's edited whenever it changes, so the admin panel knows there's something to publish:
      session.change(data, { past: true, future: false, selected: "Heading-1" });
      // Choose media from the media library, and see how a link to the page looks when shared:
      // await session.chooseMedia("image");
      // await session.sharePreview(data.root);
      // Have a block drawn as the site draws it, and the site's styles to show it with:
      // const html = await session.draw(data.content[0]);
      // const { stylesheets, tailwind } = await session.styles();
      // And turn pasted HTML into the site's blocks, with htmlBlocks() from @goodfellow-cms/core/wordpress.
      return {
        data: () => data, // what Publish publishes; without it, the last change()
        set: (next) => {}, // takes the AI assistant's changes; without it, the AI assistant isn't offered
        undo: () => {},
        redo: () => {},
      };
    },
  },
});
```

The session also carries the page's `kind`, `path`, `title` and `language`, the site's settings, its pages for links, and for a template, the collection whose fields its `{name}` placeholders fill in. The editor never sees the site's blocks' code, only their fields.

To show blocks as they look on the site, it asks for them to be drawn:

- **`session.draw(block)`** gives one block's HTML, drawn by the site's own code in a frame of the admin panel's, in the page being edited, as the site's pages have it before their scripts start. Each of the block's slots is left as an empty `<gf-slot data-slot="…">` (`DRAWN_SLOT_ELEMENT`), with the slot's name, where the slot's blocks go, and the blocks in it aren't drawn: the editor draws those itself, into those places, so each stays the editor's to select and move. Give the places `display: contents`, so the blocks in them are laid out by the block around them, as in a grid of columns. Only the blocks the editor may use are drawn.
- **`session.styles()`** gives what to style what's drawn with: `stylesheets`, the site's stylesheets as CSS text, as its last build compiled them, with the theme's colors and fonts as they are now; and `tailwind`, Tailwind's source for the site (the theme's classes and the custom CSS as it is now). Classes the site's build hasn't seen yet, such as ones an editor just chose, aren't in the stylesheets: compile `tailwind` with `@tailwindcss/browser` in a `<style type="text/tailwindcss">` where blocks are shown, as the admin panel's own previews do. The stylesheets name the theme's fonts without loading them: `fonts`, where the theme uses Google Fonts, is their stylesheet's address, to load with a `<link rel="stylesheet">`.

Content names media files as `/media/…`, and so do drawn blocks. Leave those addresses as they are: the admin panel shows the site's media in the editor's page itself, as it does in the standard editor, so `/media/…` addresses in images, links, posters and inline styles anywhere in it are shown from wherever each file is now: the site's folder on a site in a folder of its domain, the browser's memory for a file just uploaded that the site doesn't have yet, or the storage a plugin keeps the site's media in. Text edited in place (`contenteditable`) is left as it is, so what's read back from it keeps content's addresses. Releases of Goodfellow that do this say so with `session.showsMedia`; on older ones, add the site's address (`api.siteUrl`) to what's shown yourself.

Pasted HTML becomes the site's blocks with `htmlBlocks(html, { blocks })` from `@goodfellow-cms/core/wordpress`, the WordPress import's own conversion: WordPress's block markup, which copying from its editor gives, by its blocks, and any other HTML by its elements, leaving out scripts and anything else that would run code. Give it the site's blocks (`Object.keys(session.blocks)`), so WordPress's blocks the site doesn't have come across as the ones it does would show them, and `link` and `media` to change addresses as the site keeps them. It answers with the blocks, without a Section around them, each with an id of its own, and `notes` saying what couldn't come across as it was.

What it hands back is checked before anything is published: only the site's blocks (template-only blocks only in templates), each value fitting its field or left as it was (where a block's choices depend on what it's set to, as a Collection list's choice of its collection's fields does, any plain value), every block with an id of its own, and nothing a block doesn't have unless it was already there, unchanged, when the editor opened. Anything else isn't published, and the admin panel says so, naming each block and setting. Switching back to the standard editor keeps what was edited, when it passes the same check.

Installing an editor plugin from the Plugins screen says it offers a page editor, since it's given what people edit in it, and an installed plugin that later asks to edit another kind of page needs approving again.

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
- **A build step's or task's network requests** aren't limited: Node's permission model covers files, processes and workers, not the network. The packages it loads share its process and what it was given. Node calls its permission model a seat belt, not a sandbox: it keeps a step or task to what it declared by mistake, not one written to get around it.
- **Blocks on the site's pages** run with everything visitors' browsers allow, like any block, since pages have no Content Security Policy.
- **A sandboxed frame can leave for another address**, so a plugin's policy limits what its admin module can send while it's there without sealing it. Its sandbox is what keeps it from the admin panel's sign-in.

So read a plugin's code, or trust its publisher, before adding one whose server module or build steps you'd rely on the declarations of.

## Publish a plugin

Publish it to npm as `goodfellow-plugin-<name>`, with the `goodfellow-plugin` keyword, and keep it in a repository of its own, called the same, with the `goodfellow-plugin` topic on GitHub or GitLab. Say which Goodfellow releases it works with as a `peerDependencies` range on `@goodfellow-cms/core`, and publish from GitHub Actions or GitLab CI with [npm's provenance](https://docs.npmjs.com/generating-provenance-statements).

For owners to install it from the admin panel, its package's default export is the plugin itself (`export default definePlugin({ … })`, with no options to pass), and its root has a `goodfellow-plugin.json` saying what it does, which the admin panel shows before installing it. Write it with `pluginManifest()` from `@goodfellow-cms/core`, so it's always what the plugin declares:

```js
import { writeFileSync } from "node:fs";
import { pluginManifest } from "@goodfellow-cms/core";
import plugin from "./dist/index.js";

writeFileSync("goodfellow-plugin.json", `${JSON.stringify(pluginManifest(plugin), null, 2)}\n`);
```

Every site that uses it serves its admin frame, so the code bundled into it is distributed with each one, under its license. Builds write the notices (see [In the build](#in-the-build)) from each package's `package.json` and license files, so give the plugin a `license`, a `repository` and a `LICENSE` file.

The manifest lists the plugin's title, description and permissions, and whether it has blocks (by name), an admin module, screens, build steps, tasks, a server module and media storage. A site that installed a release runs it only while it asks for no more than that.
