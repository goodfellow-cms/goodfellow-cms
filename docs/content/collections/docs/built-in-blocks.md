---
version: 1
title: Built-in blocks
description: The blocks every Goodfellow site has, from sections and columns to code, search and collection navigation.
section: editors
order: 7
---

Every site has these blocks. Sites can also have [blocks from block registries](/docs/add-blocks) and blocks of their own.

| Block | What it's for |
|---|---|
| Section | A full-width band of the page with a background, centering its content |
| Columns | Equal-width columns that stack on phones |
| Row | Blocks side by side, such as a group of buttons |
| Space | Empty vertical space |
| Heading | A heading, from page title (H1) down to H4 |
| Text | Formatted text: paragraphs, lists, links |
| Button | A link styled as a button |
| Image | An image with an optional caption, and a description for people who can't see it, unless it's only decoration |
| Video | A video from the media library, YouTube, Vimeo or another site's player |
| Form | A form whose answers a form service emails to you, or a Google form (see [Forms](/docs/forms)) |
| Code | Code with syntax highlighting, an optional title and a copy button |
| Contact details | The address, phone number and email address from Site Settings |
| Menu | One of the site's menus, with dropdowns for submenus |
| Site name and logo | The site's logo and name, linking home |
| Search | A search box for the whole site, with results as you type |
| Dark mode switch | Lets visitors choose light or dark colors, on sites with dark mode |
| Collection navigation | Links to every item in a collection, grouped by one of its choice fields |
| Collection list | A collection's items as a list or cards, with a heading, on pages of their own and a page for each choice (see [Showing collections](/docs/showing-collections)) |
| Collection loop | Blocks you design, shown once for each of a collection's items |
| Calendar | Events coming up, or a month at a time, from a collection of events or another calendar (see [Calendars and events](/docs/calendars)) |
| Entry field | One of the item's fields, in a collection's page design only |
| Add to calendar | Links that add the item's event to visitors' calendars, in a page design only |
| Previous and next | Links to the items before and after this one, in a page design only |
| On this page | The headings of the item's Markdown text, in a page design only |

Blocks use the site's colors, fonts and corner rounding. Every block accepts extra CSS classes, which override the block's own styles: `py-4` on a Section replaces its default padding. Every part of a block also has a name, which the site's theme can give classes to (see [Named parts](#named-parts)).

## Video

The Video block shows a video from one of four places, chosen in **Video from**:

