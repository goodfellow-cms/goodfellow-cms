# goodfellow

## 0.4.0

### Minor Changes

- 72607c8: A site's content can be kept in a repository of its own (roadmap step 25), so editors' sign-in, publishing and a full-stack site's server can change the content but never the code.
  
  - `github({ repo, contentOnly: true })` and `gitlab({ project, contentOnly: true })` point the admin panel at a repository that holds only `content/` and `public/media/`. Backends refuse to write anything else (`CodeChangeError`), and so does a full-stack site's API. The admin panel has no Blocks screen there, since adding a block changes the code, and its Updates screen says updates run where the code is.
  - `goodfellow content link` and `goodfellow-next content link` link `content/` and `public/media/` to the content repository in `content-repository/`, so `goodfellow dev` and `next dev` read and save its files; `content copy` copies them instead, as builds do. The dev servers and builds say what to run when the content hasn't been put in place.
  - `npm create goodfellow` asks where the content should be kept, or takes `--content your-name/your-site-content` and, on Vercel, `--build content|code`. It makes both repositories, with setup files for each: GitHub Pages and GitLab Pages build the site from the content repository, which checks out the code, while the code's repository runs the nightly update and asks for a rebuild after each change to the code; Vercel builds from either.
  - The Next.js starter's GitHub Pages and GitLab Pages setups now build with `npm run build`, so they run `goodfellow-next finish out` too, which writes the search index, calendar files and redirect pages.

### Patch Changes

- Updated dependencies [6328aff]
- Updated dependencies [72607c8]
- Updated dependencies [4caf245]
- Updated dependencies [e8cd390]
  - @goodfellow-cms/core@0.4.0
  - @goodfellow-cms/admin@0.4.0
  - @goodfellow-cms/react@0.4.0

## 0.3.0

### Minor Changes

- 6532990: Work on your site from Claude. Add Goodfellow's connector to Claude, sign in with GitHub or GitLab and choose your sites; Claude can then read and change pages, items, the header and footer, menus and settings in a draft, show you screenshots of them, and publish the draft or submit it for review, as a pull request or merge request. The new `@goodfellow-cms/mcp` package runs the same tools on your own computer, for Claude Code (`npx @goodfellow-cms/mcp`) and as a Claude Desktop extension, signed in with a token. A site's config can stop Claude publishing with `claude: { publish: false }`, so it only submits its changes for review. Claude sees the media library's sizes and credits, and can look at its images in screenshots. The GitHub and GitLab backends say how large files are without reading them (`fileSizes()`).
  
  For this, every build publishes `goodfellow-site.json`, describing the site's blocks and the content formats it reads, and the admin panel has a preview page (`#/preview`) that shows unpublished content for screenshots. The GitHub and GitLab backends can keep changes in drafts (`drafts`) and read many files at once (`readFiles()`), and the admin panel's change helpers are in `@goodfellow-cms/core`.

### Patch Changes

- Updated dependencies [6532990]
- Updated dependencies [ace4b9c]
- Updated dependencies [7e618c6]
- Updated dependencies [2264969]
- Updated dependencies [4d70cd8]
  - @goodfellow-cms/core@0.3.0
  - @goodfellow-cms/react@0.3.0
  - @goodfellow-cms/admin@0.3.0

## 0.2.0

### Minor Changes

