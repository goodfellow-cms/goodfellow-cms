---
version: 1
title: Collections
description: Groups of similar pages, such as news, events or staff, with their own fields and one shared design.
section: editors
order: 3
---

A collection is a group of similar items, such as news stories, events, videos or staff. Each item is a set of fields, and every item's page shares one design, so adding an item is just filling in a form.

## Create a collection

On the **Collections** screen, click **New collection** and give it a name ("Events") and a name for one item ("Event"). Choose whether items have pages of their own, and their address, such as `/events/{slug}`, where `{slug}` is each item's name. Changing the address later, or an item's name, changes every link to their pages on the site to match.

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
| Repeating group | Rows of a few fields of their own, such as a day's schedule with each time, title and place |

Every collection has a **Title** field. Fields can be required, have a hint for editors, and be reordered. Removing a field removes its values from every item in the same publish, and so does removing a choice or a tag.

### Links to items

A **Link to items in a collection** field names the collection it links to, which can be its own, and whether it holds one item or several. Editors find items by typing part of their titles. Pages show the items' titles, each linking to its page where the collection gives items pages, and to its translation on a page in another language; in braces, such as `{speakers}`, the titles go in as words.

Links follow the items they name: renaming an item changes every link to it in the same publish, and deleting one lists the items that link to it and takes it out of their links. A collection can't be deleted while another collection's fields link to its items. The [site checks](/docs/publishing#site-checks) stop a publish with a link to an item that isn't there, such as one deleted outside the admin panel.

### Repeating groups

A **Repeating group** has fields of its own, up to ten, each a short or long text, number, date, link, image or yes or no. Editors add, reorder and remove its rows on each item. On the page, the **Entry field** block shows each row's values one after another; in braces, rows go in as words, values joined with " · " and rows with "; ".

Settings also choose the order items are listed in, such as newest first, and whether items are events that calendars show.

## The page design

**Page design** opens the editor on the page every item shares. Use the **Entry field** block to show one of the item's fields, or type a field's name in braces in any text, such as a heading reading `{title}` or a button linking to `{video}`. In rich text and in Custom HTML, an item's values go in as text, never as HTML, so whoever writes an item can't change the page's markup. Blocks such as **Previous and next** only make sense here, so the page editor doesn't offer them.

## Items

The collection's **Items** tab lists them. Adding one (**Add Event**, say) asks for a title and a name for its address; the editor then shows the item's fields beside a preview of its page.

To show items on other pages, add a **Collection list** block, which shows them as a list or cards, newest first or upcoming only, as many as you choose, and on pages of their own, or a **Collection loop** block, which shows blocks you design for each item. See [Showing collections](/docs/showing-collections).

## Storing items as Markdown

A collection can store its items as Markdown files instead of JSON. Turn on **Store items as Markdown files** in its settings and choose which formatted-text field is the file's text; the other fields are saved at the top of the file. Changing the setting converts every item in the same publish.

Markdown is a plain-text format that developers can edit in their own tools, and review easily when it changes. In the admin panel it's edited as before, in the formatted editor, or as Markdown in the **Markdown** tab. Text the formatted editor can't show, such as a table or a picture, can only be edited in the Markdown tab, so nothing is lost. These docs are a collection stored this way.

In Markdown text, HTML is shown as text rather than run, and code blocks are highlighted:

````md
```sh
npm run dev
```
````
