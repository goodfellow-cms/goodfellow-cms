# @goodfellow-cms/react

## 0.8.0

### Minor Changes

- d21884a: On sites kept on GitHub, Site Settings has a Comments screen that sets up comments: it makes a public repository of their own beside the site's, with Discussions turned on, or connects one you already have, and publishes where they're kept as `content/site.json`'s `comments`, which the Comments block now shows without Giscus's code. The same screen lists visitors' comments page by page, and hides, shows and deletes them and closes pages to new ones. Where the sign-in can't reach that repository, as with the sign-in service, it asks for a GitHub token of the owner's own, kept only in the tab. GitHub backends offer this as `comments` (`SiteComments`), and the token broker asks before making the repository or deleting a comment.
- 293bbf0: Visitors' consent asks about kinds of content: other sites' content, and statistics and advertising where Site Settings → Code says the site's code is for them. Visitors can allow each kind on its own from the notice's Choose, and code marked as needed for the site to work loads without asking. A visitor's answer now lasts as many days as Site Settings says (180 by default, at most 395), and the notice asks again once it's older, or when the site asks about a kind it didn't before. Answers kept by earlier releases are asked again once.
- 90e3369: The built-in blocks no longer need React in visitors' browsers. The Code block's copy button, the Dark mode switch and the Search box are plain HTML, each made to work by a small script of its own in `@goodfellow-cms/core` (`copyScript()`, `darkModeScript()`, `searchScript()`), which `goodfellow build` adds only to the pages that use it (`blockScriptsFor()`) and Next.js sites' layout has all of. A page made of built-in blocks now loads no React at all, about 70 kB less on pages with search or a Dark mode switch. `CodeView` no longer takes `code`: the copy button copies the `<pre>` beside it. Search results are plain links, which Next.js sites' layout opens with Next.js's navigation and loads ahead, as `next/link` does.
- 7a9a116: `goodfellow build` runs a site's Client Components with Preact (`preact/compat`) instead of React where every one of them says it works with it (`export const worksWithPreact = true` in its `"use client"` file), which every interactive block in Goodfellow's registry now does: pages with them load about 32 kB of JavaScript instead of about 230 kB. Islands are rendered with Preact where pages are built too, so `useId()` gives the same ids as in the browser, each island's with a prefix of its own. A Client Component that doesn't say so keeps the site on React, and the build names it; `preact: false` in the config keeps React whatever they say, and `goodfellow build --react` or `GOODFELLOW_REACT=1` uses React for one build, such as to find out whether a problem is Preact's. `goodfellow dev` and Next.js always use React. `@goodfellow-cms/react/island` has `setIslandRenderer()` for this.
- 5869562: Builds make smaller copies of the media library's photos, 480, 800, 1200 and 1600 pixels wide, and images list them in `srcset`, so phones download no more than they show. `goodfellow build` and `goodfellow-next finish` (for static exports without an image loader of their own) write them into `media-sizes/`. Base paths now also apply to `srcset` as React spells it.
- 5e9a95b: Sites can ask visitors before showing content from other sites. With **Site Settings → General → Visitors' consent** on, a notice at the bottom of each page asks, and until visitors agree, YouTube, Vimeo and other sites' players, Google forms and maps load nothing and show a note with a button in their place, hCaptcha waits, and the site's custom code (all of the end of the page's, and the head's scripts, links and `noscript`) waits too. The answer is kept in the visitor's browser, links to `#consent` open the notice again, and every word of it can be changed, in each of the site's languages.

### Patch Changes

