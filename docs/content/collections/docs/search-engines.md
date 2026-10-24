---
version: 1
title: Search engines and feeds
description: What search engines are told about the site, hiding a page from them, how links look when shared, and feeds of news.
section: editors
order: 2.7
---

Search engines find the site's pages through its sitemap, and read each page's title and description. Goodfellow also tells them what a page is about, in a form they understand, and gives news-like collections feeds that people can follow. Everything here needs the site's address, under **Site Settings → General → Site address**, since search engines and feed readers need full addresses.

## A page's settings

Click outside every block in a page's editor to see its own settings:

- **Page title**, shown in the browser's tab and in search results.
- **Description for search engines**, shown under the title in search results and in link previews. Without one, the site's description from Site Settings is used.
- **Image when shared**, shown in link previews. Without one, the image from Site Settings is used.
- **Search engines:** pages are in search results unless you choose **Hide from search results**, which asks search engines to leave the page out, and leaves it out of the sitemap. The page is still on the site, for anyone with its address, and in the site's own search; it isn't private. **Page not found** is always hidden from search results, so its setting can't be changed.

Below them, **When a link to this page is shared** shows how a link to the page looks in a message or on social media, as you edit them: the image, the title as browser tabs show it, the description and the site's address. A collection's page design has the same settings, which its items' pages share.

## What search engines are told

Pages carry structured data, in the [schema.org](https://schema.org) vocabulary search engines share, which some of them use to show results in more detail:

- **The home page** describes the site, and the organization behind it, with the logo and the contact details from Site Settings.
- **Events** in a [calendar collection](/docs/calendars) are described as events, with when they happen in the site's time zone (the next time, for ones that repeat), where, and their summary.
- **Dated items**, such as news, in a collection with a date field, are described as articles, with the date, the summary and the first picture.

Other pages, and pages hidden from search engines, have none. There's nothing to set: it's worked out from the site's settings and the collections' fields when the site is built.

On a site in [several languages](/docs/languages), each page also links to its translations with `hreflang`, and the sitemap lists them with each page, so search engines show people the page in their own language. Each language's home page describes the site in that language.

## Feeds

Each collection whose items have pages and a date field, such as news, has a feed, which feed readers and other sites follow to see new items as they're published: an RSS feed at `/feeds/<collection>.rss` and an Atom feed at `/feeds/<collection>.atom`, such as `/feeds/news.rss`. They list the newest 50 items, each with its title, date, summary (or the start of its text) and link. Every page names the RSS feeds, so feed readers find them from the site's address alone.

Calendar collections have [calendar files](/docs/calendars#adding-to-calendars-and-subscribing) instead, which calendar apps follow. Items [scheduled](/docs/scheduling) for later join the feed when they're shown.
