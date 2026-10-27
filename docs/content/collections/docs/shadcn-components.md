---
version: 1
title: Any shadcn component as a block
description: goodfellow blocks add installs a shadcn registry item with shadcn's own CLI and makes a block of it, with fields from its props, saying what it couldn't do.
section: developers
order: 3.5
---

Goodfellow's block registry has blocks built with shadcn/ui, and the admin panel's [Blocks screen](/docs/add-blocks) adds them without a developer. For any other shadcn component, from shadcn/ui itself or from another registry, a developer runs:

```sh
npx goodfellow blocks add button
npx goodfellow blocks add @shadcnblocks/hero1
npx goodfellow-next blocks add accordion   # in a Next.js site
```

The command installs the item with shadcn's own CLI, makes a block of its component with fields from its props, checks the block, and lists what it couldn't do, rather than calling the block finished. It's recorded as the Blocks screen's blocks are, so the screen lists it and can remove it. Restart `goodfellow dev` to see it in the editor.

## What it needs

The command reads components' code with TypeScript 7's checker, which sites don't have unless they ask for it:

```sh
npm install --save-dev typescript@7.0.2
```

Next.js sites keep TypeScript 5 for `next build`, so they install TypeScript 7 under another name, which the command looks for too:

```sh
npm install --save-dev typescript-7@npm:typescript@7.0.2
```

It runs shadcn's CLI with `npx`, at the release it was tried with, so the computer needs to reach npm and the item's registry. shadcn asks before it replaces a file that's different from the item's. The command passes those questions on to you.

## What it does

1. **Installs the item** with `shadcn add`. The item's own files go where `components.json` says, its shadcn dependencies come with it, and any packages it needs are added to `package.json`, which the command lists. Commit `package-lock.json` with them. Files of kinds that aren't part of a page, such as an example's `page.tsx`, are left out.
2. **Makes the block** in `blocks/installed/<name>/block.tsx`, from the component's own props, leaving out the HTML attributes it passes on:
   - Unions of words, cva's variants among them, become choices.
   - Yes-or-no props become yes or no.
   - Words and numbers become text and number fields, and a picture's address gets the media library's chooser.
   - Objects and lists of them become groups and lists of fields.
   - `children` becomes the label of a button, a link or a label, and blocks inside anything else. It's left out where the component never shows it.
   - `className` gets the block's classes.
   - Defaults come from the component's code: a `defaultProps` object, defaults in its parameters, and cva's `defaultVariants`.
   - Components that aren't page sections, such as a button, sit in a wrapper with the registry blocks' spacing.
3. **Checks it.** It typechecks the block, and renders it with its defaults on a page of the site, as `goodfellow build` would (`goodfellow-next blocks add` renders it in Node). The accessibility checks then run on what it rendered. It also reads the item's code for the [rules blocks follow](/docs/write-blocks#rules): `<a>` and `<img>` in place of `SiteLink` and `SiteImage`, `next/link` and `next/image`, and hooks without `"use client"`.

It ends by listing what it did, then what's left. **It doesn't work yet** means the block doesn't typecheck or render, and the command exits with an error. **Left to do by hand** is everything else it noticed. The block's file starts with the same list, so whoever opens it next sees it too. Change the file as you like: the command doesn't write it again, and the Blocks screen removes it only while it's unchanged.

## What it can't do on its own

- **Words, links and pictures in the component's code** have nothing to make fields from. Change the component to take them as props, and give the block fields for them.
- **Parts that only work together**, such as an accordion's, share React context, which islands don't (see [Interactive blocks](/docs/interactive-blocks)). So the block shows shadcn's example of them (`<item>-demo`), copied into the block's folder as one Client Component. Its words are in its code, so make fields of them by hand, as Goodfellow's FAQ block does. Accordions, collapsibles and tabs also leave closed parts out of the page unless their content has `forceMount`, so search engines don't see them, and the command says so.
- **Props no field can hold**, such as an icon (`ReactNode`) or what happens on a click, are left out and listed. A component that needs one doesn't typecheck until it gets it.
- **App UI**, such as sign-in forms and dashboards, gets a warning: a static site has nothing behind its forms.
- **Other registries' licenses**: an item that names its own license, as many third-party registries' do, has it listed, to read before the block goes on a site.

## Client Components

shadcn drops `"use client"` from what it installs where `components.json` says `"rsc": false`. Goodfellow runs Client Components in the browser only where they say it, so interactive components installed that way render on the page but never respond. Sites made before this release have `"rsc": false`. The command sets it to `true`, as new sites have it, and says so. Set it yourself before running `npx shadcn add` directly.

## As a registry

With `--registry <folder>`, the command writes the block into a [block registry](/docs/block-registries) in that folder rather than into the site: its file, and the item's own code, in the registry's `registry.json` with `meta.goodfellow`. That way an organization can make its own components into blocks once, for every site's Blocks screen. The item's shadcn dependencies stay dependencies, so sites need the registries they come from (`@shadcn` for shadcn/ui's) in their config's `registries`. Packages beyond the ones sites have can't be installed from the admin panel (see [Packages](/docs/block-registries#packages)).
