# @goodfellow-cms/ai

## 0.8.0

### Patch Changes

- 4e12d00: Publishing refuses, rather than retries on top, when GitHub or GitLab can't list every file someone else changed meanwhile, so a large change such as a WordPress import is never written over. `goodfellow preview` answers only this computer unless given `--network`. AI services' addresses must be `https://`, unless the service runs on this computer, and the assistant is told the site's own text is content, not instructions. Registry addresses are compared as they'd be fetched, so `..` can't leave a trusted registry. New sites ignore every `.env` file but `.env.example`.
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

- 48366cf: Every block's look can be set without code: its CSS classes setting is now **Style**, which the editor shows as controls for text alignment, text size, text and background colors (the theme's, or your own), space inside and around it, each side or all at once, and rounded corners, with a note when text may be hard to read on its background. They're kept as Tailwind classes in the block's `className` (`readBlockStyle()` and `withBlockStyle()` in `@goodfellow-cms/core`), beside any other classes, which **Other CSS classes** keeps, so content files, themes' parts, the Gutenberg plugin and the AI assistant work with them as before. Blocks with an alignment setting of their own keep it.

### Patch Changes

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

## 0.4.0

### Minor Changes

- 4caf245: Full-stack Next.js sites (roadmap step 24): a Next.js app with a server of its own can be a Goodfellow site whose editors sign in with the app's own sign-in, while its server reads and publishes through GitHub or GitLab with one token that never reaches a browser.
  
  - `goodfellowApi()` from `@goodfellow-cms/next/server` is the admin panel's API, as a catch-all route. The app's `authorize(request)` says who's signed in and whether they're an `editor` or an `owner`; only owners change Site Settings, blocks, and collections' settings and templates, which the server checks on every write. Commits name the editor as their author.
  - `<GoodfellowAdmin server="/api/goodfellow" />` signs in through the app, and `withGoodfellow(config, { server: true })` builds for a server instead of static files.
  - `ai: { anthropic: process.env.ANTHROPIC_API_KEY }` sends the AI assistant's requests through the server with the site's key (`aiServer()` in `@goodfellow-cms/ai`), so editors don't need keys of their own.
  - `github()` and `gitlab()` have `server({ token })`, and core's `appApi()` (in `@goodfellow-cms/core/node`) is the API for other frameworks.
  - Calendar files and search are static on full-stack sites too: `goodfellow-next finish --server`, after `next build`, writes the calendar files into `public/calendars/` and indexes the pages Next.js rendered into `public/pagefind/`.

### Patch Changes

- Updated dependencies [6328aff]
- Updated dependencies [72607c8]
- Updated dependencies [4caf245]
  - @goodfellow-cms/core@0.4.0

## 0.3.0

### Minor Changes

- 6532990: Work on your site from Claude. Add Goodfellow's connector to Claude, sign in with GitHub or GitLab and choose your sites; Claude can then read and change pages, items, the header and footer, menus and settings in a draft, show you screenshots of them, and publish the draft or submit it for review, as a pull request or merge request. The new `@goodfellow-cms/mcp` package runs the same tools on your own computer, for Claude Code (`npx @goodfellow-cms/mcp`) and as a Claude Desktop extension, signed in with a token. A site's config can stop Claude publishing with `claude: { publish: false }`, so it only submits its changes for review. Claude sees the media library's sizes and credits, and can look at its images in screenshots. The GitHub and GitLab backends say how large files are without reading them (`fileSizes()`).
  
  For this, every build publishes `goodfellow-site.json`, describing the site's blocks and the content formats it reads, and the admin panel has a preview page (`#/preview`) that shows unpublished content for screenshots. The GitHub and GitLab backends can keep changes in drafts (`drafts`) and read many files at once (`readFiles()`), and the admin panel's change helpers are in `@goodfellow-cms/core`.
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

