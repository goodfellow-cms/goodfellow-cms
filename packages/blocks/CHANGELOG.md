# @goodfellow-cms/blocks

## 0.6.0

### Minor Changes

- 6bf08ae: Every part of a block has a stable name, such as `gf-heading` or `gf-card-title`, and **Colors & fonts → Blocks' parts** gives a part classes for every block of that kind at once, kept in `content/site.json`'s `theme.parts`. A part's classes come after the block's own and before what's chosen for each block, so a choice made for one block still wins. Blocks name their parts with `useParts()` and declare them with `withParts()`, from `@goodfellow-cms/react`; the registry's blocks name theirs after themselves, such as `gf-shadcn-cards-title`. Images and videos with **Rounded corners** off now have the `rounded-none` class, and Rows that don't wrap `flex-nowrap`, so a theme's classes can't change them.
- b9b0434: Built-in blocks for WordPress's core blocks Goodfellow had nothing like: Separator, Pullquote, Preformatted text, Verse, Details, Table (edited in a grid of cells, which the AI assistant can fill in too), File, Audio, Media and text, Gallery and Page list. Sections get a cover's color over the background, its strength, a least height and the part of the picture to keep in view, and Site name and logo can show the site's description under the name. Moving from WordPress keeps these blocks as they are, falling back to the blocks used before on sites without them, and exporting to WordPress makes them WordPress's own again. Media fields can hold sound files (`mediaField(label, "audio")`), blocks can read the site's pages with `useSite().pages`, and `tableField()` gives a block a table's cells.

### Patch Changes

- fbf76bb: Inline code, plain code blocks and table headings in rich text and Markdown take their tint from the text around them, so they stay readable on sections with a primary or dark background. `goodfellow dev` runs a block's interactive parts again after the block is removed and added back.
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
  - @goodfellow-cms/react@0.6.0

## 0.5.0

### Minor Changes

- 11d4f6a: More for sites in several languages. Header & Footer picks a language and gives it a header or footer of its own. The page and item editors have a language menu that opens their translations, or makes one. The site checks suggest translating pages and items that have no translation or an out-of-date one, when a publish brings them, and builds list them. Events and stories say their language in their structured data. In Next.js, the header and footer stay in the shared layout, one for each language, and the browser shows the page's.
- 564d1dc: Sites rebuild overnight only when visitors would see something new. Every build writes `goodfellow-build.json` with what it was built from and when what it shows by today's date next changes, and the starters' setups run `goodfellow nightly` (or `goodfellow-next nightly`) first each night, building only when there are fixes to install, something dated has changed, or the live site isn't the newest build. On GitLab Pages, a night with nothing new publishes the live site's files again. The Updates screen lets owners choose to rebuild overnight only when something changed, every night or never, and has Rebuild now. On GitHub the choice is the `GOODFELLOW_NIGHTLY` repository variable, which the sign-in service's owners' app now asks for the Variables permission to set.
- 0b4972a: Site checks on rendered pages, finishing roadmap step 26. Publishing warns about images without a description, headings that skip a level and links whose text, such as "Click here", doesn't say where they go, on the pages it changes as they'll show. `goodfellow build`, and `goodfellow-next finish` for Next.js sites, check every built page for those and with axe-core's accessibility rules, explained in plain words, and say that automated checks find only some problems. Core's new `@goodfellow-cms/core/accessibility` entry has `checkBuiltPages()` and `reportSiteProblems()`, and `renderedProblems()` is in the main entry.
  
  Blocks' output is more accessible: the Image block has an "Only decoration" setting; logos beside the site's name and Collection list's pictures are marked as decoration; Collection list's item titles are level 2 headings when the list has no heading of its own, and Calendar's days are level 2; photo credits are no longer an `<aside>` inside the page's main content.
- 884a0be: Sites in several languages. Add languages in Site Settings → Languages, each with the site's name and description in it; its pages go under its code, such as `/es/about`. The Pages screen and collections' lists translate pages and items into each language, say when a translation is out of date, and the AI assistant can translate a page or item. Each language can have menus of its own, the new Language switch block links to the page in each language, and pages say their language, link to their translations with `hreflang`, and are listed with them in the sitemap. Search finds only pages in the page's own language, and lists, feeds and calendars show only that language's items.

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
  - @goodfellow-cms/react@0.5.0

## 0.4.0

### Patch Changes

- a622652: The Search block works in Next.js sites: it passed all its props to its search box, including Puck's functions, which Next.js can't send to the browser, so pages with one failed to build.
- Updated dependencies [6328aff]
- Updated dependencies [72607c8]
- Updated dependencies [4caf245]
  - @goodfellow-cms/core@0.4.0
  - @goodfellow-cms/react@0.4.0

