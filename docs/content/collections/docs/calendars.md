---
version: 1
title: Calendars and events
description: Events with dates, times and repeats, calendars that show them, and calendars visitors subscribe to.
section: editors
order: 3.5
---

A collection of events is a collection whose items have a date and time. The **Calendar** block shows them as a list of what's coming up or a month at a time, and visitors can add them to their own calendars or subscribe to all of them. Everything is worked out when the site is built, so visitors only get the page, and the site is rebuilt overnight whenever "what's coming up" changes, so it stays current ([Keeping a site up to date](/docs/updates#rebuilding-overnight)).

## Make a collection of events

Under **Collections**, choose **New collection**, then **Events** under **Start with**. Each event then has:

- a **Date and time**, which can repeat;
- a **Place**, such as the hall or an address;
- a **Summary**, shown in calendars and lists;
- a **Picture** and **Details** for its own page.

Its page design shows when and where it is, with an **Add to calendar** link. If the site doesn't have a time zone yet, it gets your computer's (see [Time zone](#time-zone)).

Any collection can become one: add a **Date and time, for events** field in its settings, then turn on **Show items in calendars** and choose which fields say where it is and give a summary.

## Dates, times and repeats

An event's **Date and time** has:

- **Starts**, a date and a time, or **All day**.
- **Ends**, which is optional. An all-day event can last several days.
- **Repeats**: daily, weekly, monthly or yearly, every so many days, weeks, months or years. Weekly events can happen on several days of the week. Monthly ones happen on the same date, the same weekday of the month (such as the second Tuesday) or the last such weekday (such as the last Friday).
- **Until**, the last date it can happen on, which is optional.
- **Dates it doesn't happen**, such as a holiday.

So a weekly service is one item, however many weeks it runs. Below the field, the editor says when it next happens.

## The Calendar block

Add a **Calendar** block to a page and choose its **Events**. It can show them two ways:

- **A list** of what's coming up, a day at a time, with each event's time, place and summary, up to a number of events or days ahead.
- **A month at a time**, as a grid of the month's days; on phones, a list of the days with events. Its page shows the current month, with links to the months before and after. Each month has a page of its own: for a calendar at `/calendar`, November 2026 is at `/calendar/2026-11`. **Earlier months** and **Later months** choose how far visitors can go.

Every link and button the block shows has its own text in its settings, for sites in other languages. Events link to their own pages, if the collection gives items pages.

## Adding to calendars and subscribing

- **Add to calendar**, beside each event in a list and on each event's page, adds it to Google Calendar, Outlook.com, or Apple Calendar and other calendar apps, repeats included (Outlook.com's link adds only the first time).
- **Subscribe** adds the whole collection to a visitor's calendar app, which then keeps up with it: new events, changes and cancellations show up on their own, as their app checks again, usually every few hours. Subscribing from Google Calendar or other apps needs the site's address, set under **Site Settings → General**.

Builds write the files calendar apps read: `/calendars/events.ics` for subscribing to a collection called `events`, and one for each event, such as `/calendars/events/fall-festival.ics`.

## Calendars kept elsewhere

If the events are kept in another calendar, such as a public Google Calendar, a Calendar block can show them too. Put the calendar's address in **Another calendar's address (.ics)**; it can show those events alone or beside a collection's.

To find a Google Calendar's address, open [Google Calendar](https://calendar.google.com) on a computer, go to the calendar's **Settings and sharing**, turn on **Make available to public** under **Access permissions for events**, and copy **Public address in iCal format** under **Integrate calendar**.

The other calendar is read when the site is built, so changes show up on the next build: after the next publish, the next night's rebuild, which a calendar like this always has, or **Rebuild now** on the Updates screen. The editor doesn't show its events, only a note saying they're added when the site is built. If the calendar can't be read, the site is built without its events. Its address must start with `https://` or `webcal://`, and builds never read one on the computer building the site or a private network, such as `localhost`, `192.168.1.10` or a cloud's own addresses, even where another address redirects there.

### Embedding a Google Calendar instead

A Google Calendar can also be put on a page as it is, following Google's guide, [Add a calendar to your website](https://support.google.com/calendar/answer/41207). Copy the embed code from the calendar's **Settings and sharing**, under **Integrate calendar**, into a **Custom HTML** block (see [Add blocks](/docs/add-blocks)), and turn off its sanitizing, which leaves embedded frames out.

Changes then show up at once, rather than after the next build, and the calendar is managed in Google. But it looks like Google's calendar rather than the site, it loads Google's code for every visitor, and visitors can't subscribe from the site.

## Time zone

Events' times are the site's own, in its time zone, set under **Site Settings → General → Time zone**. Calendar apps show visitors each time in their own time zone, so 7:00 PM in New York shows as 4:00 PM in Los Angeles. A weekly event stays at the same time when the clocks change.

Without a time zone, times are shown as they're written, and calendar apps treat them as the visitor's own.