- 2e22322: Fixes to asking visitors before loading other sites' content:
  
  - The head's links to the site's own files, such as a stylesheet or icons, stay on the page; only links to other sites wait for visitors to agree (`isHeldHeadElement(element, siteUrl)`).
  - Code that has `</template>` in it, which would run before visitors agree, is left out of pages while the site asks. Site Settings won't publish it, and Custom HTML used as written is made safe instead (`endsHeldTemplate()`).
  - The consent script finds the notice by `data-gf-consent-notice`, so an element in rich text with the same id can't hide it. The notice is named by its message for screen readers, and a link to `#consent` moves the keyboard's focus to it.
  - The notice's words come in the site's main language where there are default words for it (English and Spanish), and each language's pages get their own default words (`consentDefaults()`, `consentInLanguage()`). Turning asking off and on again keeps the words that were written.
  - Google forms and maps keep their Style on the box around them, in the editor and on the site alike (`ConsentFrame`'s `boxClassName`).
  - The docs say that full-stack Next.js sites load fonts from Google before visitors agree.
- 9ccc5bb: On Next.js sites that ask visitors before loading other sites' content, a visitor who had agreed before no longer gets every player, script and piece of custom code loaded twice: the consent script now leaves the page's elements where React expects them. Custom HTML used exactly as written now waits for visitors to agree too, when it loads or runs anything. The notice and placeholders stay hidden whatever else styles them.
- 141a23d: Every block's Style settings can hide it on phones (narrower than 640px), tablets (640px to 1023px) or computers (1024px and wider), so a page can show something different on each without writing Tailwind classes. The choice is kept as Tailwind's breakpoint classes (`max-sm:hidden`, `sm:max-lg:hidden`, `lg:hidden`), which `readBlockStyle()` reads as `hiddenOn` and `withBlockStyle()` writes, and apps hide the block on the same sizes of screen, since they now read `max-` breakpoint classes too. The documentation site's header uses it to put the menu button and dark mode switch at the top right on phones and tablets, with the search on a line of its own on phones.
  
  Builds' accessibility checks look at pages that hide blocks on some screens as each size of screen shows them, so a menu for phones and one for computers aren't reported as two parts of the page with the same name.
  
  `SiteImage` gives images the build knows the size of their `width` and `height` even where it doesn't list smaller copies, such as SVG logos in `goodfellow build`, so browsers keep their space before they load, as Next.js's `next/image` already did.
- e558acd: Links that would run code, such as `javascript:` or `data:` addresses in menus, buttons or items' link fields, are left out of built pages, and the site checks stop a publish that adds one. A file replaced in the media library must be the same kind as the one it replaces, and every file published into the media library, a plugin's included, is checked by the name it's saved under, with SVGs cleaned again.
- Updated dependencies [a341e5f]
- Updated dependencies [8d9d46c]
- Updated dependencies [d21884a]
- Updated dependencies [2e22322]
- Updated dependencies [9ccc5bb]
- Updated dependencies [293bbf0]
- Updated dependencies [46cf9d9]
- Updated dependencies [368f04e]
- Updated dependencies [b9f619e]
- Updated dependencies [65239e6]
- Updated dependencies [b072536]
- Updated dependencies [141a23d]
- Updated dependencies [ecfbab6]
- Updated dependencies [8622adc]
- Updated dependencies [90e3369]
- Updated dependencies [7a9a116]
- Updated dependencies [5869562]
- Updated dependencies [5113b06]
- Updated dependencies [4e12d00]
- Updated dependencies [1a25a31]
- Updated dependencies [e558acd]
- Updated dependencies [4744a5f]
- Updated dependencies [9731fc0]
- Updated dependencies [86ad949]
- Updated dependencies [7be53b5]
- Updated dependencies [fcb4100]
- Updated dependencies [51a992a]
- Updated dependencies [a10f9ae]
- Updated dependencies [5e9a95b]
- Updated dependencies [1335733]
  - @goodfellow-cms/core@0.8.0

## 0.7.0

### Minor Changes

- c6afe19: Every block in the editor's block list has its own icon, in place of the drag handle every block shared, and so do the blocks the search finds. Blocks get one with `withIcon()`, from Lucide-style icon data, which the site's description carries for editor plugins; the built-in blocks have Lucide's, and blocks without one show a box. Switching between the standard editor and an editor plugin now takes the latest changes along, and asks first when the other editor can't keep some of them.
- a8e3581: The editor's block list has a search box, which finds blocks by their names, their groups and other words for them, such as "divider", "columns" or WordPress's "Cover", and blocks found are dragged onto the page as from the list. Blocks declare those words with `withKeywords()`, which the site's description carries. The groups that fit what's edited start open, such as Navigation in the header and footer, and the built-in Content group is now two, Text and Buttons and forms.
- 48366cf: Every block's look can be set without code: its CSS classes setting is now **Style**, which the editor shows as controls for text alignment, text size, text and background colors (the theme's, or your own), space inside and around it, each side or all at once, and rounded corners, with a note when text may be hard to read on its background. They're kept as Tailwind classes in the block's `className` (`readBlockStyle()` and `withBlockStyle()` in `@goodfellow-cms/core`), beside any other classes, which **Other CSS classes** keeps, so content files, themes' parts, the Gutenberg plugin and the AI assistant work with them as before. Blocks with an alignment setting of their own keep it.
- 3bb8c96: Builds write a content API at `/api/`: the site's content as static JSON, each page as it's shown after preparation, with each language's settings, menus, collections, header and footer, and a manifest listing every file with a hash, so apps and other sites can show the site without a server. Rich text and Markdown are written as sanitized HTML, as pages have them, and also as a simple structure an app can draw without an HTML renderer. `goodfellow build` and `goodfellow-next finish` write the same files, and the config's `api: false` leaves them out. Numbered lists that start past 1 keep their start when rich text is sanitized.
- 45a692b: Apps with Expo: `@goodfellow-cms/expo` shows a Goodfellow site natively in an Expo app for iPhone and Android from its content API, with no server. The app reads the manifest when it starts and when it comes back to the front, downloads only what changed and keeps it with its pictures, so it works offline; large sites choose which pages it keeps ahead. It stays on the copy it has when the site's content is newer than it reads. Every built-in block has a version for apps, `nativeBlocks` from `@goodfellow-cms/blocks/native`, sharing its props and what it shows with the website's, and blocks the app has no version of show a placeholder, or the app's own fallback, such as an Expo DOM component. `goodfellow blocks add --native <app>` also makes a block's version for the app with shadcn-tamagui-codemod. The content API's manifest now lists the site's redirects, which the app follows as the website does, and its pages carry their blocks' default props and the page's links to its translations, and the Form block has messages for the app to show once answers are sent or when they couldn't be.
- a52b217: Staging copies of a site: a build with `GOODFELLOW_SITE_URL` uses that address in place of the Site address, and `GOODFELLOW_NO_INDEX=true` keeps every page out of search engines, without either one reaching content. The config's `copies` lists them for the sign-in service, through `goodfellow-site.json`. A copy at an address of its own keeps its admin panel there, and the Domain screen says where it is.

