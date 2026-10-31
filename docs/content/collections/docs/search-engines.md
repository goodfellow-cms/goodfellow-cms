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
- **Search engines:** pages are in search results unless you choose **Hide from search results**, which asks search engines to leave the page out, and leaves it out of the sitemap. The page is still on the site, for anyone with its address, and in the site's own search; it isn't private. **Page not found** is always hidden from search results, so its setting can't be changed. A copy of the site, such as a staging site, can hide every page at once where it's built (see [Staging and production](/docs/staging)).
- **This page's links:** search engines follow a page's links to find more pages, and count them for the pages they lead to. **Ask search engines not to follow them** asks them not to, such as on a page of links you don't vouch for.
- **Text under the title in search results:** **Show none** asks search engines to show only the page's title and address, without any of its text.
- **Picture size when shared:** how links to the page show its image: **Large**, over the title, or **Small**, beside it. Left as it is, it's large where the page or Site Settings has an image.

Below them, **When a link to this page is shared** shows how a link to the page looks in a message or on social media, as you edit them: the image, large or small, the title as browser tabs show it, the description and the site's address. A collection's page design has the same settings, which its items' pages share.

## What search engines are told

Pages carry structured data, in the [schema.org](https://schema.org) vocabulary search engines share, which some of them use to show results in more detail:

- **The home page** describes the site, and the organization behind it, with the logo and the contact details from Site Settings.
- **Events** in a [calendar collection](/docs/calendars) are described as events, with when they happen in the site's time zone (the next time, for ones that repeat), where, and their summary.
- **Dated items**, such as news, in a collection with a date field, are described as articles, with the date, the summary and the first picture.

- **Breadcrumbs:** a page with the [Breadcrumbs](/docs/built-in-blocks#breadcrumbs) block describes the way to it from the home page, which search engines can show in place of the page's address.
- **Questions and answers:** a page with [Questions and answers](/docs/built-in-blocks#questions-and-answers) blocks describes their questions and answers as an `FAQPage`, all of the page's in one. Google shows these only for some well-known government and health sites; other search engines and AI tools read them too.

Other pages, and pages hidden from search engines, have none of the first three. Pages hidden from search engines don't describe their questions and answers either. There's nothing to set: it's worked out from the site's settings and the collections' fields when the site is built.

On a site in [several languages](/docs/languages), each page also links to its translations with `hreflang`, and the sitemap lists them with each page, so search engines show people the page in their own language. Each language's home page describes the site in that language.

Every page also lets search engines show its pictures large in results (`max-image-preview:large`, as Google suggests), and link previews get the site's name, the page's language, the image's description from the [media library](/docs/media) and its size, and, on a dated item's page, that it's an article and its date.

## AI training

**Site Settings → General → Let AI companies use the site's pages to train their models** is on to begin with. Turned off, the site's `robots.txt` asks the crawlers AI companies train their models with to leave it alone: OpenAI's GPTBot, Anthropic's ClaudeBot, Google-Extended, Applebot-Extended, Common Crawl's CCBot, Meta's, ByteDance's and Cohere's. Search engines' own crawlers aren't asked, so the site stays in search results, and neither are the ones assistants use to read a page someone asks them about. Well-behaved crawlers follow `robots.txt`, but it's a request, not a lock: the site's pages are still public.

## Addresses with or without a slash

The addresses the site gives search engines, in each page's canonical link, the sitemap and `hreflang` links, end with a slash, such as `https://example.org/about/`, as most hosts serve the site's pages there. Where the host serves them without one, a developer sets that in the site's code (see [Host anywhere](/docs/any-host#addresses-with-or-without-a-slash)).

## Sites in a subfolder

Builds write `sitemap.xml`, the list of the site's pages, and a `robots.txt` that names it. Search engines read `robots.txt` only at the root of a domain, though, so for a site in a subfolder, such as `https://your-name.github.io/your-site`, they never read the one the build wrote, and `goodfellow build` says so. To have them find the sitemap, do one of these:

- **Give the site a domain of its own** (see [Custom domains](/docs/custom-domains)), which puts it at the root.
- **Name the sitemap yourself**, such as `https://your-name.github.io/your-site/sitemap.xml`, in [Google Search Console](https://search.google.com/search-console) and [Bing Webmaster Tools](https://www.bing.com/webmasters).
- **On GitHub Pages,** make a repository named `your-name.github.io`, whose site is the domain's root, with a `robots.txt` in it that names the sitemap: `Sitemap: https://your-name.github.io/your-site/sitemap.xml`.

## Feeds

Each collection whose items have pages and a date field, such as news, has a feed, which feed readers and other sites follow to see new items as they're published: an RSS feed at `/feeds/<collection>.rss` and an Atom feed at `/feeds/<collection>.atom`, such as `/feeds/news.rss`. They list the newest 50 items, each with its title, date, summary (or the start of its text) and link. Every page names the RSS feeds, so feed readers find them from the site's address alone.

Calendar collections have [calendar files](/docs/calendars#adding-to-calendars-and-subscribing) instead, which calendar apps follow. Items [scheduled](/docs/scheduling) for later join the feed when they're shown.
