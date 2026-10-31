---
version: 1
title: Showing collections
description: Lists of a collection's items anywhere on the site, with tags, pages of their own and designs made in the editor.
section: editors
order: 3.2
---

Two blocks show a collection's items on other pages: **Collection list**, ready to use, and **Collection loop**, for designs of your own. Both are worked out when the site is built, so visitors only get the page, and the site is rebuilt overnight whenever a list such as "coming up" changes, so it stays current.

## Collection list

Collection list shows items as a list or as cards, with each item's picture, date and summary, linking to its page if the collection gives items pages. Its settings choose:

- **Heading**, and a **link beside the heading**, such as "See all" to the page with every item, for a home page section like "Parish news".
- **Only items with** a choice, from a choice or tags field, such as news about music only, or a yes or no field that's on, such as featured stories only.
- **Only the items this one links to**, in a collection's page design: on each item's page, only the items its link field names, such as a talk's speakers. Such a list has no pages of its own.
- **Date**, and **Show** everything, today and later, or before today, for events and other dated items.
- **Order**: the collection's own order, newest or oldest first, A to Z or Z to A, or by any field, lowest or highest first.
- **How many**, such as the three latest stories.

## Pages of items

A list can go on several pages. Turn on **More on later pages**, and **How many** becomes how many go on each page: on a list at `/news`, the second page is `/news/page/2`, with links between them.

A choice or tags field can also give each of its choices a page: choose it in **A page for each choice of**. For a field named `topics`, a story tagged "Music" is listed at `/news/topics/music`, with its own later pages, and the list shows links to every topic, with **All** (or the label you give it) back to the full list. Each page's title says which page it is, such as "News: Music" or "News: Page 2".

Only the first block on a page that adds pages gets them, calendars by the month included; others on the same page show their first page, without links to the rest, and the editor says so on each of them. Items' pages, "Page not found" and the header and footer get no pages of their own. A page that's already at one of these addresses keeps it. Pages a list adds have addresses of their own for search engines, and the site's own search lists only the first, so a story is found once.

Visitors don't sort or filter lists themselves: each list's order and choices are the editor's, and the [Search](/docs/search) block finds the rest.

## Tags

A collection's **Tags** field holds any number of choices from a list, such as a story's topics. Choose its choices in the collection's settings, like a choice field's; editors tick them on each item. Removing a choice removes it from every item in the same publish.

## Collection loop

Collection loop repeats blocks you design once for each item, for layouts Collection list doesn't have, such as staff photos with their names and roles. Add blocks inside it in the editor, and type a field's name in braces where its value goes: a heading reading `{title}`, a text reading `{role}`, or an image whose address is `{photo}`. Each item's values go in their place when the site is built; the editor shows the design once, with the names in braces.

Its settings are Collection list's, for which items and in what order, with pages of their own too, plus how many go side by side, the space between them, and whether each one links to its page.