### Patch Changes

- dd3da3e: Switching from an editor plugin back to Puck keeps what was edited where a block fills in its own choices, such as Collection list's choice of its collection's fields: the site's description says which blocks do (`resolvesFields`), and values left as the editor opened them are kept. Anything that still can't be kept is named by its block and setting, not its place in the page's data.
- 6701c92: Built pages are written whole. On a long page, React moved what a block waited for, such as formatted text, to the end of the page for a script to put back, so visitors without JavaScript, search engines and the accessibility checks found it outside the page's main content.
- Updated dependencies [c6afe19]
- Updated dependencies [a8e3581]
- Updated dependencies [48366cf]
- Updated dependencies [8f7fa14]
- Updated dependencies [4f79454]
- Updated dependencies [3bb8c96]
- Updated dependencies [cedcb3a]
- Updated dependencies [42cf54b]
- Updated dependencies [45a692b]
- Updated dependencies [45a692b]
- Updated dependencies [db58e5d]
- Updated dependencies [a52b217]
- Updated dependencies [dd3da3e]
  - @goodfellow-cms/core@0.7.0

## 0.6.0

### Minor Changes

- 6bf08ae: Every part of a block has a stable name, such as `gf-heading` or `gf-card-title`, and **Colors & fonts → Blocks' parts** gives a part classes for every block of that kind at once, kept in `content/site.json`'s `theme.parts`. A part's classes come after the block's own and before what's chosen for each block, so a choice made for one block still wins. Blocks name their parts with `useParts()` and declare them with `withParts()`, from `@goodfellow-cms/react`; the registry's blocks name theirs after themselves, such as `gf-shadcn-cards-title`. Images and videos with **Rounded corners** off now have the `rounded-none` class, and Rows that don't wrap `flex-nowrap`, so a theme's classes can't change them.
- 11a429f: Plugins, which developers add in the site's config (`plugins`), add what blocks can't: an admin module run in a sandboxed frame of its own whose Content Security Policy reaches only the addresses it declares, screens in Site Settings that read and publish only the files it declares, build steps each run in a Node process of its own with Node's permission model and only the secrets it declares, and routes on full-stack Next.js sites' servers, as well as blocks of their own. Blocks in the editor ask a plugin's services with `useSite().callPlugin`. See the docs' Plugins page.
- b9b0434: Built-in blocks for WordPress's core blocks Goodfellow had nothing like: Separator, Pullquote, Preformatted text, Verse, Details, Table (edited in a grid of cells, which the AI assistant can fill in too), File, Audio, Media and text, Gallery and Page list. Sections get a cover's color over the background, its strength, a least height and the part of the picture to keep in view, and Site name and logo can show the site's description under the name. Moving from WordPress keeps these blocks as they are, falling back to the blocks used before on sites without them, and exporting to WordPress makes them WordPress's own again. Media fields can hold sound files (`mediaField(label, "audio")`), blocks can read the site's pages with `useSite().pages`, and `tableField()` gives a block a table's cells.

### Patch Changes

- Updated dependencies [1b9781e]
- Updated dependencies [3436a92]
- Updated dependencies [2f6c59e]
- Updated dependencies [f591bc0]
- Updated dependencies [6bf08ae]
- Updated dependencies [b803050]
- Updated dependencies [4c909ac]
- Updated dependencies [11a429f]
- Updated dependencies [be7bbec]
- Updated dependencies [b9b0434]
  - @goodfellow-cms/core@0.6.0

## 0.5.0

### Minor Changes

