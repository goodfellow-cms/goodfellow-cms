---
version: 1
title: Content API
description: Builds write the site's content as static JSON at /api/, each page as it's shown, for apps and other sites to show without a server.
section: developers
order: 4.5
---

`goodfellow build` and `goodfellow-next finish` write the site's content as JSON files at `/api/`, beside its pages, so an app or another site can show it without a server. It's what visitors see, not the [content files](/docs/content-files) as they're stored:

- Pages and items that aren't [scheduled](/docs/scheduling) to show yet are left out, as they are from the site.
- Each page has its blocks as the page renders them: after every block's preparation (`resolveData`), with an item's values filled into its collection's template.

Both renderers write the same files, and a test checks that they do.

## The files

Start with `/api/manifest.json`. Every other file's address in it is relative to the manifest, and each comes with a hash of its text. To keep a copy up to date, read the manifest again and download only the files whose hash changed.

| File | What it holds |
|---|---|
| `manifest.json` | The Goodfellow release (`goodfellow`), the version of each kind of content file the site reads (`content`), `base`, `url`, `mainLanguage`, each language's files (`languages`), every page with its file and hash (`pages`), and the blocks the site's pages, headers and footers use (`blocks`). |
| `pages/….json` | One page, named from its address: `/` is `pages/index.json`, `/news/fair` is `pages/news/fair.json` and Spanish's home page is `pages/es.json`. It holds its `path`, `language`, `head` (the title as the browser shows it, description, social image, `noIndex`, the canonical address and translations), `entry` on an item's page, `view` on a page a block adds, such as a calendar's month, `data` (its blocks, as Puck stores them), `richText` (see below) and `credits` for the photos it shows. |
| `site.json` | The site's settings, menus and pages (the same list the Page list block shows), as blocks read them with `useSite()`. |
| `collections.json` | Every collection's settings, without its template, and its items' values. |
| `header.json`, `footer.json` | The header and footer, prepared as they're shown on every page. |

A site in [several languages](/docs/languages) has `site.json`, `collections.json`, `header.json` and `footer.json` for its main language at `/api/`, and for each other language under its code, such as `/api/es/site.json`, with only that language's items. Pages are all in `pages/`, since their addresses already say their language. `pages/404.json` is "Page not found", to show for an address the site doesn't have.

Addresses in the files, such as links and pictures (`/about`, `/media/photo.jpg`), are from the site's root, without the path a site in a subfolder is served from. That path is the manifest's `base`. Add it, and the site's domain, before loading a picture or opening a link.

The manifest's `pages` includes pages that blocks add, such as a list's second page (`added: true`), and items' pages (`entry`).

## Rich text

Rich text is sanitized HTML, as pages have it, wherever a block's field holds it. An item's Markdown body in `collections.json` is HTML too. For an app that draws content without an HTML renderer, each page, header and footer file also has `richText`: the same rich text as a simple structure, by the id of the block it's in (`root` for the page's settings), then by prop. A prop inside a list or a group is named with dots, such as `items.0.text`.

```json
{
  "Text-1": {
    "text": [
      { "type": "heading", "level": 2, "children": [{ "type": "text", "text": "Mass times" }] },
      {
        "type": "paragraph",
        "children": [
          { "type": "text", "text": "Come " },
          { "type": "text", "text": "early", "bold": true },
          { "type": "text", "text": "read more", "link": "/about" }
        ]
      }
    ]
  }
}
```

Parts are paragraphs, headings (with `level` and the `id` Markdown's headings have), `quote`, `list` (`ordered`, `start` and `items`, each a list of parts), `code` (`code` and its `language`), `image` (`src`, `alt` and a `caption`), `rule` and `table` (`rows`, each with `header` and `cells`). Within a line, text has `bold`, `italic`, `underline`, `strike`, `code`, `superscript` and `subscript` where they're on, and `link` and `newTab` where it's a link, beside line breaks (`break`) and pictures. An item's page has its Markdown body this way too, under the Entry field block's `markdown` prop. `collections.json` gives each item's rich text and Markdown fields the same way, under the item's `richText`.

`@goodfellow-cms/core/content-api` has the files' types (`ApiManifest`, `ApiPageFile` and the rest) and `richTextNodes()`, which turns HTML into these parts.

## Reading it from another site

Apps can read the files from anywhere. A page on another site can read them in visitors' browsers only where the host allows it:

- **GitHub Pages** allows it for every file.
- **Cloudflare Pages** allows it with a rule in the site's own `public/_headers`:

  ```
  /api/*
    Access-Control-Allow-Origin: *
  ```

- **Vercel** allows it with the same header in its `headers` settings.
- **GitLab Pages** doesn't allow it, so the other site reads the files when it's built, not in visitors' browsers.

## Turning it off

The content API shows nothing the pages don't, so it's on by default. For a site that doesn't want its content read as data, set `api: false` in `goodfellow.config.tsx`, and builds leave it out:

```tsx
export default defineConfig({
  blocks: { ...blocks, ...installedBlocks },
  api: false,
});
```

`goodfellow dev` and `next dev` don't serve it. Run a build, then `npx goodfellow preview`, to try it on your computer.
