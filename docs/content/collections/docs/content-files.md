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
| `content/media.json` | Credits for media files, such as photos the AI assistant found, by address |
| `content/layout/header.json`, `footer.json` | The header and footer, as Puck data |
| `content/pages/about.json` | The page at `/about`, as Puck data; `index.json` is a folder's own page |
| `content/collections/<id>/_collection.json` | A collection's settings, fields and page design |
| `content/collections/<id>/<slug>.json` or `.md` | One item: its field values |
| `content/styles/custom.css` | The custom CSS from Site Settings |
| `public/media/` | Uploaded images and files, served at `/media/` |

Every JSON file has a `version`, and is written with two-space indentation, keys in a fixed order and a trailing newline, so changes read well in a diff. If you edit one by hand, run the build, which reports any file that doesn't fit, with what's wrong.

## Collections

A collection's `_collection.json` has its `name`, `entryName` (what one item is called), its `fields`, an optional `path` such as `/events/{slug}` for items' pages, an optional `sort`, and its `template`, the page design. Every collection has a text field named `title`. A field's `name` is what content refers to, so it never changes once items use it.

An item's JSON file holds `{ "version": 1, "fields": { … } }`. A choice field (`select`) holds one of its `options`' values, and a tags field (`tags`) a list of them, such as `["music", "youth"]`.

## Scheduled pages and items

A page's or item's file can say when it's on the site, beside its `version`: `showFrom`, when it's first shown, and `hideAfter`, when it's hidden again, each a wall-clock time `YYYY-MM-DDTHH:MM` in the site's `timeZone` (UTC without one). Either can be left out, and `hideAfter` must come after `showFrom`. A Markdown item has them in its front matter. Builds leave out pages and items their schedule doesn't show at the time they run (see [Scheduled publishing](/docs/scheduling)).

```json
{
  "version": 1,
  "data": { "root": { "props": { "title": "Advent" } }, "content": [] },
  "showFrom": "2026-11-29T09:00"
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