- **The media library**: an MP4 or WebM video uploaded to the site, up to 25 MB, with an optional picture shown before it plays and captions as a WebVTT (`.vtt`) file. Uploaded videos are kept in the site's repository for good, even after they're replaced, so longer ones are better on YouTube or Vimeo, as are any on a site published with [Cloudflare Pages](/docs/hosts#business-and-commercial-sites).
- **YouTube**: paste the video's address in any form YouTube gives it (a `watch` address, a `youtu.be` link, a Short, a live stream, or the embed code), or just its ID. A start time in the address, such as `t=1m30s`, is kept. It plays in YouTube's privacy-enhanced player, which sets no cookies until it's played.
- **Vimeo**: paste the video's address, including an unlisted video's, or its embed code. It plays with Vimeo's "do not track" on.
- **Another site's player**: paste the player's embed address, or the whole embed code the other site gives. It's shown in a sandbox, with only what players need, and only from a secure (`https://`) address on another site.

Give every video a description for screen readers. It can also have a caption below it, a shape (the video's own, wide, landscape, square, or tall for videos made on phones), and play on its own without sound, start with the sound off, or play again when it ends. Players load only when they're scrolled near, so they don't slow down the top of the page.

## Code

The Code block highlights code when the site is built, so visitors' browsers don't have to. It knows Bash, CSS, diffs, HTML, JavaScript, JSON, JSX, Markdown, Python, TSX, TypeScript and YAML, in colors like the page's (light, or dark when the site's [dark mode](/docs/layout-and-settings#dark-mode) shows it dark), or always light or dark. Which colors those are is a site setting, [Code colors](/docs/layout-and-settings#code-colors). The copy button's label is the block's to set, so sites in other languages can translate it; leave it empty for no button.

## Dark mode switch

On a site with [dark mode](/docs/layout-and-settings#dark-mode), the Dark mode switch lets visitors choose light or dark colors instead of following their computer's setting. **Show as** chooses:

- **A switch between light and dark**, with a sun or a moon on it, and the words **Light** and **Dark** beside it if **Words beside the switch** is **Show**.
- **A menu**, like the admin panel's: **Light**, **Dark** or **Follow my computer**, which goes back to following the computer's setting.

The visitor's choice is kept in their browser and put back at the start of every page, before it shows, so pages never flash the other colors first. Every word is the block's to set, so sites in other languages can translate them. On a site without dark mode, the switch isn't shown, and the editor says where to turn dark mode on.

## Language switch

On a site in [several languages](/docs/languages), the Language switch links to the page in each of them, each language named in itself: to the page's translation, or to the language's home page where it has none. **Show as** chooses links side by side or a menu that opens, which needs no JavaScript, except in a Next.js site's header and footer, which are shared by every page, so the browser finds the page's translations. On a site in one language, it isn't shown, and the editor says where to add a language.

## Search

The Search block searches the whole site in the visitor's browser, with [Pagefind](https://pagefind.app), so no search service is needed. When a site has a Search block, its build makes a search index of every page's main content; headers, footers and "Page not found" are left out. Search only works on the built site, so in the editor the box says so. See [Search](/docs/search) for details.

## Named parts

Every part of a built-in block has a name, which is on the part as a class, and which [Blocks' parts](/docs/layout-and-settings#blocks-parts) gives classes to and custom CSS can style. Names are never renamed or removed, so a theme that uses one keeps working; new ones may be added. Some parts are in more than one block, such as a list's page links.

- **Add to calendar:** `gf-add-to-calendar` (Add to calendar), `gf-add-to-calendar-label` (Add to calendar's label), `gf-add-to-calendar-links` (Calendars' links), `gf-add-to-calendar-link` (Calendar's link).
- **Button:** `gf-button` (Button).
- **Calendar:** `gf-calendar` (Calendar), `gf-calendar-empty` (Nothing to show), `gf-calendar-days` (Days), `gf-calendar-day` (Day), `gf-calendar-day-heading` (Day's date), `gf-calendar-events` (Day's events), `gf-calendar-event` (Event), `gf-calendar-event-time` (Event's time), `gf-calendar-event-body` (Event's details), `gf-calendar-event-title` (Event's title), `gf-calendar-event-place` (Event's place), `gf-calendar-event-summary` (Event's summary), `gf-calendar-month` (Month), `gf-calendar-month-header` (Month's heading and links), `gf-calendar-month-link` (Previous or next month), `gf-calendar-month-title` (Month's name), `gf-calendar-weekdays` (Days of the week), `gf-calendar-month-days` (Month's days), `gf-calendar-month-day` (Month's day), `gf-calendar-month-blank` (Day outside the month), `gf-calendar-month-date` (Day's number), `gf-calendar-month-events` (Day's events in a month), `gf-calendar-month-event` (Event in a month), `gf-calendar-subscribe` (Subscribe), `gf-calendar-subscribe-label` (Subscribe's label), `gf-calendar-subscribe-links` (Subscribe links), `gf-calendar-subscribe-link` (Subscribe link), `gf-add-to-calendar` (Add to calendar), `gf-add-to-calendar-label` (Add to calendar's label), `gf-add-to-calendar-links` (Calendars' links), `gf-add-to-calendar-link` (Calendar's link).
- **Code:** `gf-code` (Code), `gf-code-title` (Code's title), `gf-code-copy` (Copy button).
- **Collection list:** `gf-collection-list` (List with its heading), `gf-collection-list-header` (List's heading and link), `gf-collection-list-heading` (List's heading), `gf-collection-list-more` (See all link), `gf-collection-list-items` (Items), `gf-collection-list-empty` (Nothing to show), `gf-card` (Card), `gf-card-image` (Card's picture), `gf-card-body` (Card's text), `gf-card-date` (Card's date), `gf-card-title` (Card's title), `gf-card-summary` (Card's summary), `gf-list-item` (List item), `gf-list-item-image` (List item's picture), `gf-list-item-body` (List item's text), `gf-list-item-date` (List item's date), `gf-list-item-title` (List item's title), `gf-list-item-summary` (List item's summary), `gf-choices` (Choices), `gf-choice-link` (Choice), `gf-page-links` (Page links), `gf-page-numbers` (Page numbers), `gf-page-link` (Page link).
- **Collection loop:** `gf-collection-loop` (Collection loop), `gf-collection-loop-items` (Items), `gf-collection-loop-item` (Item), `gf-collection-loop-design` (Item's design), `gf-collection-loop-empty` (Nothing to show), `gf-choices` (Choices), `gf-choice-link` (Choice), `gf-page-links` (Page links), `gf-page-numbers` (Page numbers), `gf-page-link` (Page link).
- **Collection navigation:** `gf-collection-nav` (Collection navigation), `gf-collection-nav-heading` (Navigation's heading), `gf-collection-nav-group` (Group), `gf-collection-nav-group-label` (Group's name), `gf-collection-nav-links` (Group's links), `gf-collection-nav-link` (Link).
- **Columns:** `gf-columns` (Columns).
- **Contact details:** `gf-contact` (Contact details), `gf-contact-address` (Address), `gf-contact-phone` (Phone number), `gf-contact-email` (Email address).
- **Dark mode switch:** `gf-dark-mode-switch` (Dark mode switch), `gf-dark-mode-switch-track` (Switch's track), `gf-dark-mode-switch-thumb` (Switch's knob).
- **Entry field:** `gf-entry-field` (Entry field), `gf-entry-field-link` (Field's link), `gf-code` (Code), `gf-code-title` (Code's title), `gf-code-copy` (Copy button).
- **Form:** `gf-form` (Form), `gf-form-embed` (Google Form), `gf-form-questions` (Questions), `gf-form-question` (Question), `gf-form-label` (Question's wording), `gf-form-hint` (Help text), `gf-form-input` (Answer field), `gf-form-choice` (Choice), `gf-form-check` (Checkbox or option), `gf-form-required` (Required mark), `gf-form-submit` (Send button).
- **Heading:** `gf-heading` (Heading).
- **Image:** `gf-image` (Image and caption), `gf-image-picture` (Picture), `gf-image-caption` (Caption).
- **Language switch:** `gf-language-switch` (Language switch), `gf-language-list` (Languages), `gf-language-link` (Language), `gf-language-current` (Current language).
- **Menu:** `gf-menu` (Menu), `gf-menu-list` (Menu's links), `gf-menu-item` (Menu item), `gf-menu-link` (Menu link), `gf-menu-submenu` (Submenu).
- **On this page:** `gf-on-this-page` (On this page), `gf-on-this-page-heading` (Heading), `gf-on-this-page-links` (Links), `gf-on-this-page-link` (Link).
- **Previous and next:** `gf-entry-pager` (Previous and next), `gf-entry-pager-link` (Previous or next link), `gf-entry-pager-label` (Link's label), `gf-entry-pager-title` (Link's title).
- **Row:** `gf-row` (Row).
- **Search:** `gf-search` (Search), `gf-search-box` (Search box), `gf-search-input` (Search field), `gf-search-results` (Results), `gf-search-result` (Result), `gf-search-result-title` (Result's title), `gf-search-result-excerpt` (Result's excerpt), `gf-search-message` (Search message).
- **Section:** `gf-section` (Section), `gf-section-content` (Section's content).
- **Site name and logo:** `gf-site-brand` (Site name and logo), `gf-site-brand-logo` (Logo), `gf-site-brand-name` (Site name).
- **Space:** `gf-space` (Space).
- **Text:** `gf-text` (Text).
- **Video:** `gf-video` (Video and caption), `gf-video-player` (Player), `gf-video-caption` (Caption).
