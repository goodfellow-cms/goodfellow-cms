---
version: 1
title: Interactive blocks
description: Client Components that run in the browser, with or without Next.js, and what islands can't do.
section: developers
order: 3
---

A block can render Client Components: files that start with `"use client"`, where any React hooks and event handlers work.

```tsx
// blocks/like-button.tsx
"use client";

import { useState } from "react";

export function LikeButton({ label }: { label: string }) {
  const [likes, setLikes] = useState(0);
  return <button type="button" onClick={() => setLikes(likes + 1)}>{label} ({likes})</button>;
}
```

```tsx
// goodfellow.config.tsx
import { LikeButton } from "./blocks/like-button";

export default defineConfig({
  blocks: {
    ...blocks,
    Like: { fields: { label: { type: "text" } }, render: ({ label }) => <LikeButton label={label} /> },
  },
});
```

They run in the browser however the site is built. With `goodfellow build` and `goodfellow dev`, each one a block uses becomes an island: its HTML is in the page as usual, and the page loads React and that component's code to bring it to life. Pages without Client Components load no JavaScript. With Next.js, Next.js runs them.

- **Props** must be plain values: text, numbers, `true` and `false`, and lists and objects of these. A block can't pass a function such as an `onClick` handler, so handlers go inside the Client Component.
- **Content** passed as `children` (or any prop holding JSX) is rendered by the block, and stays as it is in the browser. Client Components in it run on their own.
- **`useSite()`** works in Client Components, so pages with them include the site's settings, menus and collections for the browser.
- **Other packages' Client Components** need re-exporting from a `"use client"` file of the site's: `"use client"; export { Carousel } from "some-carousel";`. Packages of blocks (packages that use `@goodfellow-cms/react`) don't.

Each page with a Client Component loads React, so use HTML and CSS where they're enough: `<details>` for something that opens and closes, `:hover` and `:focus-within` for menus.

The built-in blocks never need React: the Code block's copy button, the Dark mode switch and the Search box each work with a small script of their own. With `goodfellow build` a page has a script only when it has that block, so a page made of built-in blocks loads no React at all. Next.js loads React on every page for its own navigation, and has the scripts in its layout.

## Preact instead of React

React is about 70 kB for each page with a Client Component. Preact runs the same components in a tenth of that, through `preact/compat`, and `goodfellow build` uses it where every Client Component the site has says it works with it:

```tsx
// blocks/like-button.tsx
"use client";

import { useState } from "react";

export const worksWithPreact = true;

export function LikeButton({ label }: { label: string }) {
  // …
}
```

Every interactive block in Goodfellow's [block registry](/docs/block-registries) says so already. A Client Component that doesn't, such as one of the site's own or another package's, keeps the whole site on React, and `goodfellow build` names it. It also renders the islands with Preact while it builds the pages, so the ids `useId()` gives match the browser's. Pages themselves are rendered the same way either way.

Say it only once you've tried the component with Preact: most React components work, but some libraries use parts of React that Preact doesn't have. To keep React whatever the components say, set `preact: false` in the config:

```tsx
export default defineConfig({
  preact: false,
  blocks: { ...blocks },
});
```

`goodfellow dev` always uses React, so try a site that uses Preact with `goodfellow build` and `goodfellow preview` before publishing it. Next.js sites always use React too.

## What islands can't do

Islands have limits that Next.js doesn't:

- **No shared context.** Each island is its own React app, so a Client Component that provides a context can't pass it to Client Components in the content it wraps. Components whose parts share a context, such as an accordion and its items, go together in one `"use client"` file.
- **Content is fixed HTML.** A Client Component can show, hide or move its `children`, but can't look inside them with `React.Children` or `cloneElement`.
- **Fewer kinds of props.** No dates, `Map`s, `Set`s or promises.
- **Every page is a full page load**, so React starts again on each page.

If a site runs into these, build it with [Next.js](/docs/nextjs) instead.
