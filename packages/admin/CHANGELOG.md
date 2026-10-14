# @goodfellow-cms/admin

## 0.2.0

### Minor Changes

- f776202: Plain-language explanations of failed rebuilds: the top bar's **What went wrong?** says whether the host didn't start the build, packages couldn't be installed, Pages isn't set up, a content file has a problem (linking to its version history), or the site's code couldn't be built, with the host's details behind a toggle. `goodfellow build` prints what went wrong for the admin panel, and an annotation on GitHub Actions. The GitHub backend now reads the deploy workflow's run, so a build that fails before deploying is reported as failed rather than building; the sign-in token link asks for Actions: read. The owner token now lasts a day, the shortest GitHub allows, instead of a week.
- caa6d55: Calendars: collections get a "Date and time, for events" field (`event`), with all-day events, end times and repeats (daily, weekly on chosen days, monthly on a date or a weekday of the month, yearly, every so often, until a date, with dates to skip), in the site's new time zone setting. A collection whose settings name its event field (`calendar`) is a calendar: builds write it as `/calendars/<id>.ics` for visitors to subscribe to, and each event as its own file. The new Calendar block shows events coming up, or a month at a time with a page for each month, from a collection, another calendar's `.ics` address (read when the site is built) or both, with "Add to calendar" and "Subscribe" links; Add to calendar does the same on an event's page. Collection list and Entry field show events' next times. New collections can start as Events. `sitePages()` lists the pages builds write, month pages included, and `goodfellow-next finish` writes calendar files into Next.js exports. Repeats are expanded, and calendar files read and written, with [ical.js](https://github.com/kewisch/ical.js).
- c8a935e: Custom domains: **Site settings → Domain** connects a domain to a site on GitHub Pages or GitLab Pages, lists the records to add at the registrar, and checks until it works (the records, the host's HTTPS certificate, and the site at its new address), then sends everyone to the secure address. Backends' new optional `pages` capability does the host's part; `checkRecords()` and `domainZone()` in core check DNS. GitHub tokens need the Pages permission to connect a domain, and the screen links to one that has it. Where editors sign in by being sent to the host and back, the screen reminds owners to allow the admin panel's new address.
- 03dc28f: Editors: **Site settings → Editors** lists who edits the site, and lets owners invite people (by username, or on GitLab by email), make them editors or owners, and remove them. Backends gain an optional `editors` capability. On GitHub, changing editors and GitHub Pages settings needs an owner token, which the new `ownerAccess` keeps in memory for the tab only; it replaces the Pages token link (`PagesDomains.tokenLink` is removed). On GitLab, owners can let editors publish to the main branch.
- 4b44513: Site settings can open links to other sites in a new tab ("Open links to other sites in a new tab" under General), for menus, buttons, rich text and Markdown. Links in rich text now open in the same tab otherwise: Puck opened every one in a new tab, marked `nofollow`, including links to the site's own pages.
- b61d3f2: Forms: a Form block whose questions are set in the editor. It's a plain HTML form, with no JavaScript, that posts its answers to the form service chosen in Site settings (Web3Forms by default, Formspree, or any service that takes a plain form post), which emails them and sends visitors back to a thank-you page. Every form has a hidden honeypot field, and Web3Forms' hCaptcha can be turned on in Site settings. The block can also show a Google form from its embed code. `formTarget()`, `formRedirect()` and `googleFormUrl()` are in `@goodfellow-cms/core`, and `content/site.json` has a new optional `forms` setting.
- 30c5903: Redirects: the page at an old address now says where it's sending visitors, with a link named after the page, in words the Redirects tab can change, and replaces itself in the browser's history, so Back no longer needs pressing twice. On Vercel, Vercel sends the redirects itself: new sites have a `vercel.ts` in place of `vercel.json` that reads them, and Next.js sites get them from `withGoodfellow()`. Redirects from addresses that pages have are left out, so pages still win.
- 8ea3680: Redirects: Site Settings has a Redirects tab for sending visitors from old addresses to new ones, and changing a page's address adds a redirect from its old one. Builds write a page at each old address that sends visitors on at once, which works on every host, `goodfellow dev` and `next dev` follow them too, and `goodfellow-next finish` writes them into Next.js exports.
- a210b23: Showing collections. Collection list gets a heading with a link beside it, filters by a choice or tags field, Z to A and any-field ordering, later pages (`/news/page/2`) and a page for each choice of a field (`/news/topics/music`). The new Collection loop block repeats blocks designed in the editor once for each item, with its values in placeholders such as `{title}`. Collections get a Tags field type (`tags`), for any number of a list's choices. Blocks can add pages to the page they're on with `withPages()` from `@goodfellow-cms/core`, which the Calendar block's month pages now use: `sitePages()` takes the site's blocks, and `Page.view` and `useSite().view` replace `Page.month` and `useSite().month`. `repeatsForEntries()` from `@goodfellow-cms/react` makes a block repeat its blocks for each item.
- d09a681: Automatic updates: `goodfellow update` (and `goodfellow-next update`) updates a site to Goodfellow's newest fixes, or a release it's given, with the Puck version that release uses, and updates blocks from Goodfellow's registry, replacing only files nobody changed (`planUpdate()`). It publishes the update only once the site installs and builds with it, and otherwise puts everything back. The starters' GitHub Pages and GitLab Pages setups run it each night. **Site settings → Updates** shows the site's release, fixes and newer releases, and the last update, installs fixes now, lets owners install a newer release, and on GitLab turns on job token pushes and a nightly schedule. Owners can turn automatic fixes off and go back to the previous release, which updates then skip until it's allowed again; these settings live in a new content file, `content/updates.json`. Backends gain an optional `updates` capability; the GitHub owner token can now run workflows.
- 7785ef5: Version history: pages, the header and footer, and collections' items have a **Version history** screen in the admin panel, listing every published version with who published it and when, a preview of each, and **Restore this version**, which publishes it again. Backends gain `history()` and `readAt()`, implemented for GitHub and GitLab and their fakes.
- 8f9eff2: A Video block: a video from the media library (MP4 or WebM, with a picture before it plays and WebVTT captions), YouTube (from its ID or any of its addresses, in the privacy-enhanced player), Vimeo (with do not track), or another site's player (from its embed address or code, sandboxed, and only from another secure site). It needs no JavaScript on the page. `youtubeVideo()`, `vimeoVideo()`, `embedPlayerUrl()` and the player addresses' helpers are in `@goodfellow-cms/core`. Media fields can hold videos (`mediaField(label, "video")`), whose chooser offers only videos, and WebVTT files can be uploaded.

### Patch Changes

- 84cfc23: The admin panel's tab shows the site's icon, as its pages do, instead of the browser's default: the admin page names it before the admin panel loads, and the admin panel follows a new icon as soon as it's published, even before the live site has been rebuilt with it. Next.js sites show it in the sign-in screen too by using `site.adminMetadata()` in `app/admin/layout.tsx`, as the starter now does.
- 2c07c71: Hardening from code scanning: trimming slashes and other characters no longer uses patterns that slow down on long runs of them (core's new `trimChars()`), and nor do reading SVG sizes, typed domains, link targets and README notes; heading anchors and rich text as plain text take tags out by scanning the text. Search results show any `<` or `>` in an excerpt as text, apart from Pagefind's highlights. Link targets decode an address's entities once, as browsers do. SVG uploads also lose `vbscript:` links and `data:` links other than images. Islands' generated module escapes `<`, `>` and line separators in names and paths.
- 4000e48: The demo banner and the message after publishing in a demo now say that changes show only in the admin panel, and that the site itself doesn't change.
- 0e97dd2: When the admin panel on your computer can't reach the development server's API, for example because another server answers at that address, its error says so and where it looked, instead of "Cannot read properties of undefined". The admin panel calls the development API with a trailing slash, so a Next.js site's `trailingSlash` setting has nothing to redirect. Browsers keep those permanent redirects and later apply them to whatever runs on the same port, which broke `goodfellow dev`'s admin panel after a Next.js site had run there. The API also accepts its addresses without one.
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
  - @goodfellow-cms/ai@0.2.0
  - @goodfellow-cms/registry@0.2.0

## 0.1.0

### Minor Changes

- 1d4191f: The admin panel has a dark mode. It follows the computer's light or dark setting, or the choice in its top bar's color menu, which the browser remembers. Puck's own colors and the code editor follow it; site previews keep the site's colors.
- 1414af7: The AI assistant. A new **AI** tab in every editor writes with AI: it adds blocks to a page, changes the selected block, or fills in a collection item's fields, and its answer goes straight into the editor to check, change or undo. Editors choose the service and use their own key, kept only in their browser: Claude through the official SDK with structured outputs, OpenAI, Gemini, Groq, Mistral, OpenRouter, the keyless OVHcloud AI Endpoints, any OpenAI-compatible service, or any chat app by copy and paste. The new `@goodfellow-cms/ai` package builds the requests, checks answers against the site's blocks and fields, and talks to the services; `@goodfellow-cms/ai/testing` fakes them. Sites can limit the services with `ai: { providers }` or remove the assistant with `ai: false`.
- fd6f851: Blocks from block registries. The admin panel has a **Blocks** screen that adds blocks built with shadcn/ui to the editor, and removes them, with no developer: adding one publishes its code into the site's `blocks/installed/` and the shadcn components it uses into `components/ui/`, in one commit, and the editor offers it once the site has been rebuilt. Removing a block is refused while content uses it, and keeps files someone has changed.
  
  `@goodfellow-cms/registry` is Goodfellow's registry, with nine blocks: Hero, Cards, Call to action, Testimonials, Notice, Pricing table, FAQ, Tabs and Image carousel. Its README documents the format for registries of blocks built with other libraries, which a site offers once its config lists them in `registries`.
  
  `create-goodfellow` starts new sites with the recommended blocks, or with `--blocks built-in` the built-in blocks only. `@goodfellow-cms/core` plans installs and removals (`planInstall()`, `planRemove()`), and its stores and the GitLab backend read and write the folders installed blocks use. `goodfellow dev` and `next dev` serve the site's copy of the registry, and `goodfellow` resolves `@/` imports from the site's root, as shadcn code expects. `@goodfellow-cms/react`'s theme adds the colors shadcn components use, such as `card` and `destructive`.
- b4b80a6: The Blocks screen marks blocks to add and remove, and publishes them all in one save. `planBlockChanges()` plans several adds and removes together, each as if the ones before it had been published.
- 2e85621: Custom CSS and the site's code are edited in a code editor (CodeMirror, loaded when first shown) that indents, closes brackets, suggests CSS properties and values or HTML tags, and finds and replaces. Undo in Site settings no longer counts a change that leaves every value the same as a step.
- 5492e22: Collections and templates. A collection, such as videos or events, lives in `content/collections/<name>/`: a `_collection.json` with its fields, an address pattern such as `/videos/{slug}` and a Puck template, plus one file per item. `goodfellow build` and `goodfellow dev` give every item a page from its collection's template, where `{field}` placeholders and the new template-only Entry field block show the item's values. The new Collection list block shows a collection's items on any page, as a list or cards, newest first, upcoming only, and so on. The admin panel has a Collections screen for creating collections, editing their fields and page design, and adding, editing, renaming and deleting items. `@goodfellow-cms/core` adds `allPages()`, `findEntry()` and the collection schemas; `@goodfellow-cms/react` adds a `template` Puck config, `templateOnly()` and `applyEntry()`.
- 2af75b7: Site settings has a Code tab for code from services such as Google Analytics: "In the page head" (script, style, link, meta, base and noscript tags, read with `parseHeadCode()`) and "At the end of the page" (any HTML), saved as `content/code/head.html` and `content/code/body.html`. `goodfellow build` and Next.js add it to every page with `HeadCode` and `BodyCode`; it never runs in the admin panel.
- 88ac239: Demo mode. A site whose config sets `demo: true` opens its admin panel to anyone, with no sign-in and a banner saying it's a demo. Visitors can try everything editors can, but nothing is published: Publish saves their changes, uploads included, in their own browser (IndexedDB), where they stay until the visitor clicks Start over. The Blocks screen lists blocks without adding or removing them.
  
  The demo starts from a copy of the site's content that builds include at `/admin/demo-content.json`, so no git host is called and the repository can stay private. `goodfellow build` writes it, along with the admin panel, for demo sites; Next.js sites serve it with `demoContent` from `goodfellowPages()`, in a new `app/admin/demo-content.json/route.ts`. `@goodfellow-cms/core` adds `demoContent()`, `demoStore()` and the config's `demo` option.
- 652b180: Markdown collections, code highlighting, search and blocks for documentation sites.
  
  - **Markdown collections:** a collection can store its items as Markdown files (`markdown: { body }` in its settings), with the other fields as YAML front matter. The admin panel's collection settings turn it on and convert every item; the body is edited in the formatted editor or a Markdown tab, and Markdown the formatted editor can't show, such as a table, is edited as Markdown only. `@goodfellow-cms/core` adds `parseMarkdownEntry()`, `serializeMarkdownEntry()`, `markdownToHtml()`, `markdownParts()`, `markdownHeadings()` and `canFormatMarkdown()`; HTML in Markdown is shown as text, and only safe addresses are kept.
  - **Code block:** code highlighted with Shiki when the site is built, with a title and a copy button. Code in Markdown text is highlighted too.
  - **Search block:** searches the site in the visitor's browser with Pagefind. Builds index a site only when a page has a search block (`data-goodfellow-search`); `goodfellow build` does it, `goodfellow index` indexes any built site, and Next.js sites run `goodfellow-next index out` after `next build`. Pages mark their main content for indexing.
  - **Collection navigation**, **Previous and next** and **On this page** blocks, for documentation and other sites with ordered collections.
  - Formatted text styles tables, images and code.
- 1bfecf7: Publishing to GitHub and GitLab. New `@goodfellow-cms/github` and `@goodfellow-cms/gitlab` backends edit a site's repository straight from the browser: GitHub with an access token from a prefilled link, GitLab with one-click OAuth (PKCE) or a token. Set `backend` in `goodfellow.config.tsx` and `goodfellow build` includes the admin panel at `/admin/`, with a sign-in screen, an account menu and a live-site status that follows the deploy after each publish. `@goodfellow-cms/core` adds the `GitHost` and `GitBackend` interfaces, `writeChanges()` (which saves over other people's changes to other files but never the same ones), and `@goodfellow-cms/core/testing` with an in-memory repository for fakes. `goodfellow dev` gives each site its own Vite cache and keeps watching content when folders are replaced.
- 809001e: The admin panel, running against local files. `goodfellow dev` now serves it at `/admin`: edit pages, the header and footer in Puck, and site settings (general, colors and fonts, menus and custom CSS) with a live preview. Classes typed in the editor are styled immediately by Tailwind running in the browser. Saves are single writes that refuse to overwrite changes made since the editor loaded. `@goodfellow-cms/core` adds the `ContentStore` interface, `ConflictError`, `isEditablePath` and reserved page addresses (`/admin`).
- ece9ba5: The media library. A new **Media** screen uploads, replaces and deletes images and files in `public/media/`, saying where a file is used before deleting it. Image fields in blocks, page settings, collection items and site settings get a **Choose image** button that picks from the library or uploads a new file. Large photos are shrunk, JPEGs lose hidden details such as location, SVGs lose scripts, and only file types that can't run code are accepted. Previews show new uploads straight away, and add the site's base path to media addresses. `FileChange` can now carry `bytes`, and every store implements `readBytes()`, with both backends, their fakes and the development server supporting uploads. `@goodfellow-cms/react` adds `mediaField()`, used by the Image and Section blocks, and the AI assistant is told which images the site has.
- 56dbc36: Site settings has Undo and Redo, across every tab, with typing in a field undone as one step; Ctrl+Z and Ctrl+Shift+Z (⌘Z and ⇧⌘Z on a Mac) work outside text fields. Fonts are chosen from a searchable list of Google Fonts, each shown in its own typeface, with "Site default" for each visitor's standard font.
- 8c69eb5: Add `create-goodfellow`, which creates a new site from the starter or the parish example (`npm create goodfellow@latest my-site`), and can set up where the site is stored and hosted. Sites can now keep their contact details (address, phone and email) in Site settings, shown wherever the new Contact details block is placed. A collection's link fields can choose an uploaded file, such as a PDF.

### Patch Changes

- c7ab18e: The item editor leaves out Puck's Blocks and Outline buttons, starts with the AI assistant closed, and gives the fields sidebar a wider width of its own, remembered separately from other editors. The formatted text editor is as tall as the Markdown one.
- 4ca2dc1: Every package has a README, keywords and links to its documentation, repository and issues, for its page on npm. All the packages are released together with the same version.
- d91eea1: The packages are published under the `@goodfellow-cms` scope on npm, such as `@goodfellow-cms/core` and `@goodfellow-cms/react`, since `@goodfellow` was taken. `goodfellow` and `create-goodfellow` keep their names, and the block registry's name in `components.json` and refs such as `@goodfellow/shadcn-faq` stays `@goodfellow`.
- Updated dependencies [1414af7]
- Updated dependencies [fd6f851]
- Updated dependencies [b4b80a6]
- Updated dependencies [5492e22]
- Updated dependencies [2af75b7]
- Updated dependencies [0ed1018]
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
  - @goodfellow-cms/ai@0.1.0
  - @goodfellow-cms/core@0.1.0
  - @goodfellow-cms/registry@0.1.0
  - @goodfellow-cms/react@0.1.0