- a210b23: Showing collections. Collection list gets a heading with a link beside it, filters by a choice or tags field, Z to A and any-field ordering, later pages (`/news/page/2`) and a page for each choice of a field (`/news/topics/music`). The new Collection loop block repeats blocks designed in the editor once for each item, with its values in placeholders such as `{title}`. Collections get a Tags field type (`tags`), for any number of a list's choices. Blocks can add pages to the page they're on with `withPages()` from `@goodfellow-cms/core`, which the Calendar block's month pages now use: `sitePages()` takes the site's blocks, and `Page.view` and `useSite().view` replace `Page.month` and `useSite().month`. `repeatsForEntries()` from `@goodfellow-cms/react` makes a block repeat its blocks for each item.
- 8f9eff2: A Video block: a video from the media library (MP4 or WebM, with a picture before it plays and WebVTT captions), YouTube (from its ID or any of its addresses, in the privacy-enhanced player), Vimeo (with do not track), or another site's player (from its embed address or code, sandboxed, and only from another secure site). It needs no JavaScript on the page. `youtubeVideo()`, `vimeoVideo()`, `embedPlayerUrl()` and the player addresses' helpers are in `@goodfellow-cms/core`. Media fields can hold videos (`mediaField(label, "video")`), whose chooser offers only videos, and WebVTT files can be uploaded.

### Patch Changes

- 2c07c71: Hardening from code scanning: trimming slashes and other characters no longer uses patterns that slow down on long runs of them (core's new `trimChars()`), and nor do reading SVG sizes, typed domains, link targets and README notes; heading anchors and rich text as plain text take tags out by scanning the text. Search results show any `<` or `>` in an excerpt as text, apart from Pagefind's highlights. Link targets decode an address's entities once, as browsers do. SVG uploads also lose `vbscript:` links and `data:` links other than images. Islands' generated module escapes `<`, `>` and line separators in names and paths.
- 699e0dd: Goodfellow's repository moved to the `goodfellow-cms` organization on GitHub. Package READMEs and repository links, and the admin panel's link to release notes, now point to https://github.com/goodfellow-cms/goodfellow-cms and the documentation at https://goodfellow-cms.github.io/goodfellow-cms/.
  
  The starters' READMEs link to the documentation instead of sections of Goodfellow's README, which is now shorter.
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

- 1414af7: The AI assistant. A new **AI** tab in every editor writes with AI: it adds blocks to a page, changes the selected block, or fills in a collection item's fields, and its answer goes straight into the editor to check, change or undo. Editors choose the service and use their own key, kept only in their browser: Claude through the official SDK with structured outputs, OpenAI, Gemini, Groq, Mistral, OpenRouter, the keyless OVHcloud AI Endpoints, any OpenAI-compatible service, or any chat app by copy and paste. The new `@goodfellow-cms/ai` package builds the requests, checks answers against the site's blocks and fields, and talks to the services; `@goodfellow-cms/ai/testing` fakes them. Sites can limit the services with `ai: { providers }` or remove the assistant with `ai: false`.
- ece9ba5: The media library. A new **Media** screen uploads, replaces and deletes images and files in `public/media/`, saying where a file is used before deleting it. Image fields in blocks, page settings, collection items and site settings get a **Choose image** button that picks from the library or uploads a new file. Large photos are shrunk, JPEGs lose hidden details such as location, SVGs lose scripts, and only file types that can't run code are accepted. Previews show new uploads straight away, and add the site's base path to media addresses. `FileChange` can now carry `bytes`, and every store implements `readBytes()`, with both backends, their fakes and the development server supporting uploads. `@goodfellow-cms/react` adds `mediaField()`, used by the Image and Section blocks, and the AI assistant is told which images the site has.
- 8c69eb5: Add `create-goodfellow`, which creates a new site from the starter or the parish example (`npm create goodfellow@latest my-site`), and can set up where the site is stored and hosted. Sites can now keep their contact details (address, phone and email) in Site settings, shown wherever the new Contact details block is placed. A collection's link fields can choose an uploaded file, such as a PDF.

### Patch Changes

- 4ca2dc1: Every package has a README, keywords and links to its documentation, repository and issues, for its page on npm. All the packages are released together with the same version.
- d91eea1: The packages are published under the `@goodfellow-cms` scope on npm, such as `@goodfellow-cms/core` and `@goodfellow-cms/react`, since `@goodfellow` was taken. `goodfellow` and `create-goodfellow` keep their names, and the block registry's name in `components.json` and refs such as `@goodfellow/shadcn-faq` stays `@goodfellow`.
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