## 0.3.0

### Minor Changes

- ace4b9c: A Dark mode switch block lets visitors choose light or dark colors on sites with dark mode, as a switch (with or without the words Light and Dark) or a menu that can also follow their computer. Their choice is kept in their browser and put back before each page shows. Sites choose their code colors in Site Settings → Colors & fonts → Code colors, from Shiki's color schemes for light and for dark, and can show code on the site's subtle background color. Code on light-only sites now carries only its light colors.
  
  The Dark mode switch shows the page's colors from the start, rather than the sun until its script runs. Pages preload their text and heading fonts' files, read from Google Fonts when the site is built (`fontPreloads()`), so the browser fetches them alongside Google's stylesheet rather than after it, and the stand-in font rarely shows. A build that can't reach Google goes on without preloading. While a font loads, pages show stand-ins made with [Fontaine](https://github.com/unjs/fontaine): the computer's own fonts of the same kind, resized to take the same space, so text barely moves when the font arrives.
  
  Next.js sites made from the starter before this need `suppressHydrationWarning` on `<html>` in `app/layout.tsx` to use the Dark mode switch without a warning in `next dev`.
  
  Sites' fonts fall back to the computer's own fonts of the same kind, such as a serif for Fraunces, rather than always to a sans serif. Site Settings saves each font's kind (`theme.fonts.headingCategory` and `bodyCategory`) when it's chosen; fonts chosen before keep falling back to a sans serif until they're chosen again.
- 7e618c6: Dark mode for sites, which their owners turn on in Site Settings → Colors & fonts: sites stay light only until then. Every theme color has a dark one, pages follow each visitor's light or dark setting, and a site can have a second logo for dark backgrounds. The admin panel's previews show the site light or dark, like the admin panel or as chosen on the Theme tab, and Claude's screenshots can show it dark. Code blocks can be colored like the page, which new ones are, and code in Markdown is too. Blocks' `dark:` classes now apply only on sites with dark mode, so a light-only site never turns partly dark on a computer set to dark.
  
  The Claude Desktop extension is now packed without Anthropic's `mcpb` tool, and the connector no longer installs Puppeteer's browser downloader, leaving out packages with security advisories.

### Patch Changes

- Updated dependencies [6532990]
- Updated dependencies [ace4b9c]
- Updated dependencies [7e618c6]
- Updated dependencies [2264969]
- Updated dependencies [4d70cd8]
  - @goodfellow-cms/core@0.3.0
  - @goodfellow-cms/react@0.3.0

## 0.2.0

### Minor Changes

- caa6d55: Calendars: collections get a "Date and time, for events" field (`event`), with all-day events, end times and repeats (daily, weekly on chosen days, monthly on a date or a weekday of the month, yearly, every so often, until a date, with dates to skip), in the site's new time zone setting. A collection whose settings name its event field (`calendar`) is a calendar: builds write it as `/calendars/<id>.ics` for visitors to subscribe to, and each event as its own file. The new Calendar block shows events coming up, or a month at a time with a page for each month, from a collection, another calendar's `.ics` address (read when the site is built) or both, with "Add to calendar" and "Subscribe" links; Add to calendar does the same on an event's page. Collection list and Entry field show events' next times. New collections can start as Events. `sitePages()` lists the pages builds write, month pages included, and `goodfellow-next finish` writes calendar files into Next.js exports. Repeats are expanded, and calendar files read and written, with [ical.js](https://github.com/kewisch/ical.js).
- 4b44513: Site settings can open links to other sites in a new tab ("Open links to other sites in a new tab" under General), for menus, buttons, rich text and Markdown. Links in rich text now open in the same tab otherwise: Puck opened every one in a new tab, marked `nofollow`, including links to the site's own pages.
- b61d3f2: Forms: a Form block whose questions are set in the editor. It's a plain HTML form, with no JavaScript, that posts its answers to the form service chosen in Site settings (Web3Forms by default, Formspree, or any service that takes a plain form post), which emails them and sends visitors back to a thank-you page. Every form has a hidden honeypot field, and Web3Forms' hCaptcha can be turned on in Site settings. The block can also show a Google form from its embed code. `formTarget()`, `formRedirect()` and `googleFormUrl()` are in `@goodfellow-cms/core`, and `content/site.json` has a new optional `forms` setting.
- a210b23: Showing collections. Collection list gets a heading with a link beside it, filters by a choice or tags field, Z to A and any-field ordering, later pages (`/news/page/2`) and a page for each choice of a field (`/news/topics/music`). The new Collection loop block repeats blocks designed in the editor once for each item, with its values in placeholders such as `{title}`. Collections get a Tags field type (`tags`), for any number of a list's choices. Blocks can add pages to the page they're on with `withPages()` from `@goodfellow-cms/core`, which the Calendar block's month pages now use: `sitePages()` takes the site's blocks, and `Page.view` and `useSite().view` replace `Page.month` and `useSite().month`. `repeatsForEntries()` from `@goodfellow-cms/react` makes a block repeat its blocks for each item.
- 8f9eff2: A Video block: a video from the media library (MP4 or WebM, with a picture before it plays and WebVTT captions), YouTube (from its ID or any of its addresses, in the privacy-enhanced player), Vimeo (with do not track), or another site's player (from its embed address or code, sandboxed, and only from another secure site). It needs no JavaScript on the page. `youtubeVideo()`, `vimeoVideo()`, `embedPlayerUrl()` and the player addresses' helpers are in `@goodfellow-cms/core`. Media fields can hold videos (`mediaField(label, "video")`), whose chooser offers only videos, and WebVTT files can be uploaded.

### Patch Changes

- 2c07c71: Hardening from code scanning: trimming slashes and other characters no longer uses patterns that slow down on long runs of them (core's new `trimChars()`), and nor do reading SVG sizes, typed domains, link targets and README notes; heading anchors and rich text as plain text take tags out by scanning the text. Search results show any `<` or `>` in an excerpt as text, apart from Pagefind's highlights. Link targets decode an address's entities once, as browsers do. SVG uploads also lose `vbscript:` links and `data:` links other than images. Islands' generated module escapes `<`, `>` and line separators in names and paths.
- c97095c: The Form and Contact details blocks' notes in the editor link to Site Settings, scrolled to Forms or Contact details (`useSite().adminLink()`, which the editor supplies). The Form block also says when Web3Forms' free plan won't send visitors to a thank-you page on another site. "Get an access key from Web3Forms" opens Web3Forms' sign-up form, and the admin panel's menu says "Header & Footer" and "Site Settings".
- 699e0dd: Goodfellow's repository moved to the `goodfellow-cms` organization on GitHub. Package READMEs and repository links, and the admin panel's link to release notes, now point to https://github.com/goodfellow-cms/goodfellow-cms and the documentation at https://goodfellow-cms.github.io/goodfellow-cms/.
  
  The starters' READMEs link to the documentation instead of sections of Goodfellow's README, which is now shorter.
- b55c95c: Only the first block on a page with pages of its own links to them, calendars by the month included, and the editor and its previews now show a page as the site does, with a note on each block that would have pages but doesn't (`pageView()` in `@goodfellow-cms/core`). A calendar's month stays in the middle of its heading with or without links to the months around it. "Published." now shows just under the Publish button, and goes after a few seconds or as soon as anything changes.
- Updated dependencies [f776202]
- Updated dependencies [caa6d55]
- Updated dependencies [2c07c71]
- Updated dependencies [c8a935e]
- Updated dependencies [0e97dd2]
- Updated dependencies [03dc28f]
- Updated dependencies [4b44513]
- Updated dependencies [c97095c]
- Updated dependencies [b61d3f2]
- Updated dependencies [699e0dd]
- Updated dependencies [b55c95c]
- Updated dependencies [ed49c5e]
- Updated dependencies [30c5903]
- Updated dependencies [8ea3680]
- Updated dependencies [66d7d1c]
- Updated dependencies [a210b23]
- Updated dependencies [8176568]
- Updated dependencies [a5fe669]
- Updated dependencies [d09a681]
- Updated dependencies [7785ef5]
- Updated dependencies [8f9eff2]
  - @goodfellow-cms/core@0.2.0
  - @goodfellow-cms/react@0.2.0

## 0.1.0

### Minor Changes

- 5492e22: Collections and templates. A collection, such as videos or events, lives in `content/collections/<name>/`: a `_collection.json` with its fields, an address pattern such as `/videos/{slug}` and a Puck template, plus one file per item. `goodfellow build` and `goodfellow dev` give every item a page from its collection's template, where `{field}` placeholders and the new template-only Entry field block show the item's values. The new Collection list block shows a collection's items on any page, as a list or cards, newest first, upcoming only, and so on. The admin panel has a Collections screen for creating collections, editing their fields and page design, and adding, editing, renaming and deleting items. `@goodfellow-cms/core` adds `allPages()`, `findEntry()` and the collection schemas; `@goodfellow-cms/react` adds a `template` Puck config, `templateOnly()` and `applyEntry()`.
- 652b180: Markdown collections, code highlighting, search and blocks for documentation sites.
  
  - **Markdown collections:** a collection can store its items as Markdown files (`markdown: { body }` in its settings), with the other fields as YAML front matter. The admin panel's collection settings turn it on and convert every item; the body is edited in the formatted editor or a Markdown tab, and Markdown the formatted editor can't show, such as a table, is edited as Markdown only. `@goodfellow-cms/core` adds `parseMarkdownEntry()`, `serializeMarkdownEntry()`, `markdownToHtml()`, `markdownParts()`, `markdownHeadings()` and `canFormatMarkdown()`; HTML in Markdown is shown as text, and only safe addresses are kept.
  - **Code block:** code highlighted with Shiki when the site is built, with a title and a copy button. Code in Markdown text is highlighted too.
  - **Search block:** searches the site in the visitor's browser with Pagefind. Builds index a site only when a page has a search block (`data-goodfellow-search`); `goodfellow build` does it, `goodfellow index` indexes any built site, and Next.js sites run `goodfellow-next index out` after `next build`. Pages mark their main content for indexing.
  - **Collection navigation**, **Previous and next** and **On this page** blocks, for documentation and other sites with ordered collections.
  - Formatted text styles tables, images and code.
- ece9ba5: The media library. A new **Media** screen uploads, replaces and deletes images and files in `public/media/`, saying where a file is used before deleting it. Image fields in blocks, page settings, collection items and site settings get a **Choose image** button that picks from the library or uploads a new file. Large photos are shrunk, JPEGs lose hidden details such as location, SVGs lose scripts, and only file types that can't run code are accepted. Previews show new uploads straight away, and add the site's base path to media addresses. `FileChange` can now carry `bytes`, and every store implements `readBytes()`, with both backends, their fakes and the development server supporting uploads. `@goodfellow-cms/react` adds `mediaField()`, used by the Image and Section blocks, and the AI assistant is told which images the site has.
- de03c18: Add `@goodfellow-cms/next`, which puts a Goodfellow site in a Next.js app, exported as static files. Pages render as Server Components; blocks' links to the site's pages use `next/link` and images `next/image`, sites can be served from a subfolder (`basePath` or `GOODFELLOW_BASE`), and blocks can render Client Components with any hooks. In `next dev` the admin panel saves to the files on disk. `create-goodfellow` can start from a Next.js version of the starter (`--template next`).
  
  `@goodfellow-cms/react` gains a Server Components version (picked through the `react-server` condition), `preparePage()`, and `SiteLink` and `SiteImage`, which blocks use for links and images so they follow the site's base path and the renderer's components. The built-in blocks use them. `@goodfellow-cms/core` gains `withBase()`, `applyBasePath()` and `imageSize()`, and `@goodfellow-cms/core/node` reading sites from disk, image sizes, the local file store and the development API.
- 8c69eb5: Add `create-goodfellow`, which creates a new site from the starter or the parish example (`npm create goodfellow@latest my-site`), and can set up where the site is stored and hosted. Sites can now keep their contact details (address, phone and email) in Site settings, shown wherever the new Contact details block is placed. A collection's link fields can choose an uploaded file, such as a PDF.
- cff2c58: Static rendering. `goodfellow build` turns a site's `content/` folder into static HTML, with Tailwind CSS built from the class names used in content, a sitemap, and support for serving from a subfolder. `goodfellow dev` re-renders pages as content changes, and `goodfellow preview` serves the built site. Includes the content file format (with versioning and migrations), the page renderer, and ten built-in blocks.

### Patch Changes

- 536f2a8: License under MIT.
- 04fc203: The Next.js starter shows the header and footer in a layout (`app/(site)/layout.tsx`, from `goodfellowPages().Layout`), so they stay as they are when moving between pages, and pages only send their own content. `@goodfellow-cms/react` exports `PageHeader`, `PageContent`, `PageFooter` and `prepareLayout()`. Menu marks current links with `data-current` and `aria-current`, which Next.js's layout sets in the browser, since it doesn't know the current page. In `next dev`, `withGoodfellow()` turns off React's debug channel, which made the browser's memory grow to gigabytes with the header and footer in a layout.
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
- Updated dependencies [04fc203]
- Updated dependencies [de03c18]
- Updated dependencies [4ca2dc1]
- Updated dependencies [d91eea1]
- Updated dependencies [8c69eb5]
- Updated dependencies [cff2c58]
- Updated dependencies [3a4c60d]
  - @goodfellow-cms/core@0.1.0
  - @goodfellow-cms/react@0.1.0
