---
version: 1
title: Built-in blocks
description: The blocks every Goodfellow site has, from sections and columns to code, search and collection navigation.
section: editors
order: 7
---

Every site has these blocks. Sites can also have [blocks from block registries](/docs/add-blocks) and blocks of their own. Each built-in block also has a version for the site's [app](/docs/apps), if it has one, which draws it natively on phones.

| Block | What it's for |
|---|---|
| Section | A full-width band of the page with a background, centering its content; with a picture behind it, a color over it and a height, it's WordPress's Cover (see [Sections as covers](#sections-as-covers)) |
| Columns | Equal-width columns that stack on phones |
| Row | Blocks side by side, such as a group of buttons |
| Space | Empty vertical space |
| Separator | A line between parts of the page: short, full width or dots |
| Media and text | A picture or uploaded video beside other blocks, on either side, which stack on phones |
| Details | A summary that opens to show the blocks inside it, with no JavaScript |
| Heading | A heading, from page title (H1) down to H4 |
| Text | Formatted text: paragraphs, lists, links |
| Button | A link styled as a button |
| Pullquote | A quote shown large, set off from the text around it, with who said it |
| Table | A table of text, with an optional row of headings, a footer, a caption and stripes (see [Table](#table)) |
| Preformatted text | Text shown exactly as it's typed, spaces and line breaks included, in a fixed-width font |
| Verse | Poetry or lyrics, with their lines and spaces as typed, in the page's own font |
| Image | An image with an optional caption, and a description for people who can't see it, unless it's only decoration |
| Gallery | Pictures in two to four columns, each with an optional caption, cropped to squares or not |
| Video | A video from the media library, YouTube, Vimeo or another site's player |
| Audio | A sound file from the media library, such as a homily, with the browser's own player |
| File | A link to a file from the media library, such as a PDF, with an optional download button |
| Form | A form whose answers a form service emails to you, or a Google form (see [Forms](/docs/forms)) |
| Newsletter signup | An email box that signs visitors up to a newsletter on Mailchimp, Buttondown or Kit, or through the site's form service |
| Code | Code with syntax highlighting, an optional title and a copy button |
| Contact details | The address, phone number and email address from Site Settings |
| Menu | One of the site's menus, with dropdowns for submenus. **Colors** puts it in a bar of the theme's primary or secondary color, its dropdowns see-through in the same color, **Show the pages under each submenu link** opens a submenu link's own pages as a third level, so a section's pages need no menu entries of their own, and **Show the links behind a menu button (☰)** puts every link, every level of them, under a menu button on phones, on phones and small tablets, on phones and tablets, always or never (see [Menus on phones](#menus-on-phones)) |
| Site name and logo | The site's logo and name, linking home, with the site's description under the name if you like |
| Search | A search box for the whole site, with results as you type |
| Dark mode switch | Lets visitors choose light or dark colors, on sites with dark mode |
| Collection navigation | Links to every item in a collection, grouped by one of its choice fields |
| Page list | The site's pages, or the ones under an address, nested by their addresses |
| Breadcrumbs | The way from the home page to the page shown, such as Home › News › The parish fair (see [Breadcrumbs](#breadcrumbs)) |
| Collection list | A collection's items as a list or cards, with a heading, on pages of their own and a page for each choice (see [Showing collections](/docs/showing-collections)) |
| Collection loop | Blocks you design, shown once for each of a collection's items |
| Calendar | Events coming up, or a month at a time, from a collection of events or another calendar (see [Calendars and events](/docs/calendars)) |
| Entry field | One of the item's fields, in a collection's page design only |
| Add to calendar | Links that add the item's event to visitors' calendars, in a page design only |
| Previous and next | Links to the items before and after this one, in a page design only |
| On this page | The headings of the item's Markdown text, in a page design only |

The blocks from Separator to File in the list match WordPress's own blocks of the same names, so [moving from WordPress](/docs/move-from-wordpress) keeps them as they are, and [exporting to WordPress](/docs/move-from-wordpress) makes them WordPress's again.

Blocks use the site's colors, fonts and corner rounding. Every block's **Style** setting changes its look, as Tailwind classes that override the block's own styles: **Space inside** on a Section replaces its default padding (see [A block's look](/docs/edit-pages#a-blocks-look)). Every part of a block also has a name, which the site's theme can give classes to (see [Named parts](#named-parts)).

## Video

The Video block shows a video from one of four places, chosen in **Video from**:

- **The media library**: an MP4 or WebM video uploaded to the site, up to 25 MB, with an optional picture shown before it plays and captions as a WebVTT (`.vtt`) file. Uploaded videos are kept in the site's repository for good, even after they're replaced, so longer ones are better on YouTube or Vimeo, as are any on a site published with [Cloudflare Pages](/docs/hosts#business-and-commercial-sites).
- **YouTube**: paste the video's address in any form YouTube gives it (a `watch` address, a `youtu.be` link, a Short, a live stream, or the embed code), or just its ID. A start time in the address, such as `t=1m30s`, is kept. It plays in YouTube's privacy-enhanced player, which sets no cookies until it's played.
- **Vimeo**: paste the video's address, including an unlisted video's, or its embed code. It plays with Vimeo's "do not track" on.
- **Another site's player**: paste the player's embed address, or the whole embed code the other site gives. It's shown in a sandbox, with only what players need, and only from a secure (`https://`) address on another site.

Give every video a description for screen readers. It can also have a caption below it, a shape (the video's own, wide, landscape, square, or tall for videos made on phones), and play on its own without sound, start with the sound off, or play again when it ends. Players load only when they're scrolled near, so they don't slow down the top of the page.

## Table

Select a Table block to edit its cells in a grid in the block's settings: type in each cell, and add or remove rows and columns. **First row is headings** makes the first row the columns' headings, and **Last row is a footer** sets the last row apart, such as for totals. Cells hold plain text. The table scrolls sideways on phones when it's wider than the screen.

## Sections as covers

A Section with a background picture can be a cover, like WordPress's Cover block: **Color over the background** puts a dark, light or primary color over the picture, **How strong a color** sets how much, so text on the photo can be read, and the text color changes to suit it. **Part of the picture to keep in view** chooses what stays visible when the picture is cropped, and **Height at least** makes the section taller, up to the whole screen, with its content in the middle.

## Code

The Code block highlights code when the site is built, so visitors' browsers don't have to. It knows Bash, CSS, diffs, HTML, JavaScript, JSON, JSX, Markdown, Python, TSX, TypeScript and YAML, in colors like the page's (light, or dark when the site's [dark mode](/docs/layout-and-settings#dark-mode) shows it dark), or always light or dark. Which colors those are is a site setting, [Code colors](/docs/layout-and-settings#code-colors). The copy button's label is the block's to set, so sites in other languages can translate it; leave it empty for no button.

## Menus on phones

A menu across the page opens its submenus when the pointer is over them, which phones and tablets don't have, and a long menu runs onto several lines on a narrow screen. **Show the links behind a menu button (☰)** shows a button there instead, which opens every link in a panel, each submenu's links indented under it, with the pages under them where **Show the pages under each submenu link** is on:

- **On phones:** screens narrower than 640 pixels.
- **On phones and small tablets:** narrower than 768 pixels, which suits most headers.
- **On phones and tablets:** narrower than 1024 pixels, for a long menu.
- **Always**, at every width.
- **Never**, for menus that fit on a phone as they are, such as a footer's menu down the page.

A menu across the page that has submenus and never shows the button says so in the editor, since its submenus' links can't be reached on phones. **Menu button's name, for screen readers** is what screen readers call the button; translate it on a site in [several languages](/docs/languages). The button needs no JavaScript, so it works for visitors without it too. In apps made with [Expo](/docs/apps) the menu follows the same choice, except that a menu with submenus has the button on phones whatever it's set to, since an app can't open them otherwise.

## Dark mode switch

On a site with [dark mode](/docs/layout-and-settings#dark-mode), the Dark mode switch lets visitors choose light or dark colors instead of following their computer's setting. **Show as** chooses:

- **A switch between light and dark**, with a sun or a moon on it, and the words **Light** and **Dark** beside it if **Words beside the switch** is **Show**.
- **A menu:** **Light**, **Dark** or **Follow my computer**, which goes back to following the computer's setting.

The visitor's choice is kept in their browser and put back at the start of every page, before it shows, so pages never flash the other colors first. Every word is the block's to set, so sites in other languages can translate them. On a site without dark mode, the switch isn't shown, and the editor says where to turn dark mode on.

## Breadcrumbs

Breadcrumbs show where a page is in the site: the home page, each page above it by address, and the page itself, such as **Home › About us › Staff** on `/about/staff`. Addresses with no page of their own are skipped, so `/about/history/1900s` shows **Home › About us › The 1900s** when there's no `/about/history` page. An item's page is under its collection's page (**Home › News › The parish fair**), and a page a block adds comes after the page it's on (**Home › News › Page 2**). On a site in [several languages](/docs/languages), they start from the home page of the page's language. On the home page they show nothing.

**What to call the home page** is "Home" until you change it; leave it empty to use the home page's title. **Between pages** chooses ›, / or →, and **End with this page** chooses whether the page shown comes last, not as a link. They're marked up as schema.org's `BreadcrumbList`, which search engines can show in their results in place of the page's address. Put them in a collection's page design to show them on every item's page. They need to know the page they're on, so they go on pages and in page designs, not in the header or footer, which Next.js sites share between pages.

## Language switch

On a site in [several languages](/docs/languages), the Language switch links to the page in each of them, each language named in itself: to the page's translation, or to the language's home page where it has none. **Show as** chooses links side by side or a menu that opens, which needs no JavaScript, except in a Next.js site's header and footer, which are shared by every page, so the browser finds the page's translations. On a site in one language, it isn't shown, and the editor says where to add a language.

## Search

The Search block searches the whole site in the visitor's browser, with [Pagefind](https://pagefind.app), so no search service is needed. When a site has a Search block, its build makes a search index of every page's main content; headers, footers and "Page not found" are left out. Search only works on the built site, so in the editor the box says so. See [Search](/docs/search) for details.

## Newsletter signup

The Newsletter signup block is an email box and a button that sign visitors up to your newsletter. Choose the **Newsletter service** and paste its signup form:

- **Mailchimp:** in Mailchimp, open **Audience**, then **Signup forms**, then **Embedded forms**, and copy the code there.
- **Buttondown:** your Buttondown username, or the embed code from Buttondown's sharing settings.
- **Kit (ConvertKit):** open the form in Kit, choose **Publish**, then **HTML**, and copy the code there.
- **The site's form service:** the one in Site Settings, under Forms (see [Forms](/docs/forms)), which emails you each signup, for a list you keep yourself.

The block keeps only where the form sends signups, so it looks like the rest of the site, and it's a plain form that posts straight to the service: it works without JavaScript, and pages load nothing from the service until someone signs up. The service then shows its own page, such as Mailchimp's "Almost finished" page asking people to confirm by email; with the site's form service, **Page visitors see after signing up** can be one of the site's pages. **Ask for a first name too** adds a box for it (Buttondown takes only the address). **Button beside the box** hides the boxes' labels, which screen readers still read, behind their placeholders. Until the form can sign anyone up, the block isn't shown on the site, and the editor says what's missing.

In the site's app, signups through the site's form service are sent from the app itself; with a newsletter service, the button opens the page on the website.

## Named parts

Every part of a built-in block has a name, which is on the part as a class, and which [Blocks' parts](/docs/layout-and-settings#blocks-parts) gives classes to and custom CSS can style. Names are never renamed or removed, so a theme that uses one keeps working; new ones may be added. Some parts are in more than one block, such as a list's page links.

- **Audio:** `gf-audio` (Audio and caption), `gf-audio-player` (Player), `gf-audio-caption` (Caption).
- **Add to calendar:** `gf-add-to-calendar` (Add to calendar), `gf-add-to-calendar-label` (Add to calendar's label), `gf-add-to-calendar-links` (Calendars' links), `gf-add-to-calendar-link` (Calendar's link).
- **Button:** `gf-button` (Button).
- **Calendar:** `gf-calendar` (Calendar), `gf-calendar-empty` (Nothing to show), `gf-calendar-days` (Days), `gf-calendar-day` (Day), `gf-calendar-day-heading` (Day's date), `gf-calendar-events` (Day's events), `gf-calendar-event` (Event), `gf-calendar-event-time` (Event's time), `gf-calendar-event-body` (Event's details), `gf-calendar-event-title` (Event's title), `gf-calendar-event-place` (Event's place), `gf-calendar-event-summary` (Event's summary), `gf-calendar-month` (Month), `gf-calendar-month-header` (Month's heading and links), `gf-calendar-month-link` (Previous or next month), `gf-calendar-month-title` (Month's name), `gf-calendar-weekdays` (Days of the week), `gf-calendar-month-days` (Month's days), `gf-calendar-month-day` (Month's day), `gf-calendar-month-blank` (Day outside the month), `gf-calendar-month-date` (Day's number), `gf-calendar-month-events` (Day's events in a month), `gf-calendar-month-event` (Event in a month), `gf-calendar-subscribe` (Subscribe), `gf-calendar-subscribe-label` (Subscribe's label), `gf-calendar-subscribe-links` (Subscribe links), `gf-calendar-subscribe-link` (Subscribe link), `gf-add-to-calendar` (Add to calendar), `gf-add-to-calendar-label` (Add to calendar's label), `gf-add-to-calendar-links` (Calendars' links), `gf-add-to-calendar-link` (Calendar's link).
- **Code:** `gf-code` (Code), `gf-code-title` (Code's title), `gf-code-copy` (Copy button).
- **Collection list:** `gf-collection-list` (List with its heading), `gf-collection-list-header` (List's heading and link), `gf-collection-list-heading` (List's heading), `gf-collection-list-more` (See all link), `gf-collection-list-items` (Items), `gf-collection-list-empty` (Nothing to show), `gf-card` (Card), `gf-card-image` (Card's picture), `gf-card-body` (Card's text), `gf-card-date` (Card's date), `gf-card-title` (Card's title), `gf-card-summary` (Card's summary), `gf-list-item` (List item), `gf-list-item-image` (List item's picture), `gf-list-item-body` (List item's text), `gf-list-item-date` (List item's date), `gf-list-item-title` (List item's title), `gf-list-item-summary` (List item's summary), `gf-choices` (Choices), `gf-choice-link` (Choice), `gf-page-links` (Page links), `gf-page-numbers` (Page numbers), `gf-page-link` (Page link).
- **Collection loop:** `gf-collection-loop` (Collection loop), `gf-collection-loop-items` (Items), `gf-collection-loop-item` (Item), `gf-collection-loop-design` (Item's design), `gf-collection-loop-empty` (Nothing to show), `gf-choices` (Choices), `gf-choice-link` (Choice), `gf-page-links` (Page links), `gf-page-numbers` (Page numbers), `gf-page-link` (Page link).
- **Collection navigation:** `gf-collection-nav` (Collection navigation), `gf-collection-nav-heading` (Navigation's heading), `gf-collection-nav-group` (Group), `gf-collection-nav-group-label` (Group's name), `gf-collection-nav-links` (Group's links), `gf-collection-nav-link` (Link).
- **Columns:** `gf-columns` (Columns).
- **Contact details:** `gf-contact` (Contact details), `gf-contact-address` (Address), `gf-contact-phone` (Phone number), `gf-contact-email` (Email address).
- **Details:** `gf-details` (Details), `gf-details-summary` (Summary), `gf-details-content` (What it shows).
- **Dark mode switch:** `gf-dark-mode-switch` (Dark mode switch), `gf-dark-mode-switch-track` (Switch's track), `gf-dark-mode-switch-thumb` (Switch's knob).
- **Entry field:** `gf-entry-field` (Entry field), `gf-entry-field-link` (Field's link), `gf-code` (Code), `gf-code-title` (Code's title), `gf-code-copy` (Copy button).
- **File:** `gf-file` (File), `gf-file-link` (File's link), `gf-file-button` (Download button).
- **Form:** `gf-form` (Form), `gf-form-embed` (Google Form), `gf-form-questions` (Questions), `gf-form-question` (Question), `gf-form-label` (Question's wording), `gf-form-hint` (Help text), `gf-form-input` (Answer field), `gf-form-choice` (Choice), `gf-form-check` (Checkbox or option), `gf-form-required` (Required mark), `gf-form-submit` (Send button).
- **Newsletter signup:** `gf-newsletter` (Newsletter signup), `gf-newsletter-heading` (Heading), `gf-newsletter-text` (Text), `gf-newsletter-form` (Form), `gf-newsletter-field` (Field), `gf-newsletter-label` (Field's label), `gf-newsletter-input` (Email box), `gf-newsletter-submit` (Subscribe button), `gf-newsletter-note` (Words under the form).
- **Gallery:** `gf-gallery` (Gallery), `gf-gallery-items` (Pictures), `gf-gallery-item` (Picture and caption), `gf-gallery-picture` (Picture), `gf-gallery-item-caption` (Picture's caption), `gf-gallery-caption` (Gallery's caption).
- **Heading:** `gf-heading` (Heading).
- **Image:** `gf-image` (Image and caption), `gf-image-picture` (Picture), `gf-image-caption` (Caption).
- **Language switch:** `gf-language-switch` (Language switch), `gf-language-list` (Languages), `gf-language-link` (Language), `gf-language-current` (Current language).
- **Media and text:** `gf-media-text` (Media and text), `gf-media-text-media` (Picture), `gf-media-text-content` (Text beside it).
- **Menu:** `gf-menu` (Menu), `gf-menu-list` (Menu's links), `gf-menu-item` (Menu item), `gf-menu-link` (Menu link), `gf-menu-submenu` (Submenu), `gf-menu-toggle` (Menu button and its links), `gf-menu-button` (Menu button), `gf-menu-panel` (Links under the menu button).
- **On this page:** `gf-on-this-page` (On this page), `gf-on-this-page-heading` (Heading), `gf-on-this-page-links` (Links), `gf-on-this-page-link` (Link).
- **Page list:** `gf-page-list` (Page list), `gf-page-list-item` (Page), `gf-page-list-link` (Page's link), `gf-page-list-children` (Pages under it).
- **Preformatted text:** `gf-preformatted` (Preformatted text).
- **Previous and next:** `gf-entry-pager` (Previous and next), `gf-entry-pager-link` (Previous or next link), `gf-entry-pager-label` (Link's label), `gf-entry-pager-title` (Link's title).
- **Pullquote:** `gf-pullquote` (Pullquote), `gf-pullquote-quote` (Quote), `gf-pullquote-citation` (Who said it).
- **Row:** `gf-row` (Row).
- **Search:** `gf-search` (Search), `gf-search-box` (Search box), `gf-search-input` (Search field), `gf-search-results` (Results), `gf-search-result` (Result), `gf-search-result-title` (Result's title), `gf-search-result-excerpt` (Result's excerpt), `gf-search-message` (Search message).
- **Section:** `gf-section` (Section), `gf-section-content` (Section's content), `gf-section-overlay` (Section's overlay).
- **Separator:** `gf-separator` (Separator).
- **Site name and logo:** `gf-site-brand` (Site name and logo), `gf-site-brand-logo` (Logo), `gf-site-brand-name` (Site name), `gf-site-brand-text` (Name and tagline), `gf-site-brand-tagline` (Tagline).
- **Space:** `gf-space` (Space).
- **Table:** `gf-table` (Table and caption), `gf-table-grid` (Table), `gf-table-caption` (Caption), `gf-table-row` (Row), `gf-table-header-cell` (Heading cell), `gf-table-cell` (Cell).
- **Text:** `gf-text` (Text).
- **Verse:** `gf-verse` (Verse).
- **Video:** `gf-video` (Video and caption), `gf-video-player` (Player), `gf-video-caption` (Caption).