- f776202: Plain-language explanations of failed rebuilds: the top bar's **What went wrong?** says whether the host didn't start the build, packages couldn't be installed, Pages isn't set up, a content file has a problem (linking to its version history), or the site's code couldn't be built, with the host's details behind a toggle. `goodfellow build` prints what went wrong for the admin panel, and an annotation on GitHub Actions. The GitHub backend now reads the deploy workflow's run, so a build that fails before deploying is reported as failed rather than building; the sign-in token link asks for Actions: read. The owner token now lasts a day, the shortest GitHub allows, instead of a week.
- caa6d55: Calendars: collections get a "Date and time, for events" field (`event`), with all-day events, end times and repeats (daily, weekly on chosen days, monthly on a date or a weekday of the month, yearly, every so often, until a date, with dates to skip), in the site's new time zone setting. A collection whose settings name its event field (`calendar`) is a calendar: builds write it as `/calendars/<id>.ics` for visitors to subscribe to, and each event as its own file. The new Calendar block shows events coming up, or a month at a time with a page for each month, from a collection, another calendar's `.ics` address (read when the site is built) or both, with "Add to calendar" and "Subscribe" links; Add to calendar does the same on an event's page. Collection list and Entry field show events' next times. New collections can start as Events. `sitePages()` lists the pages builds write, month pages included, and `goodfellow-next finish` writes calendar files into Next.js exports. Repeats are expanded, and calendar files read and written, with [ical.js](https://github.com/kewisch/ical.js).
- 8ea3680: Redirects: Site Settings has a Redirects tab for sending visitors from old addresses to new ones, and changing a page's address adds a redirect from its old one. Builds write a page at each old address that sends visitors on at once, which works on every host, `goodfellow dev` and `next dev` follow them too, and `goodfellow-next finish` writes them into Next.js exports.
- a210b23: Showing collections. Collection list gets a heading with a link beside it, filters by a choice or tags field, Z to A and any-field ordering, later pages (`/news/page/2`) and a page for each choice of a field (`/news/topics/music`). The new Collection loop block repeats blocks designed in the editor once for each item, with its values in placeholders such as `{title}`. Collections get a Tags field type (`tags`), for any number of a list's choices. Blocks can add pages to the page they're on with `withPages()` from `@goodfellow-cms/core`, which the Calendar block's month pages now use: `sitePages()` takes the site's blocks, and `Page.view` and `useSite().view` replace `Page.month` and `useSite().month`. `repeatsForEntries()` from `@goodfellow-cms/react` makes a block repeat its blocks for each item.
- d09a681: Automatic updates: `goodfellow update` (and `goodfellow-next update`) updates a site to Goodfellow's newest fixes, or a release it's given, with the Puck version that release uses, and updates blocks from Goodfellow's registry, replacing only files nobody changed (`planUpdate()`). It publishes the update only once the site installs and builds with it, and otherwise puts everything back. The starters' GitHub Pages and GitLab Pages setups run it each night. **Site settings → Updates** shows the site's release, fixes and newer releases, and the last update, installs fixes now, lets owners install a newer release, and on GitLab turns on job token pushes and a nightly schedule. Owners can turn automatic fixes off and go back to the previous release, which updates then skip until it's allowed again; these settings live in a new content file, `content/updates.json`. Backends gain an optional `updates` capability; the GitHub owner token can now run workflows.

### Patch Changes

- 84cfc23: The admin panel's tab shows the site's icon, as its pages do, instead of the browser's default: the admin page names it before the admin panel loads, and the admin panel follows a new icon as soon as it's published, even before the live site has been rebuilt with it. Next.js sites show it in the sign-in screen too by using `site.adminMetadata()` in `app/admin/layout.tsx`, as the starter now does.
- 2c07c71: Hardening from code scanning: trimming slashes and other characters no longer uses patterns that slow down on long runs of them (core's new `trimChars()`), and nor do reading SVG sizes, typed domains, link targets and README notes; heading anchors and rich text as plain text take tags out by scanning the text. Search results show any `<` or `>` in an excerpt as text, apart from Pagefind's highlights. Link targets decode an address's entities once, as browsers do. SVG uploads also lose `vbscript:` links and `data:` links other than images. Islands' generated module escapes `<`, `>` and line separators in names and paths.
- 699e0dd: Goodfellow's repository moved to the `goodfellow-cms` organization on GitHub. Package READMEs and repository links, and the admin panel's link to release notes, now point to https://github.com/goodfellow-cms/goodfellow-cms and the documentation at https://goodfellow-cms.github.io/goodfellow-cms/.
  
  The starters' READMEs link to the documentation instead of sections of Goodfellow's README, which is now shorter.
- 63d23b4: On Windows, `goodfellow dev` and `goodfellow build` point the `@/` alias at the site's folder with forward slashes, so blocks from block registries find `@/components/ui/…`.
- Updated dependencies [84cfc23]
- Updated dependencies [f776202]
- Updated dependencies [caa6d55]
- Updated dependencies [2c07c71]
- Updated dependencies [c8a935e]
- Updated dependencies [4000e48]
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
  - @goodfellow-cms/admin@0.2.0
  - @goodfellow-cms/core@0.2.0
  - @goodfellow-cms/react@0.2.0

## 0.1.0

### Minor Changes

- fd6f851: Blocks from block registries. The admin panel has a **Blocks** screen that adds blocks built with shadcn/ui to the editor, and removes them, with no developer: adding one publishes its code into the site's `blocks/installed/` and the shadcn components it uses into `components/ui/`, in one commit, and the editor offers it once the site has been rebuilt. Removing a block is refused while content uses it, and keeps files someone has changed.
  
  `@goodfellow-cms/registry` is Goodfellow's registry, with nine blocks: Hero, Cards, Call to action, Testimonials, Notice, Pricing table, FAQ, Tabs and Image carousel. Its README documents the format for registries of blocks built with other libraries, which a site offers once its config lists them in `registries`.
  
  `create-goodfellow` starts new sites with the recommended blocks, or with `--blocks built-in` the built-in blocks only. `@goodfellow-cms/core` plans installs and removals (`planInstall()`, `planRemove()`), and its stores and the GitLab backend read and write the folders installed blocks use. `goodfellow dev` and `next dev` serve the site's copy of the registry, and `goodfellow` resolves `@/` imports from the site's root, as shadcn code expects. `@goodfellow-cms/react`'s theme adds the colors shadcn components use, such as `card` and `destructive`.
- 5492e22: Collections and templates. A collection, such as videos or events, lives in `content/collections/<name>/`: a `_collection.json` with its fields, an address pattern such as `/videos/{slug}` and a Puck template, plus one file per item. `goodfellow build` and `goodfellow dev` give every item a page from its collection's template, where `{field}` placeholders and the new template-only Entry field block show the item's values. The new Collection list block shows a collection's items on any page, as a list or cards, newest first, upcoming only, and so on. The admin panel has a Collections screen for creating collections, editing their fields and page design, and adding, editing, renaming and deleting items. `@goodfellow-cms/core` adds `allPages()`, `findEntry()` and the collection schemas; `@goodfellow-cms/react` adds a `template` Puck config, `templateOnly()` and `applyEntry()`.
- 88ac239: Demo mode. A site whose config sets `demo: true` opens its admin panel to anyone, with no sign-in and a banner saying it's a demo. Visitors can try everything editors can, but nothing is published: Publish saves their changes, uploads included, in their own browser (IndexedDB), where they stay until the visitor clicks Start over. The Blocks screen lists blocks without adding or removing them.
  
  The demo starts from a copy of the site's content that builds include at `/admin/demo-content.json`, so no git host is called and the repository can stay private. `goodfellow build` writes it, along with the admin panel, for demo sites; Next.js sites serve it with `demoContent` from `goodfellowPages()`, in a new `app/admin/demo-content.json/route.ts`. `@goodfellow-cms/core` adds `demoContent()`, `demoStore()` and the config's `demo` option.
- 652b180: Markdown collections, code highlighting, search and blocks for documentation sites.
  
  - **Markdown collections:** a collection can store its items as Markdown files (`markdown: { body }` in its settings), with the other fields as YAML front matter. The admin panel's collection settings turn it on and convert every item; the body is edited in the formatted editor or a Markdown tab, and Markdown the formatted editor can't show, such as a table, is edited as Markdown only. `@goodfellow-cms/core` adds `parseMarkdownEntry()`, `serializeMarkdownEntry()`, `markdownToHtml()`, `markdownParts()`, `markdownHeadings()` and `canFormatMarkdown()`; HTML in Markdown is shown as text, and only safe addresses are kept.
  - **Code block:** code highlighted with Shiki when the site is built, with a title and a copy button. Code in Markdown text is highlighted too.
  - **Search block:** searches the site in the visitor's browser with Pagefind. Builds index a site only when a page has a search block (`data-goodfellow-search`); `goodfellow build` does it, `goodfellow index` indexes any built site, and Next.js sites run `goodfellow-next index out` after `next build`. Pages mark their main content for indexing.
  - **Collection navigation**, **Previous and next** and **On this page** blocks, for documentation and other sites with ordered collections.
  - Formatted text styles tables, images and code.
- 1bfecf7: Publishing to GitHub and GitLab. New `@goodfellow-cms/github` and `@goodfellow-cms/gitlab` backends edit a site's repository straight from the browser: GitHub with an access token from a prefilled link, GitLab with one-click OAuth (PKCE) or a token. Set `backend` in `goodfellow.config.tsx` and `goodfellow build` includes the admin panel at `/admin/`, with a sign-in screen, an account menu and a live-site status that follows the deploy after each publish. `@goodfellow-cms/core` adds the `GitHost` and `GitBackend` interfaces, `writeChanges()` (which saves over other people's changes to other files but never the same ones), and `@goodfellow-cms/core/testing` with an in-memory repository for fakes. `goodfellow dev` gives each site its own Vite cache and keeps watching content when folders are replaced.
- 405de70: Client Components in blocks (`"use client"`) now run in the browser on sites built with `goodfellow build` and served by `goodfellow dev`, not only with Next.js. Each one a block uses becomes an island: its HTML is in the page as before, and the page loads React and that component's code to bring it to life, with `useSite()`, `useId()` and content passed as `children` working as they do in Next.js. Pages without Client Components still load no JavaScript. Client Components in packages of blocks are found too.
  
  `goodfellow build` now always bundles for production, so the admin panel no longer ships React's development build. `@goodfellow-cms/core` is published one file per module, so browser bundles that only need a helper such as `withBase()` leave out the content schemas.
- 809001e: The admin panel, running against local files. `goodfellow dev` now serves it at `/admin`: edit pages, the header and footer in Puck, and site settings (general, colors and fonts, menus and custom CSS) with a live preview. Classes typed in the editor are styled immediately by Tailwind running in the browser. Saves are single writes that refuse to overwrite changes made since the editor loaded. `@goodfellow-cms/core` adds the `ContentStore` interface, `ConflictError`, `isEditablePath` and reserved page addresses (`/admin`).
- ece9ba5: The media library. A new **Media** screen uploads, replaces and deletes images and files in `public/media/`, saying where a file is used before deleting it. Image fields in blocks, page settings, collection items and site settings get a **Choose image** button that picks from the library or uploads a new file. Large photos are shrunk, JPEGs lose hidden details such as location, SVGs lose scripts, and only file types that can't run code are accepted. Previews show new uploads straight away, and add the site's base path to media addresses. `FileChange` can now carry `bytes`, and every store implements `readBytes()`, with both backends, their fakes and the development server supporting uploads. `@goodfellow-cms/react` adds `mediaField()`, used by the Image and Section blocks, and the AI assistant is told which images the site has.
- de03c18: Add `@goodfellow-cms/next`, which puts a Goodfellow site in a Next.js app, exported as static files. Pages render as Server Components; blocks' links to the site's pages use `next/link` and images `next/image`, sites can be served from a subfolder (`basePath` or `GOODFELLOW_BASE`), and blocks can render Client Components with any hooks. In `next dev` the admin panel saves to the files on disk. `create-goodfellow` can start from a Next.js version of the starter (`--template next`).
  
  `@goodfellow-cms/react` gains a Server Components version (picked through the `react-server` condition), `preparePage()`, and `SiteLink` and `SiteImage`, which blocks use for links and images so they follow the site's base path and the renderer's components. The built-in blocks use them. `@goodfellow-cms/core` gains `withBase()`, `applyBasePath()` and `imageSize()`, and `@goodfellow-cms/core/node` reading sites from disk, image sizes, the local file store and the development API.
- cff2c58: Static rendering. `goodfellow build` turns a site's `content/` folder into static HTML, with Tailwind CSS built from the class names used in content, a sitemap, and support for serving from a subfolder. `goodfellow dev` re-renders pages as content changes, and `goodfellow preview` serves the built site. Includes the content file format (with versioning and migrations), the page renderer, and ten built-in blocks.

### Patch Changes

- 7d1f8e9: `goodfellow dev` prints the address of any page it can't find, since the site's own "not found" page doesn't say.
- fe36989: `goodfellow dev` keeps running Client Components after a block with one is removed, instead of failing to load the browser's islands script until the dev server restarts.
- 536f2a8: License under MIT.
- 4ca2dc1: Every package has a README, keywords and links to its documentation, repository and issues, for its page on npm. All the packages are released together with the same version.
- d91eea1: The packages are published under the `@goodfellow-cms` scope on npm, such as `@goodfellow-cms/core` and `@goodfellow-cms/react`, since `@goodfellow` was taken. `goodfellow` and `create-goodfellow` keep their names, and the block registry's name in `components.json` and refs such as `@goodfellow/shadcn-faq` stays `@goodfellow`.
- ff76bee: Fix `goodfellow build` and `goodfellow dev` on Windows, where pages with Client Components failed with "Invalid array length". The islands plugin compared Vite's module ids, which use forward slashes, with folders written with backslashes, so it turned `@goodfellow-cms/react`'s own Client Components and installed packages' into islands.
- Updated dependencies [1d4191f]
- Updated dependencies [1414af7]
- Updated dependencies [fd6f851]
- Updated dependencies [b4b80a6]
- Updated dependencies [2e85621]
- Updated dependencies [5492e22]
- Updated dependencies [2af75b7]
- Updated dependencies [ce5faee]
- Updated dependencies [88ac239]
- Updated dependencies [652b180]
- Updated dependencies [1bfecf7]
- Updated dependencies [405de70]
- Updated dependencies [c7ab18e]
- Updated dependencies [809001e]
- Updated dependencies [ece9ba5]
- Updated dependencies [536f2a8]
- Updated dependencies [04fc203]
- Updated dependencies [de03c18]
- Updated dependencies [4ca2dc1]
- Updated dependencies [d91eea1]
- Updated dependencies [56dbc36]
- Updated dependencies [8c69eb5]
- Updated dependencies [cff2c58]
- Updated dependencies [3a4c60d]
  - @goodfellow-cms/admin@0.1.0
  - @goodfellow-cms/core@0.1.0
  - @goodfellow-cms/react@0.1.0