- 938e468: An address of its own for the admin panel, such as `admin.example.org`, so the site's pages can't reach what it keeps. Site Settings' Domain screen sets it on GitLab Pages, Cloudflare Pages and Vercel, writing the config's new `admin` line: `goodfellow build` and `goodfellow-next finish` then start every page with a script that sends it to the Site address when it's opened at the admin address, fail if a page can't start with it, and write Cloudflare Pages' header rules, while the starters' `vercel.ts` and `withGoodfellow()` give Vercel's. Once the admin panel has checked the address from there, it opens only there and refuses to be shown in a frame. The sign-in worker gives tokens to the admin address too. The Blocks screen offers blocks from the config's `registries`, and shadcn/ui's own, only at a checked admin address and in `goodfellow dev` and `next dev`. GitLab's backend can publish files outside the editable folders, such as the config.
- 9b96dd3: The editor's sandbox. The admin panel's page, which signs in and publishes, no longer loads the site's config or any block's code: Puck, the config and every block run in frames sandboxed without `allow-same-origin`, which talk to the page through one message port, so blocks can't reach editors' tokens or AI keys. The page draws the editor's header, Undo and Redo, preview widths, Publish and the AI panel outside the frame; the Settings, Version history and Site history previews, the pages rendered to check a publish and the preview page for screenshots are frames too. The site's CSS is kept to the editor's canvas, with its width media queries as container queries, so the phone and tablet buttons show the site at those widths. The frames' Content Security Policy lets them fetch nothing and run only the site's own scripts, which first remove WebRTC.
  
  `Admin` takes `site` (`adminSite()` from `@goodfellow-cms/react`) and `frames` in place of `config`; `GitHost.source` lets the admin panel make the site's git host again. `goodfellow build` writes the frames' page at `admin/editor/`. Next.js sites get `app/admin/editor/page.tsx` (`GoodfellowEditor` from `@goodfellow-cms/next/editor`), their `app/admin/page.tsx` becomes a server component passing `site.admin()` to `GoodfellowAdmin`, and `goodfellow-next finish` writes the editor page's policy. An `app/admin/page.tsx` that still passes `config` loads every block's code itself, so the admin panel only says how to update it there and never signs in; `goodfellow-next update` replaces it with the starter's, and adds the editor page, wherever nobody has changed it, on its first run after this release. Every frame is sandboxed with `allow-scripts` alone, in `goodfellow dev` and `next dev` too: they bundle the frames as builds do, rebuild them as the site's code changes and reload the frames, leaving the admin panel's page as it is. `@goodfellow-cms/next` depends on Rolldown for that, loaded only in `next dev`.
- 11d4f6a: More for sites in several languages. Header & Footer picks a language and gives it a header or footer of its own. The page and item editors have a language menu that opens their translations, or makes one. The site checks suggest translating pages and items that have no translation or an out-of-date one, when a publish brings them, and builds list them. Events and stories say their language in their structured data. In Next.js, the header and footer stay in the shared layout, one for each language, and the browser shows the page's.
- 0b4972a: Site checks on rendered pages, finishing roadmap step 26. Publishing warns about images without a description, headings that skip a level and links whose text, such as "Click here", doesn't say where they go, on the pages it changes as they'll show. `goodfellow build`, and `goodfellow-next finish` for Next.js sites, check every built page for those and with axe-core's accessibility rules, explained in plain words, and say that automated checks find only some problems. Core's new `@goodfellow-cms/core/accessibility` entry has `checkBuiltPages()` and `reportSiteProblems()`, and `renderedProblems()` is in the main entry.
  
  Blocks' output is more accessible: the Image block has an "Only decoration" setting; logos beside the site's name and Collection list's pictures are marked as decoration; Collection list's item titles are level 2 headings when the list has no heading of its own, and Calendar's days are level 2; photo credits are no longer an `<aside>` inside the page's main content.
- 91b9a4c: Search engines and feeds: pages carry schema.org structured data (the site and its organization on the home page, events with their times and places, and dated items as articles), and collections whose items have pages and a date, such as news, get RSS and Atom feeds at `/feeds/<collection>.rss` and `.atom`, which every page links to. Both need the site's address. A page's settings can hide it from search engines, which also leaves it out of the sitemap, and the page editor shows how links to the page look when shared. `sendCalendarFile()` in `@goodfellow-cms/core/node` is now `sendBuildFile()`, which serves feeds too.
- 884a0be: Sites in several languages. Add languages in Site Settings → Languages, each with the site's name and description in it; its pages go under its code, such as `/es/about`. The Pages screen and collections' lists translate pages and items into each language, say when a translation is out of date, and the AI assistant can translate a page or item. Each language can have menus of its own, the new Language switch block links to the page in each language, and pages say their language, link to their translations with `hreflang`, and are listed with them in the sitemap. Search finds only pages in the page's own language, and lists, feeds and calendars show only that language's items.
- f9a405e: The token broker: a sign-in page on an address of its own, released as `@goodfellow-cms/broker`, which keeps editors' GitHub or GitLab sign-in and AI keys, shows the admin panel in a frame and makes every call to the git host and AI services for it, so nothing on the site's address can read them. It asks the editor in its own part of the page before publishing the site's code, custom code or a new Site address, installing a release or giving someone access, never changes workflows, and asks for owner tokens itself. The config's new `broker` line, which Site Settings' Security tab sets, makes the admin panel open only inside the broker, which the sign-in worker then gives tokens to alone. With a broker, the Blocks screen offers the config's other registries too. The admin address's guard and header rules let the broker frame the admin panel.

