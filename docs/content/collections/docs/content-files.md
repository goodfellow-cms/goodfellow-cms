---
version: 1
title: Content files
description: The files in content/ that the admin panel edits, including collections and Markdown items.
section: developers
order: 4
---

Everything the admin panel edits is a file in `content/` or `public/media/`, in the site's repository. The format is part of Goodfellow's public interface: it's versioned, and changes come with migrations.

| File | What it holds |
|---|---|
| `content/site.json` | Site Settings: name, address, logo, icons, contact details, theme |
| `content/menus.json` | Navigation menus, by name |
| `content/redirects.json` | Redirects: old addresses, and where they send visitors |
| `content/media.json` | Credits for media files, such as photos the AI assistant found, images' descriptions and focal points, and files' tags, by address |
| `content/media-storage.json` | Where a [plugin keeps media](/docs/media#media-kept-in-a-storage-service): the plugin, the public address it keeps files at, and each file it keeps by its `/media/` address, with its size |
| `content/permissions.json` | What [editors with limits](/docs/sign-in#limiting-what-editors-can-change) may change, by username, and who reviews the rest |
| `content/layout/header.json`, `footer.json` | The header and footer, as Puck data |
| `content/synced-blocks/<name>.json` | A [synced block](/docs/synced-blocks): its title and its blocks, as Puck data; `<name>.<code>.json` is a language's own version |
| `content/pages/about.json` | The page at `/about`, as Puck data; `index.json` is a folder's own page |
| `content/collections/<id>/_collection.json` | A collection's settings, fields and page design |
| `content/collections/<id>/<slug>.json` or `.md` | One item: its field values |
| `content/styles/custom.css` | The custom CSS from Site Settings |
| `content/styles/theme.json` | Which [theme](/docs/themes) is installed, and what it installed, so an update keeps what owners changed |
| `content/admin-text/<code>.json` | The [admin panel in another language](/docs/languages#the-admin-panel-in-other-languages): its words, Puck's and blocks' labels, each with a hash of the English it was made from, and the language pack it came from, if any |
| `public/media/` | Uploaded images and files, served at `/media/`, apart from those a plugin keeps |

Every JSON file has a `version`, and is written with two-space indentation, keys in a fixed order and a trailing newline, so changes read well in a diff. If you edit one by hand, run the build, which reports any file that doesn't fit, with what's wrong.

## Collections

A collection's `_collection.json` has its `name`, `entryName` (what one item is called), its `fields`, an optional `path` such as `/events/{slug}` for items' pages, an optional `sort`, and its `template`, the page design. Every collection has a text field named `title`. A field's `name` is what content refers to, so it never changes once items use it.

An item's JSON file holds `{ "version": 1, "fields": { … } }`. A choice field (`select`) holds one of its `options`' values, and a tags field (`tags`) a list of them, such as `["music", "youth"]`. A yes or no field (`yesno`) holds `true`, and nothing when it's off. A link to items (`item`, with the `collection` it links to and `multiple` for several) holds an item's name, or a list of them, such as `["anna-reyes", "ben-okafor"]`; a translation is reached through the item it translates, so links name the main language's items. Several images (`images`) are a list of addresses, a file (`file`) one address, and a repeating group (`group`, with its own `fields`) a list of rows, each an object of its fields' values, such as `[{ "time": "9:00", "place": "Hall" }]`.

## Editors' limits

`content/permissions.json` names each person with limits by their sign-in name, which compares without case, and what they may change. People it doesn't name have no limits. `reviewers` is who's asked to review changes outside someone's limits; without it, every owner is.

```json
{
  "version": 1,
  "people": {
    "maria": { "pages": ["/news"], "collections": ["events"], "media": true, "languages": ["en"] }
  },
  "reviewers": ["owen"]
}
```

- **`pages`:** page sections by address, each with the pages under it and their translations; `/` is every page.
- **`collections`:** collections by their folder's name: their items, not their settings.
- **`media`, `layout`, `menus`:** the media library, the header and footer with the synced blocks, and the menus.
- **`languages`:** only pages, items, headers, footers and menus in these languages. Without it, every language.

## Pages' settings

A page's `root.props` hold its settings: `title`, `description`, `image` (for link previews), `className` and `noIndex`, which is `true` for a page hidden from search engines (see [Search engines and feeds](/docs/search-engines)). A collection's `template` has the same, which its items' pages share.

## Synced blocks

A [synced block](/docs/synced-blocks) is a file in `content/synced-blocks/`, named for how pages place it: lowercase letters, numbers and hyphens, such as `mass-times.json`. It holds a `title`, for editors, and `data`, Puck data whose `content` is its blocks. Pages, collections' page designs, the header and the footer place it with the `SyncedBlock` block, naming it as its `block` prop:

```json
{ "type": "SyncedBlock", "props": { "id": "SyncedBlock-1", "block": "mass-times" } }
```

Where pages are built, the synced block's blocks go in its place, each with its id after the placement's (`SyncedBlock-1-Heading-1`), so a page that shows it twice has no two blocks with the same id. Another language's own version is `mass-times.es.json`; languages without one show the main language's. A synced block can't place another, and the build reports a page placing one that isn't there.

## Scheduled pages and items

A page's or item's file can say when it's on the site, beside its `version`: `showFrom`, when it's first shown, and `hideAfter`, when it's hidden again, each a wall-clock time `YYYY-MM-DDTHH:MM` in the site's `timeZone` (UTC without one). Either can be left out, and `hideAfter` must come after `showFrom`. A Markdown item has them in its front matter. Builds leave out pages and items their schedule doesn't show at the time they run (see [Scheduled publishing](/docs/scheduling)).

```json
{
  "version": 1,
  "data": { "root": { "props": { "title": "Advent" } }, "content": [] },
  "showFrom": "2026-11-29T09:00"
}
```

## Translations

On a site in [several languages](/docs/languages), a page's file can say which page it translates, `translationOf`, with `translatedFrom`, a hash of that page as it was when it was translated, which tells whether the translation is out of date. An item's file has `inLanguage` too, since an item's language isn't its address. Both go beside `version`, and in Markdown items' front matter.

```json
{
  "version": 1,
  "translationOf": "/about",
  "translatedFrom": "3f1c9a0b5d7e2468",
  "data": { "root": { "props": { "title": "Quiénes somos" } }, "content": [] }
}
```

## Pages blocks add

Some blocks give the page they're on pages of their own, which builds write beside it: a Calendar showing a month at a time a page for each month (`/calendar/2026-11`), and a Collection list or loop its later pages (`/news/page/2`) and a page for each choice of a field (`/news/topics/music`, from the choice's value). These pages aren't in `content/`: they're the same page, showing something else. They never take an address a page or item already has.

## Events

A collection with `"calendar": { "when": "when", "place": "place", "summary": "summary" }` is a calendar: `when` names its event field (type `event`), and `place` and `summary` the fields calendars show beside each event. An event field's value is the site's own wall-clock time, in the time zone `content/site.json` names as `timeZone` (such as `"America/New_York"`):

```json
{
  "start": "2026-10-04T09:00",
  "end": "2026-10-04T10:00",
  "repeat": { "every": "week", "days": ["we", "su"], "skip": ["2026-12-27"], "until": "2027-06-27" }
}
```

`start` and `end` are `YYYY-MM-DD` for an all-day event, whose `end` is its last day. `repeat.every` is `day`, `week`, `month` or `year`, with an optional `interval`; weekly repeats can name `days`, and monthly ones say `on` the start's `date` (the default), its `weekday` of the month (the second Tuesday) or the `last` such weekday. `until` and `skip` are dates.

Builds write each calendar collection as `/calendars/<id>.ics`, and each of its events as `/calendars/<id>/<slug>.ics`, and give a page whose Calendar block shows a month at a time a page for each month (see [Pages blocks add](#pages-blocks-add)).

## Markdown items

A collection whose settings have `"markdown": { "body": "body" }` stores each item as `<slug>.md`: the body field is the Markdown text, and every other field is in the front matter, in YAML, beside the version.

```md
---
version: 1
title: Writing blocks
section: developers
order: 2
---

A block is a Puck component…
```

The Markdown is GitHub-flavored (tables, strikethrough, task lists). HTML in it is shown as text rather than run, and links and images can only use addresses that can't run code. Headings get ids for linking, as GitHub gives them: "Writing blocks" becomes `#writing-blocks`. Code blocks are highlighted when the site is built.
