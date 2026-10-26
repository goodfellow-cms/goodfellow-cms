---
version: 1
title: Scheduled publishing
description: Showing a page or item from a time, hiding it after one, and when the change goes live on each host.
section: editors
order: 2.5
---

A page or a collection's item can be on the site only from a time, until a time, or both: a notice that appears on the morning of an event, an offer that ends at midnight, a summer timetable that's shown for the summer. You publish it whenever it's ready, and the site shows and hides it on time.

## Scheduling a page or item

On **Pages**, choose **Schedule** beside a page. In an item's editor, the times are at the end of its fields. Fill in either or both:

- **Show from**: the page or item isn't on the site before this time. Leave it empty to show it as soon as it's published.
- **Hide after**: it leaves the site at this time. Leave it empty to keep it.

Then publish. Until it's shown, a page has no address on the site, and an item isn't in lists, calendars or search. Menus leave out links to it, and put them back once it's shown. Links to it elsewhere, such as in a page's text, lead to "Page not found" until then, so add them when it's shown, or schedule the page with the link for the same time.

The home page can't be scheduled, since the site always needs one.

Times are in the site's time zone, which Site Settings sets. If the site doesn't have one yet, scheduling something gives it your computer's.

## Coming up

The top of **Pages** lists what's coming up: each page and item that will be shown or hidden, and when, soonest first. Pages and items also say when they're shown from, or hidden after, under their names in lists.

## When changes go live

Visitors see the site as it was last built, so a scheduled change goes live when the site is built again after its time. How soon that is depends on where the site is stored, and the admin panel says which when you schedule something:

| Site stored on | Scheduled changes go live |
|---|---|
| GitLab | At their time. The admin panel adds a pipeline schedule for each time, which builds the site then, and removes it once it's no longer needed. |
| GitHub | Within the hour after their time. The site's `.github/workflows/scheduled.yml` checks each hour whether anything has come due, and builds the site only then. It also builds it the first hour after what the site shows by today's date changes, such as an event's next date. |
| Bitbucket | With the nightly rebuild after their time, or within the hour where an owner has added an hourly schedule for the `scheduled` pipeline, which needs more build minutes than Bitbucket's free plan has (see [Put it online](/docs/put-it-online#3-choose-a-host)). Either asks Vercel to rebuild the site through its deploy hook. |

Sites built by Cloudflare Pages work the same way: the schedule or the hourly check asks Cloudflare to rebuild the site through the Pages project's deploy hook, which the site's setup files need as `CLOUDFLARE_DEPLOY_HOOK` (see [Put it online](/docs/put-it-online#3-choose-a-host)).

Sites without these, such as ones made before scheduled publishing, or built by Vercel from GitHub or GitLab, get scheduled changes with the nightly rebuild after their time, or the next time anyone publishes.

On GitHub, each hourly check of a **private** repository counts as a minute of GitHub Actions, about 720 a month, out of the free plan's 2,000; public repositories don't count. To go back to the nightly rebuild, delete `.github/workflows/scheduled.yml`.

On GitLab, editors with the Developer role need permission to merge to the main branch to add pipeline schedules, which **Let editors publish** on the Editors screen gives. Where it was turned on before scheduled publishing, an owner allows Developers to merge too, under **Settings → Repository → Protected branches** on GitLab. Until then, editors' scheduled changes go live with the nightly rebuild, or at their time once an owner has opened the admin panel, which adds the schedules.

## Scheduled content isn't secret

What you schedule is published to the site's repository straight away, so anyone who can read the repository can read it before it's shown. On a public repository, that's anyone at all, and the admin panel warns about it when you schedule something. Don't schedule anything that must stay secret until its time, such as an announcement under embargo, on a public repository; publish it at its time instead, or keep the site's content in a [private repository of its own](/docs/content-repository).

## For developers

Page and item files keep their schedule beside `version`, as `showFrom` and `hideAfter`, each a wall-clock time `YYYY-MM-DDTHH:MM` in the site's `timeZone` (see [Content files](/docs/content-files#scheduled-pages-and-items)). Builds leave out what isn't shown at the moment they run, with `goodfellow build`, `goodfellow dev` and Next.js alike, and `goodfellow build` prints the next scheduled change. `goodfellow due --since <time>` says whether one has come due since a time, which the hourly check runs (see [Commands](/docs/commands)).