### Patch Changes

- 93c5b2c: Goodfellow needs Node.js 22.23.4, 24.22.1 or 26.12.1 or later. Earlier versions decompress Brotli unsafely (CVE-2026-111497, "Node2Shell"). Builds read other sites, such as Calendar blocks' feeds, so a feed's server could run code on the computer building the site. New sites' GitHub workflows (`deploy.yml`, `scheduled.yml`) set up Node with `check-latest: true`, so they always get the newest Node 22 instead of an older copy on GitHub's runner. To do the same on an existing site, add `check-latest: true` under `node-version: 22` in each `actions/setup-node` step of its `.github/workflows/` files. GitLab's `node:22` image already has the fix. On Cloudflare Pages and Vercel, check the Node.js version in the project's build settings.
- Updated dependencies [043358b]
- Updated dependencies [938e468]
- Updated dependencies [e819602]
- Updated dependencies [ba80f97]
- Updated dependencies [e62801d]
- Updated dependencies [38dcc3a]
- Updated dependencies [9b96dd3]
- Updated dependencies [1590ea2]
- Updated dependencies [78d29e5]
- Updated dependencies [11d4f6a]
- Updated dependencies [564d1dc]
- Updated dependencies [93c5b2c]
- Updated dependencies [0b4972a]
- Updated dependencies [2901de0]
- Updated dependencies [8ac5d0e]
- Updated dependencies [200f868]
- Updated dependencies [74bb2ad]
- Updated dependencies [91b9a4c]
- Updated dependencies [fd00d26]
- Updated dependencies [22ab254]
- Updated dependencies [884a0be]
- Updated dependencies [31217e1]
- Updated dependencies [f9a405e]
- Updated dependencies [e1e236d]
  - @goodfellow-cms/core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [6328aff]
- Updated dependencies [72607c8]
- Updated dependencies [4caf245]
  - @goodfellow-cms/core@0.4.0

## 0.3.0

### Minor Changes

- 6532990: Work on your site from Claude. Add Goodfellow's connector to Claude, sign in with GitHub or GitLab and choose your sites; Claude can then read and change pages, items, the header and footer, menus and settings in a draft, show you screenshots of them, and publish the draft or submit it for review, as a pull request or merge request. The new `@goodfellow-cms/mcp` package runs the same tools on your own computer, for Claude Code (`npx @goodfellow-cms/mcp`) and as a Claude Desktop extension, signed in with a token. A site's config can stop Claude publishing with `claude: { publish: false }`, so it only submits its changes for review. Claude sees the media library's sizes and credits, and can look at its images in screenshots. The GitHub and GitLab backends say how large files are without reading them (`fileSizes()`).
  
  For this, every build publishes `goodfellow-site.json`, describing the site's blocks and the content formats it reads, and the admin panel has a preview page (`#/preview`) that shows unpublished content for screenshots. The GitHub and GitLab backends can keep changes in drafts (`drafts`) and read many files at once (`readFiles()`), and the admin panel's change helpers are in `@goodfellow-cms/core`.
