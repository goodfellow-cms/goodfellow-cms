---
version: 1
title: Collections
description: Groups of similar pages, such as news, events, or staff, with their own fields and one shared design.
section: editors
order: 3
---

A collection is a group of similar items, such as news stories, events, videos, or staff. Each item is a set of fields, and every item's page shares one design, so adding an item is just filling in a form.

## Create a collection

On the **Collections** screen, click **New collection** and give it a name ("Events") and a name for one item ("Event"). Choose whether items have pages of their own, and their address, such as `/events/{slug}`, where `{slug}` is each item's name. Changing the address later, or an item's name, changes every link to their pages on the site to match. On a [full-stack site](/docs/full-stack-nextjs#pages-for-members), a collection can keep its items and their pages to signed-in members.

## Fields

Under **Settings**, choose the collection's fields:

| Type | Holds |
|---|---|
| Short text | A line of text, such as a speaker's name |
| Long text | Several lines, kept as typed |
| Formatted text | Paragraphs, headings, lists, links |
| Number | A number, such as an order or a price |
| Date | A calendar date |
| Date and time, for events | When an event starts and ends, and how it repeats (see [Calendars and events](/docs/calendars)) |
| Link | A web address, a page's address, or an uploaded file |
| Image | An image from the media library |
| Choice from a list | One of a set of choices, such as a category |
| Tags | Any number of a set of choices, such as a story's topics |
| Yes or no | A tick box, such as "Featured" |
| Link to items in a collection | One item of another collection, or several, such as a talk's speakers |
| Several images | Images from the media library, in order, such as an event's photos |
| File | A file from the media library, such as a PDF to download |
| Repeating group | Rows of a few fields of their own, such as a day's schedule with each time, title, and place |

Every collection has a **Title** field. Fields can be required, have a hint for editors, and be reordered. Removing a field removes its values from every item in the same publish, and so does removing a choice or a tag.

### Links to items

A **Link to items in a collection** field names the collection it links to, which can be its own, and whether it holds one item or several. Editors find items by typing part of their titles. Pages show the items' titles, each linking to its page where the collection gives items pages, and to its translation on a page in another language; in braces, such as `{speakers}`, the titles go in as words.

Links follow the items they name: renaming an item changes every link to it in the same publish, and deleting one lists the items that link to it and takes it out of their links. A collection can't be deleted while another collection's fields link to its items. The [site checks](/docs/publishing#site-checks) stop a publish with a link to an item that isn't there, such as one deleted outside the admin panel.

### Repeating groups

A **Repeating group** has fields of its own, up to ten, each a short or long text, number, date, link, image or yes or no. Editors add, reorder, and remove its rows on each item. On the page, the **Item field** block shows each row's values one after another; in braces, rows go in as words, values joined with " · " and rows with "; ".

Settings also choose the order items are listed in, such as newest first, and whether items are events that calendars show.

## The page design

**Page design** opens the editor on the page every item shares. Use the **Item field** block to show one of the item's fields, or type a field's name in braces in any text, such as a heading reading `{title}` or a button linking to `{video}`. In rich text and in Custom HTML, an item's values go in as text, never as HTML, so whoever writes an item can't change the page's markup. Blocks such as **Previous and next** only make sense here, so the page editor doesn't offer them.

## Items

The collection's **Items** tab lists them. Adding one (**Add Event**, say) asks for a title and a name for its address; the editor then shows the item's fields beside a preview of its page.

To show items on other pages, add a **Collection list** block, which shows them as a list or cards, newest first or upcoming only, as many as you choose, and on pages of their own, or a **Collection loop** block, which shows blocks you design for each item. See [Showing collections](/docs/showing-collections).

## Items from another system

A collection's items can come from somewhere other than the admin panel, such as the site's own database, a spreadsheet, or a shop, so the site shows them without anyone copying them over. The collection is made and designed in the admin panel as any other, with its fields, its page design, and its address; only its items come from the other system, where they're edited, and the admin panel shows them read-only. A developer sets it up, with a **source**: a module whose default export reads the items, named in `goodfellow.config.tsx`:

```ts
// lib/jobs.ts
import { defineCollectionSource } from "@goodfellow-cms/core";
import { db } from "@/lib/db";

export default defineCollectionSource<{ table: string }>((options) => ({
  // Every item, as an item's file would hold it: its name in the collection, and its fields' values.
  items: async () =>
    (await db.selectFrom(options.table).selectAll().execute()).map((row) => ({
      slug: row.slug,
      fields: { title: row.title, posted: row.posted, about: row.description },
    })),
}));
```

```ts
// goodfellow.config.tsx
export default defineConfig({
  blocks,
  collections: { jobs: { source: "./lib/jobs.ts", options: { table: "jobs" } } },
});
```

- **Items are checked as files are:** a value that doesn't fit its field, a name that can't be an address, a name given twice, or an address a page already has leaves that item out, with a warning in the build's or the server's log, so one bad row never stops the site. Only the values of the collection's own fields are kept, so a row's other columns, such as notes or applicants' addresses, never reach the site's pages, its content API, or the admin panel. A source that can't be read at all, such as a database that doesn't answer, stops the build, or the page being rendered, rather than show the collection empty. A full-stack site's server that has read it before shows the items it read last, with a warning in its log, and keeps showing the pages it rendered before. In the admin panel, the collection's items tab says so, with **Try again**, while other collections' items still show. A change to the collection's settings waits until its items can be read again, since they're checked against the new settings; anything else can be published meanwhile, without checking links that could go to its items' pages. While its items can't be read, as always on a static site, a new or moved page or item can't take an address one of its items could have, unless the address pattern is only the item's name, such as `/{slug}`, where a page wins over an item with its address and the build leaves the item out with a warning; moving a page leaves links to such addresses under it as they are. A change to the collection's settings that an item no longer fits, such as a removed choice it uses, names the items it would leave out; they can be published without them, and show again once they're changed to fit. Items can have `inLanguage`, `translationOf`, `showFrom`, and `hideAfter`, as items' files do. `goodfellow due` and `goodfellow-next due`, the hourly check for scheduled changes, read the sources too, so an item's `showFrom` rebuilds the site; where the check can't read a source, such as where it doesn't have the source's secrets, it leaves that collection's items out, with a warning, and they show at the next build.
- **Where it's read:** `goodfellow build` and `goodfellow dev` load the module through Vite, and `goodfellow-next finish` and `next dev` load it in Node for feeds, calendars, the content API, and its checks. Item files left in the collection's folder aren't read or checked, since the source's items take their place; remove them anyway, since tools that don't load the site's code, such as imports and exports, still read them. `source` is a path from the site's folder or a package's export, such as `goodfellow-plugin-airtable/source`. A source that opens connections, such as a database pool, can give a `close()`, which commands such as `goodfellow build` and `goodfellow due` call once they're done, so they don't keep running, and the development servers call when the source's code or options change. A Next.js site's pages are rendered by Next.js, which needs the module imported: pass it to `goodfellowPages()`, and to `goodfellowApi()` on a full-stack site, as `sources: { jobs: jobsSource }` (see [Collections from a database](/docs/full-stack-nextjs#collections-from-a-database)). The site's description names the module, but never its options.
- **When changes show:** a static site shows the items it read when it was built, so build it again, such as each night, to show changes. Its admin panel can't read the items, so it lists none, publishing doesn't check links that could go to their pages, and the collection's address can't be changed there, since links to its items couldn't follow. A full-stack site shows them as its pages render again.
- **Not in version history:** the items aren't in the site's repository, so Version history and Download a copy don't cover them. The collection's settings and design are, as any collection's.
- **Claude:** [Claude's tools](/docs/claude) read the repository, not the site's code, so they list no items for the collection, say where its items come from, won't add, change, or delete one, and won't put a page or item at an address one of its items could have. Publishing a draft doesn't check links that could go to its items' pages.

## Storing items as Markdown

A collection can store its items as Markdown files instead of JSON. Turn on **Store items as Markdown files** in its settings and choose which formatted-text field is the file's text; the other fields are saved at the top of the file. Changing the setting converts every item in the same publish.

Markdown is a plain-text format that developers can edit in their own tools, and review easily when it changes. In the admin panel it's edited as before, in the formatted editor, or as Markdown in the **Markdown** tab. Text the formatted editor can't show, such as a table or a picture, can only be edited in the Markdown tab, so nothing is lost. These docs are a collection stored this way.

In Markdown text, HTML is shown as text rather than run, and code blocks are highlighted:

````md
```sh
npm run dev
```
````
