---
version: 1
title: Visit counts
description: Count your site's visits with Plausible, Umami or GoatCounter, which keep no cookies, set up in Site Settings, waiting for visitors' agreement where the site asks first.
section: owners
order: 1.6
---

A Goodfellow site has no server to count visits on, so it counts them with a service that does, in place of pasting a tracking script under **Code**. Goodfellow sets up three, all of which count visits without cookies and without following visitors from site to site:

- **[Plausible](https://plausible.io)**, a paid service with a free trial, or free software you run on a server of your own.
- **[Umami](https://umami.is)**, whose Umami Cloud has a free plan, or free software you run on a server of your own.
- **[GoatCounter](https://www.goatcounter.com)**, free for sites that aren't businesses' and with a modest number of visits, or free software you run on a server of your own.

Each keeps the counts on its own dashboard, which the admin panel links to; the counts aren't shown in the admin panel itself.

## Set it up

1. Make an account with the service and add your site there. Each gives you a short piece of code to put on your pages, starting with `<script`.
2. In the admin panel, open **Site Settings**, then **Visit counts**.
3. Choose the service, and paste its code. You can paste less: Plausible's domain for the site, such as `example.org`; Umami's website id; or GoatCounter's code, such as `stjoseph` for `stjoseph.goatcounter.com`, or the address of a GoatCounter of your own.
4. If you pasted the newer code Plausible gives each site, with an address ending in `pa-….js`, also type the site's domain as Plausible shows it, which names its dashboard.
5. Choose **Start counting**. Pages count visits once the site has been rebuilt, a minute or two later.

**Open Plausible's dashboard** (or Umami's, or GoatCounter's) then opens the service's dashboard in a new tab. **Change** pastes other code, or chooses another service, and **Stop counting** takes the script off every page.

Only the service's own script is added, from an `https://` address; it never runs in the admin panel, its previews, or `goodfellow dev` and `next dev`, so the counts are only real visitors'. "Page not found" isn't counted. On a Next.js site, moving from page to page counts each page, as it does on any other site.

## Visitors' consent

On a site that [asks visitors before showing content from other sites](/docs/layout-and-settings#visitors-consent), counting waits until visitors allow statistics: the notice asks about them on their own, with **Choose**, and visitors who say no aren't counted. These services keep nothing in visitors' browsers and don't follow them elsewhere, so some places' rules don't ask for agreement to them; where yours don't, turn off **Count only visitors who agree**, and visits are counted on every page straight away, without the notice asking about them. Whether a site needs to ask depends on where it and its visitors are; check before turning it off, and say what's counted on your privacy page.

On a site that doesn't ask, visits are counted straight away.

## Other services

For any other service, such as Google Analytics, paste its code in **Site Settings → Code** instead, and say what it's for there, so a site that asks visitors waits for the right answer; see [Layout and settings](/docs/layout-and-settings#site-settings).