- ace4b9c: A Dark mode switch block lets visitors choose light or dark colors on sites with dark mode, as a switch (with or without the words Light and Dark) or a menu that can also follow their computer. Their choice is kept in their browser and put back before each page shows. Sites choose their code colors in Site Settings → Colors & fonts → Code colors, from Shiki's color schemes for light and for dark, and can show code on the site's subtle background color. Code on light-only sites now carries only its light colors.
  
  The Dark mode switch shows the page's colors from the start, rather than the sun until its script runs. Pages preload their text and heading fonts' files, read from Google Fonts when the site is built (`fontPreloads()`), so the browser fetches them alongside Google's stylesheet rather than after it, and the stand-in font rarely shows. A build that can't reach Google goes on without preloading. While a font loads, pages show stand-ins made with [Fontaine](https://github.com/unjs/fontaine): the computer's own fonts of the same kind, resized to take the same space, so text barely moves when the font arrives.
  
  Next.js sites made from the starter before this need `suppressHydrationWarning` on `<html>` in `app/layout.tsx` to use the Dark mode switch without a warning in `next dev`.
  
  Sites' fonts fall back to the computer's own fonts of the same kind, such as a serif for Fraunces, rather than always to a sans serif. Site Settings saves each font's kind (`theme.fonts.headingCategory` and `bodyCategory`) when it's chosen; fonts chosen before keep falling back to a sans serif until they're chosen again.
- 7e618c6: Dark mode for sites, which their owners turn on in Site Settings → Colors & fonts: sites stay light only until then. Every theme color has a dark one, pages follow each visitor's light or dark setting, and a site can have a second logo for dark backgrounds. The admin panel's previews show the site light or dark, like the admin panel or as chosen on the Theme tab, and Claude's screenshots can show it dark. Code blocks can be colored like the page, which new ones are, and code in Markdown is too. Blocks' `dark:` classes now apply only on sites with dark mode, so a light-only site never turns partly dark on a computer set to dark.
  
  The Claude Desktop extension is now packed without Anthropic's `mcpb` tool, and the connector no longer installs Puppeteer's browser downloader, leaving out packages with security advisories.
- 4d70cd8: The AI assistant can add openly licensed photos from Openverse where the media library has none that fit. Photos are saved to the media library with their credits in `content/media.json`, and pages list the credits of the photos they use. A checkbox in the AI panel turns it on or off, and `ai: { stockPhotos: false }` in the config turns it off for everyone.

### Patch Changes

- Updated dependencies [6532990]
- Updated dependencies [ace4b9c]
- Updated dependencies [7e618c6]
- Updated dependencies [2264969]
- Updated dependencies [4d70cd8]
  - @goodfellow-cms/core@0.3.0

## 0.2.0

### Minor Changes

- caa6d55: Calendars: collections get a "Date and time, for events" field (`event`), with all-day events, end times and repeats (daily, weekly on chosen days, monthly on a date or a weekday of the month, yearly, every so often, until a date, with dates to skip), in the site's new time zone setting. A collection whose settings name its event field (`calendar`) is a calendar: builds write it as `/calendars/<id>.ics` for visitors to subscribe to, and each event as its own file. The new Calendar block shows events coming up, or a month at a time with a page for each month, from a collection, another calendar's `.ics` address (read when the site is built) or both, with "Add to calendar" and "Subscribe" links; Add to calendar does the same on an event's page. Collection list and Entry field show events' next times. New collections can start as Events. `sitePages()` lists the pages builds write, month pages included, and `goodfellow-next finish` writes calendar files into Next.js exports. Repeats are expanded, and calendar files read and written, with [ical.js](https://github.com/kewisch/ical.js).
- 4b44513: Site settings can open links to other sites in a new tab ("Open links to other sites in a new tab" under General), for menus, buttons, rich text and Markdown. Links in rich text now open in the same tab otherwise: Puck opened every one in a new tab, marked `nofollow`, including links to the site's own pages.
- a210b23: Showing collections. Collection list gets a heading with a link beside it, filters by a choice or tags field, Z to A and any-field ordering, later pages (`/news/page/2`) and a page for each choice of a field (`/news/topics/music`). The new Collection loop block repeats blocks designed in the editor once for each item, with its values in placeholders such as `{title}`. Collections get a Tags field type (`tags`), for any number of a list's choices. Blocks can add pages to the page they're on with `withPages()` from `@goodfellow-cms/core`, which the Calendar block's month pages now use: `sitePages()` takes the site's blocks, and `Page.view` and `useSite().view` replace `Page.month` and `useSite().month`. `repeatsForEntries()` from `@goodfellow-cms/react` makes a block repeat its blocks for each item.
- 8f9eff2: A Video block: a video from the media library (MP4 or WebM, with a picture before it plays and WebVTT captions), YouTube (from its ID or any of its addresses, in the privacy-enhanced player), Vimeo (with do not track), or another site's player (from its embed address or code, sandboxed, and only from another secure site). It needs no JavaScript on the page. `youtubeVideo()`, `vimeoVideo()`, `embedPlayerUrl()` and the player addresses' helpers are in `@goodfellow-cms/core`. Media fields can hold videos (`mediaField(label, "video")`), whose chooser offers only videos, and WebVTT files can be uploaded.

### Patch Changes

- c97095c: The Form and Contact details blocks' notes in the editor link to Site Settings, scrolled to Forms or Contact details (`useSite().adminLink()`, which the editor supplies). The Form block also says when Web3Forms' free plan won't send visitors to a thank-you page on another site. "Get an access key from Web3Forms" opens Web3Forms' sign-up form, and the admin panel's menu says "Header & Footer" and "Site Settings".
- 699e0dd: Goodfellow's repository moved to the `goodfellow-cms` organization on GitHub. Package READMEs and repository links, and the admin panel's link to release notes, now point to https://github.com/goodfellow-cms/goodfellow-cms and the documentation at https://goodfellow-cms.github.io/goodfellow-cms/.
  
  The starters' READMEs link to the documentation instead of sections of Goodfellow's README, which is now shorter.
- a5fe669: Next.js sites send visitors much less JavaScript: the starter's pages load 186 kB (gzipped) instead of 513 kB. `@goodfellow-cms/react` is now built one file per module, so Client Components that import `SiteLink`, `SiteImage` or `useSite` from it, such as the Search block's box and the image carousel, no longer bring Puck and the page renderer with them.
- Updated dependencies [f776202]
- Updated dependencies [caa6d55]
- Updated dependencies [2c07c71]
- Updated dependencies [c8a935e]
- Updated dependencies [0e97dd2]
- Updated dependencies [03dc28f]
- Updated dependencies [4b44513]
- Updated dependencies [b61d3f2]
- Updated dependencies [699e0dd]
- Updated dependencies [b55c95c]
- Updated dependencies [ed49c5e]
- Updated dependencies [30c5903]
- Updated dependencies [8ea3680]
- Updated dependencies [66d7d1c]
- Updated dependencies [a210b23]
- Updated dependencies [8176568]
- Updated dependencies [d09a681]
- Updated dependencies [7785ef5]
- Updated dependencies [8f9eff2]
  - @goodfellow-cms/core@0.2.0

## 0.1.0

### Minor Changes

- fd6f851: Blocks from block registries. The admin panel has a **Blocks** screen that adds blocks built with shadcn/ui to the editor, and removes them, with no developer: adding one publishes its code into the site's `blocks/installed/` and the shadcn components it uses into `components/ui/`, in one commit, and the editor offers it once the site has been rebuilt. Removing a block is refused while content uses it, and keeps files someone has changed.
  
  `@goodfellow-cms/registry` is Goodfellow's registry, with nine blocks: Hero, Cards, Call to action, Testimonials, Notice, Pricing table, FAQ, Tabs and Image carousel. Its README documents the format for registries of blocks built with other libraries, which a site offers once its config lists them in `registries`.
  
  `create-goodfellow` starts new sites with the recommended blocks, or with `--blocks built-in` the built-in blocks only. `@goodfellow-cms/core` plans installs and removals (`planInstall()`, `planRemove()`), and its stores and the GitLab backend read and write the folders installed blocks use. `goodfellow dev` and `next dev` serve the site's copy of the registry, and `goodfellow` resolves `@/` imports from the site's root, as shadcn code expects. `@goodfellow-cms/react`'s theme adds the colors shadcn components use, such as `card` and `destructive`.
- 5492e22: Collections and templates. A collection, such as videos or events, lives in `content/collections/<name>/`: a `_collection.json` with its fields, an address pattern such as `/videos/{slug}` and a Puck template, plus one file per item. `goodfellow build` and `goodfellow dev` give every item a page from its collection's template, where `{field}` placeholders and the new template-only Entry field block show the item's values. The new Collection list block shows a collection's items on any page, as a list or cards, newest first, upcoming only, and so on. The admin panel has a Collections screen for creating collections, editing their fields and page design, and adding, editing, renaming and deleting items. `@goodfellow-cms/core` adds `allPages()`, `findEntry()` and the collection schemas; `@goodfellow-cms/react` adds a `template` Puck config, `templateOnly()` and `applyEntry()`.
- 2af75b7: Site settings has a Code tab for code from services such as Google Analytics: "In the page head" (script, style, link, meta, base and noscript tags, read with `parseHeadCode()`) and "At the end of the page" (any HTML), saved as `content/code/head.html` and `content/code/body.html`. `goodfellow build` and Next.js add it to every page with `HeadCode` and `BodyCode`; it never runs in the admin panel.
- ce5faee: A Custom HTML block in Goodfellow's block registry (not recommended, under "Advanced"), for HTML written by hand. `sanitizeHtml()` makes it safe by default; used exactly as written, it runs on the site but only in a sandboxed frame in the editor.
- 405de70: Client Components in blocks (`"use client"`) now run in the browser on sites built with `goodfellow build` and served by `goodfellow dev`, not only with Next.js. Each one a block uses becomes an island: its HTML is in the page as before, and the page loads React and that component's code to bring it to life, with `useSite()`, `useId()` and content passed as `children` working as they do in Next.js. Pages without Client Components still load no JavaScript. Client Components in packages of blocks are found too.
  
  `goodfellow build` now always bundles for production, so the admin panel no longer ships React's development build. `@goodfellow-cms/core` is published one file per module, so browser bundles that only need a helper such as `withBase()` leave out the content schemas.
- ece9ba5: The media library. A new **Media** screen uploads, replaces and deletes images and files in `public/media/`, saying where a file is used before deleting it. Image fields in blocks, page settings, collection items and site settings get a **Choose image** button that picks from the library or uploads a new file. Large photos are shrunk, JPEGs lose hidden details such as location, SVGs lose scripts, and only file types that can't run code are accepted. Previews show new uploads straight away, and add the site's base path to media addresses. `FileChange` can now carry `bytes`, and every store implements `readBytes()`, with both backends, their fakes and the development server supporting uploads. `@goodfellow-cms/react` adds `mediaField()`, used by the Image and Section blocks, and the AI assistant is told which images the site has.
- 04fc203: The Next.js starter shows the header and footer in a layout (`app/(site)/layout.tsx`, from `goodfellowPages().Layout`), so they stay as they are when moving between pages, and pages only send their own content. `@goodfellow-cms/react` exports `PageHeader`, `PageContent`, `PageFooter` and `prepareLayout()`. Menu marks current links with `data-current` and `aria-current`, which Next.js's layout sets in the browser, since it doesn't know the current page. In `next dev`, `withGoodfellow()` turns off React's debug channel, which made the browser's memory grow to gigabytes with the header and footer in a layout.
- de03c18: Add `@goodfellow-cms/next`, which puts a Goodfellow site in a Next.js app, exported as static files. Pages render as Server Components; blocks' links to the site's pages use `next/link` and images `next/image`, sites can be served from a subfolder (`basePath` or `GOODFELLOW_BASE`), and blocks can render Client Components with any hooks. In `next dev` the admin panel saves to the files on disk. `create-goodfellow` can start from a Next.js version of the starter (`--template next`).
  
  `@goodfellow-cms/react` gains a Server Components version (picked through the `react-server` condition), `preparePage()`, and `SiteLink` and `SiteImage`, which blocks use for links and images so they follow the site's base path and the renderer's components. The built-in blocks use them. `@goodfellow-cms/core` gains `withBase()`, `applyBasePath()` and `imageSize()`, and `@goodfellow-cms/core/node` reading sites from disk, image sizes, the local file store and the development API.
- cff2c58: Static rendering. `goodfellow build` turns a site's `content/` folder into static HTML, with Tailwind CSS built from the class names used in content, a sitemap, and support for serving from a subfolder. `goodfellow dev` re-renders pages as content changes, and `goodfellow preview` serves the built site. Includes the content file format (with versioning and migrations), the page renderer, and ten built-in blocks.

### Patch Changes

- 652b180: Markdown collections, code highlighting, search and blocks for documentation sites.
  
  - **Markdown collections:** a collection can store its items as Markdown files (`markdown: { body }` in its settings), with the other fields as YAML front matter. The admin panel's collection settings turn it on and convert every item; the body is edited in the formatted editor or a Markdown tab, and Markdown the formatted editor can't show, such as a table, is edited as Markdown only. `@goodfellow-cms/core` adds `parseMarkdownEntry()`, `serializeMarkdownEntry()`, `markdownToHtml()`, `markdownParts()`, `markdownHeadings()` and `canFormatMarkdown()`; HTML in Markdown is shown as text, and only safe addresses are kept.
  - **Code block:** code highlighted with Shiki when the site is built, with a title and a copy button. Code in Markdown text is highlighted too.
  - **Search block:** searches the site in the visitor's browser with Pagefind. Builds index a site only when a page has a search block (`data-goodfellow-search`); `goodfellow build` does it, `goodfellow index` indexes any built site, and Next.js sites run `goodfellow-next index out` after `next build`. Pages mark their main content for indexing.
  - **Collection navigation**, **Previous and next** and **On this page** blocks, for documentation and other sites with ordered collections.
  - Formatted text styles tables, images and code.
- 536f2a8: License under MIT.
- 4ca2dc1: Every package has a README, keywords and links to its documentation, repository and issues, for its page on npm. All the packages are released together with the same version.
- d91eea1: The packages are published under the `@goodfellow-cms` scope on npm, such as `@goodfellow-cms/core` and `@goodfellow-cms/react`, since `@goodfellow` was taken. `goodfellow` and `create-goodfellow` keep their names, and the block registry's name in `components.json` and refs such as `@goodfellow/shadcn-faq` stays `@goodfellow`.
- 3a4c60d: `cx()` now resolves conflicting Tailwind classes with tailwind-merge, so CSS classes added to a block in the editor override the block's own styles.
- Updated dependencies [1414af7]
- Updated dependencies [fd6f851]
- Updated dependencies [b4b80a6]
- Updated dependencies [5492e22]
- Updated dependencies [2af75b7]
- Updated dependencies [ce5faee]
- Updated dependencies [88ac239]
- Updated dependencies [652b180]
- Updated dependencies [1bfecf7]
- Updated dependencies [405de70]
- Updated dependencies [809001e]
- Updated dependencies [ece9ba5]
- Updated dependencies [536f2a8]
- Updated dependencies [de03c18]
- Updated dependencies [4ca2dc1]
- Updated dependencies [d91eea1]
- Updated dependencies [8c69eb5]
- Updated dependencies [cff2c58]
  - @goodfellow-cms/core@0.1.0
