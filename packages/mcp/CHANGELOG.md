# @goodfellow-cms/mcp

## 0.11.0

### Minor Changes

- 417b6eb: The Claude connector can list drafts (`list_drafts`), move a page to a new address with its links and a redirect (`move_page`), and schedule pages and items with `showFrom` and `hideAfter` on `save_page` and `save_item`. Its message for a collection the site doesn't have now points to `get_site`, not a tool that doesn't exist.

### Patch Changes

- f6fcc1a: Goodfellow's documentation is now at https://goodfellowcms.com, and the links the packages give, in their READMEs, the admin panel's help links, and the Claude Desktop extension, go there. The old address, https://goodfellow-cms.github.io/goodfellow-cms/, sends people to the same page at the new one.
- d813bd5: The backends', the command line's, the Claude connector's, create-goodfellow's, and the token broker's English use the Oxford comma in lists ("GitHub, GitLab, or Bitbucket").
- 0255dbc: More fixes from November's security review:
  
  - The local backend in `goodfellow dev` and `next dev`, and the Claude connector's folders, never follow a link inside an editable folder to files outside it; the folders themselves may still be links, as a content repository's are.
  - The Claude connector's screenshots run the browser in Chrome's sandbox, without the connector's tokens in its environment.
  - A plugin can't ask to read `*`, `.git`, or files of secrets such as `.env.local`, or for Goodfellow's own `GOODFELLOW_` variables.
  - Bitbucket sites' lockfile step publishes `package-lock.json` only once every new package comes from npm's registry, as GitHub's and GitLab's do. Sites made by an earlier release keep their `bitbucket-pipelines.yml` until it's copied from a new site's.
  - WordPress imports take only web addresses for attachments, and importing on a computer downloads them only from public `https://` addresses or the site it was read from, no larger than the upload limit.
  - Expo apps open redirects to other sites only over the web, and take the site's base path only where it's a path.
  - Cleaning an SVG's CSS goes on until taking out an `@import` or `url()` can't join what's around it into another, and leaves the CSS out whole where something would still load from elsewhere, as an unfinished `url(` would.
  - Rich text can't take an id Goodfellow's own scripts look up by spelling it with character references, such as `&#103;f-consent`.
  - A full-stack site's AI proxy (`aiServer()`) sends on only the fields the AI assistant sends: Claude's own models, answers no longer than the assistant asks for, text messages and structured answers, and only its beta, so an editor can't spend the site's key on tools, files, or other models. `models` on a service's key limits the models editors may ask for.
  - GitLab and Bitbucket sites list and close only their own repository's merge and pull requests as drafts' reviews, never one from a fork that uses a draft's branch name.
  - The sign-in worker that `create-goodfellow` carries, which owners deploy, takes its setup page's forms only from that page, and always writes a new session key while it's being set up.
  - The token broker publishes a draft with exactly the changes it checked, so nothing added to the draft in between goes live unchecked, and frames the admin panel at the screen an address names without what a sign-in brought back, such as the sign-in worker's grant or Bitbucket's token.
  - The Claude connector reads a site's description as builds read other sites' files: from public `https://` addresses only (or a folder's development server), no larger than 5 MB, and within 15 seconds.
  - A plugin installed from the admin panel runs its tasks only from its own package, so a task's description can't send its secrets to a file of the site's.
  - The nightly update no longer changes blocks from Goodfellow's registry, and its publishing job on GitHub refuses `blocks/installed/`, `components/`, `lib/`, and `hooks/`, since the job that made the update ran the site's packages, which could have written code there. The Blocks screen offers **Update** where a newer version of an added block is ready, and `goodfellow update --blocks` (or `goodfellow-next update --blocks`) updates them all. GitHub sites made by an earlier release keep their workflow's older check until it's copied from a new site's, since updates can't change workflows.
- 749d66b: Security fixes from the second November review:
  
  - Markdown items show text after an inline `<kbd>`, `<code>`, `<pre>`, or `<script>` tag as text, where it could carry live HTML onto the site's pages.
  - A full-stack site's server publishes only on top of the live site as it is now, whatever revision the browser names, so a change waiting for review can't come along with an editor's own; the GitHub backend checks the same before every commit, moves the branch only from that commit in the same request, and takes only commits' ids as revisions.
  - The sign-in service finishes a sign-in only in the browser that started it, so a link to GitHub that someone else started can't send an owner's sign-in to them. New sign-in services get it; an existing one gets it with its next weekly update, or by copying create-goodfellow's `templates/sign-in/` over it.
  - `next dev`'s local backend answers nothing while other computers can reach the development server, and the Next.js starter starts it with `next dev --port 4321 -H 127.0.0.1`. On a site made by an earlier release, change the `dev` script in `package.json` to that.
  - Publishing a draft refuses one that changes files the admin panel never edits, such as the site's configuration, packages, or workflows (anything outside its content, its media, and the folders the admin panel installs blocks and plugins into), which only reach a draft when someone saves them there on the site's host, and publishes exactly the changes the admin panel's **Publish all** and Claude's `publish` checked, media included.
  - A token broker makes each change again before checking it, so the change it checks is the one it publishes, and checks the changes a draft is asked to publish, and theme and plugin records written as bytes.
- Updated dependencies [639a7af]
- Updated dependencies [b26b5ae]
- Updated dependencies [f4a0a43]
- Updated dependencies [44a825d]
- Updated dependencies [810503b]
- Updated dependencies [c4ecba5]
- Updated dependencies [f6fcc1a]
- Updated dependencies [ec40324]
- Updated dependencies [b683b3e]
- Updated dependencies [c39766d]
- Updated dependencies [1008a42]
- Updated dependencies [5f09d89]
- Updated dependencies [f287d1c]
- Updated dependencies [d813bd5]
- Updated dependencies [3184524]
- Updated dependencies [d7098cb]
- Updated dependencies [bc2f3bd]
- Updated dependencies [7698210]
- Updated dependencies [6210740]
- Updated dependencies [e3678d8]
- Updated dependencies [c7c70ef]
- Updated dependencies [0255dbc]
- Updated dependencies [749d66b]
- Updated dependencies [3bcdfa1]
- Updated dependencies [2627f6d]
- Updated dependencies [db80e2f]
  - @goodfellow-cms/ai@0.11.0
  - @goodfellow-cms/core@0.11.0
  - @goodfellow-cms/gitlab@0.11.0
  - @goodfellow-cms/github@0.11.0
  - @goodfellow-cms/bitbucket@0.11.0

## 0.10.1

### Patch Changes

- Updated dependencies [5c28336]
- Updated dependencies [6fbc951]
  - @goodfellow-cms/core@0.10.1
  - @goodfellow-cms/gitlab@0.10.1
  - @goodfellow-cms/ai@0.10.1
  - @goodfellow-cms/bitbucket@0.10.1
  - @goodfellow-cms/github@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [cfa0a83]
- Updated dependencies [93fdd74]
- Updated dependencies [cdc5103]
- Updated dependencies [86b7c5d]
- Updated dependencies [378dd68]
  - @goodfellow-cms/core@0.10.0
  - @goodfellow-cms/gitlab@0.10.0
  - @goodfellow-cms/ai@0.10.0
  - @goodfellow-cms/bitbucket@0.10.0
  - @goodfellow-cms/github@0.10.0

## 0.9.0

### Minor Changes

- 58556ef: Collections have five more kinds of field: yes or no, links to items in a collection (one or several, renamed with the items they link to, taken out when one is deleted, and checked before publishing), several images, a file, and repeating groups of a few fields. Entry field shows each, Collection list and loop can show only items where a yes or no field is on, and, in a page design, only the items the page's item links to. The AI assistant fills in yes or no fields and links to items.
- 8dcf967: Use fonts of your own: Colors & fonts' new Add a font uploads a font's WOFF2 files, checked in the browser, once the owner confirms its license allows websites, and the font menus offer it first. Pages load it from the site with `@font-face`, preloading the text's and headings' files, with size-matched stand-ins measured from the files, and the admin panel's editor and previews show it from its bytes.
- dfd7ea3: Synced blocks: blocks kept once in `content/synced-blocks/` and shown wherever the new Synced block block places them, on pages, collections' designs and the header and footer, so changing one changes every page. The admin panel lists, makes, renames and deletes them, edits each in an editor of its own (with a version for each language), saves a block on a page as one and detaches one into a page's own blocks. The site checks catch synced blocks that aren't there, links inside them are checked and moved with pages, the Claude connector reads and writes them, and WordPress's synced patterns import and export as synced blocks.

### Patch Changes

- d0a47cb: Packages' npm descriptions, and the Claude Desktop extension's name, say Goodfellow CMS, the official name, so they're easier to find.
- 9c6cb6f: Harden more of what the code review found:
  
  - Builds read other calendars and News feed blocks' feeds only from `https://` addresses that aren't on the building computer or a private network, checking each redirect, and stop reading past their size limit as they read (`readRemoteText()`, `isPrivateHost()`).
  - Markdown headings never get an id starting `gf-`, which Goodfellow's own scripts look up, so a heading can't stop a page's interactive blocks from starting.
  - Calendar files never let a carriage return in a name or event start a line of its own; sitemaps escape `"` in addresses.
  - Players and social posts refuse every spelling of this computer's address (`localhost.`, `*.localhost`, `[::ffff:127.0.0.1]`).
  - Registry items' files go only into their own block's folder or the shared components, whatever their `target` says.
  - Next.js sites' redirects to addresses with `:`, `*`, `(` and the like no longer fail `next build`.
  - `next dev`'s local server refuses requests for any name but this computer's before serving the editor's frames, reading the name Next.js passes on as `x-forwarded-host`.
  - Sites that ask visitors first also hold back head styles that load from other sites, a `base` and a `meta` refresh.
  - Apps download a kept file again where it's corrupt, keep the classes they can read where twrnc can't read one, and keep other sites' frames from opening other apps; on Android, links from them now open in the browser.
  - GitLab's "let editors publish" changes the branch's protection in one step where GitLab can, and checks it after where it can't.
  - Local screenshots never let a site's scripts write through the development server's API.
- 19d7812: The AI assistant and Claude never choose settings only owners may, such as using Custom HTML exactly as written, and the assistant's requests mark the site's own text as content between markers it can't close. Claude's tools ask before deleting, publishing or throwing a draft away, change only the site's presentational settings (never forms, consent, comments, languages or search engines), unlink a deleted page's or item's translations, name the menus still linking to a deleted page, and, on an editor's computer, run the admin panel's checks before publishing. The Document viewer shows only the media library's PDFs, including a storage plugin's, and links to other sites'. An item's values filled into Custom HTML in a collection's page design are escaped, as in rich text.
- Updated dependencies [0177574]
- Updated dependencies [0177574]
- Updated dependencies [d345032]
- Updated dependencies [e7dd766]
- Updated dependencies [19d7812]
- Updated dependencies [58556ef]
- Updated dependencies [b4f074a]
- Updated dependencies [19d7812]
- Updated dependencies [19d7812]
- Updated dependencies [bff0a8a]
- Updated dependencies [d0a47cb]
- Updated dependencies [1004f6f]
- Updated dependencies [bd82b21]
- Updated dependencies [78f1f14]
- Updated dependencies [d345032]
- Updated dependencies [181d734]
- Updated dependencies [8dcf967]
- Updated dependencies [cf403e0]
- Updated dependencies [9c6cb6f]
- Updated dependencies [19d7812]
- Updated dependencies [19d7812]
- Updated dependencies [0b22859]
- Updated dependencies [19d7812]
- Updated dependencies [19d7812]
- Updated dependencies [cb72911]
- Updated dependencies [dfd7ea3]
- Updated dependencies [01b7691]
- Updated dependencies [1023c64]
- Updated dependencies [78f1f14]
  - @goodfellow-cms/ai@0.9.0
  - @goodfellow-cms/core@0.9.0
  - @goodfellow-cms/bitbucket@0.9.0
  - @goodfellow-cms/github@0.9.0
  - @goodfellow-cms/gitlab@0.9.0

## 0.8.0

### Patch Changes

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
- Updated dependencies [27cf03a]
- Updated dependencies [141a23d]
- Updated dependencies [ecfbab6]
- Updated dependencies [8622adc]
- Updated dependencies [90e3369]
- Updated dependencies [7a9a116]
- Updated dependencies [5869562]
- Updated dependencies [5113b06]
- Updated dependencies [4010248]
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
  - @goodfellow-cms/github@0.8.0
  - @goodfellow-cms/gitlab@0.8.0
  - @goodfellow-cms/bitbucket@0.8.0
  - @goodfellow-cms/ai@0.8.0

## 0.7.0

### Minor Changes

- 4f79454: The Claude connector on your computer works on several sites at once, with a token for each host, and on sites in folders on your computer through their development server. It finds a site's address on GitHub Pages or GitLab Pages when Site settings has none, and its screenshots no longer wait for pages to go quiet for good, run without the GPU, are tried again when the browser closes, and say what the browser said. Backends wait and try again when a host limits requests (`withRateLimits()`, `RateLimitError`), and the GitLab backend no longer lists the whole site again after each of its own saves.
- 42cf54b: Owners can limit what each editor changes, on the Editors screen's Limits section: page sections with their translations, collections' items, the media library, the header and footer, the menus, and languages, kept in `content/permissions.json`. Everything else is read-only to them, and publishing changes outside their limits offers Submit for review, which asks the site's reviewers (every owner, unless the file names some) on GitHub, GitLab and Bitbucket. Owners see drafts waiting for their review in the draft bar, and publishing or throwing away a draft closes its review. The token broker and the Claude connector keep to the same limits, and full-stack sites' servers refuse writes outside them. The sign-in service's everyday app now asks for Pull requests, which submitting for review needs.

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
  - @goodfellow-cms/ai@0.7.0
  - @goodfellow-cms/github@0.7.0
  - @goodfellow-cms/gitlab@0.7.0
  - @goodfellow-cms/bitbucket@0.7.0

## 0.6.0

### Minor Changes

- 1b9781e: Sites stored on Bitbucket Cloud, with `@goodfellow-cms/bitbucket`: sign-in with a repository access token, an Atlassian API token or Bitbucket's own sign-in, publishing as one commit that fails when someone else has published since, version history, drafts and pull requests, editors from the workspace, failed rebuilds explained, the nightly update, scheduled changes that go live at their time (each with a one-off Pipelines schedule) and plugins' tasks through Bitbucket Pipelines, and content in a repository of its own, with Vercel putting the site online. `create-goodfellow --bitbucket` creates such sites, with `--content` too, `goodfellow due` and `goodfellow-next due` take `--output`, and the token broker, the Claude extension, the Claude connector service and the admin panel know Bitbucket too.

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
  - @goodfellow-cms/bitbucket@0.6.0
  - @goodfellow-cms/core@0.6.0
  - @goodfellow-cms/github@0.6.0
  - @goodfellow-cms/gitlab@0.6.0
  - @goodfellow-cms/ai@0.6.0

## 0.5.0

### Minor Changes

- 9b96dd3: The editor's sandbox. The admin panel's page, which signs in and publishes, no longer loads the site's config or any block's code: Puck, the config and every block run in frames sandboxed without `allow-same-origin`, which talk to the page through one message port, so blocks can't reach editors' tokens or AI keys. The page draws the editor's header, Undo and Redo, preview widths, Publish and the AI panel outside the frame; the Settings, Version history and Site history previews, the pages rendered to check a publish and the preview page for screenshots are frames too. The site's CSS is kept to the editor's canvas, with its width media queries as container queries, so the phone and tablet buttons show the site at those widths. The frames' Content Security Policy lets them fetch nothing and run only the site's own scripts, which first remove WebRTC.
  
  `Admin` takes `site` (`adminSite()` from `@goodfellow-cms/react`) and `frames` in place of `config`; `GitHost.source` lets the admin panel make the site's git host again. `goodfellow build` writes the frames' page at `admin/editor/`. Next.js sites get `app/admin/editor/page.tsx` (`GoodfellowEditor` from `@goodfellow-cms/next/editor`), their `app/admin/page.tsx` becomes a server component passing `site.admin()` to `GoodfellowAdmin`, and `goodfellow-next finish` writes the editor page's policy. An `app/admin/page.tsx` that still passes `config` loads every block's code itself, so the admin panel only says how to update it there and never signs in; `goodfellow-next update` replaces it with the starter's, and adds the editor page, wherever nobody has changed it, on its first run after this release. Every frame is sandboxed with `allow-scripts` alone, in `goodfellow dev` and `next dev` too: they bundle the frames as builds do, rebuild them as the site's code changes and reload the frames, leaving the admin panel's page as it is. `@goodfellow-cms/next` depends on Rolldown for that, loaded only in `next dev`.
- 74bb2ad: Scheduled publishing: pages and collection items can be shown from a time and hidden after one (`showFrom` and `hideAfter` in their files, in the site's time zone), which builds, `goodfellow dev` and Next.js apply, leaving menus' links to them out until they're shown. The admin panel schedules pages from the Pages screen and items in their editor, lists what's coming up, and warns that scheduled content can be read early on a public repository. On GitLab it adds a pipeline schedule at each time, so changes go live then; the starters' new `.github/workflows/scheduled.yml` checks each hour with the new `goodfellow due` command and builds the site only when something has come due. Letting editors publish on GitLab now lets Developers merge too, which adding those schedules needs.
- 884a0be: Sites in several languages. Add languages in Site Settings → Languages, each with the site's name and description in it; its pages go under its code, such as `/es/about`. The Pages screen and collections' lists translate pages and items into each language, say when a translation is out of date, and the AI assistant can translate a page or item. Each language can have menus of its own, the new Language switch block links to the page in each language, and pages say their language, link to their translations with `hreflang`, and are listed with them in the sitemap. Search finds only pages in the page's own language, and lists, feeds and calendars show only that language's items.

### Patch Changes

- 93c5b2c: Goodfellow needs Node.js 22.23.4, 24.22.1 or 26.12.1 or later. Earlier versions decompress Brotli unsafely (CVE-2026-111497, "Node2Shell"). Builds read other sites, such as Calendar blocks' feeds, so a feed's server could run code on the computer building the site. New sites' GitHub workflows (`deploy.yml`, `scheduled.yml`) set up Node with `check-latest: true`, so they always get the newest Node 22 instead of an older copy on GitHub's runner. To do the same on an existing site, add `check-latest: true` under `node-version: 22` in each `actions/setup-node` step of its `.github/workflows/` files. GitLab's `node:22` image already has the fix. On Cloudflare Pages and Vercel, check the Node.js version in the project's build settings.
- eb68b5d: Security updates: Vite 8.3.4 for `goodfellow dev` and `goodfellow build`, and the MCP TypeScript SDK 1.32.1 for the Claude connector's tools, both fixing published advisories.
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
  - @goodfellow-cms/github@0.5.0
  - @goodfellow-cms/gitlab@0.5.0
  - @goodfellow-cms/ai@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [6328aff]
- Updated dependencies [72607c8]
- Updated dependencies [4caf245]
- Updated dependencies [e8cd390]
  - @goodfellow-cms/core@0.4.0
  - @goodfellow-cms/github@0.4.0
  - @goodfellow-cms/gitlab@0.4.0
  - @goodfellow-cms/ai@0.4.0

## 0.3.0

### Minor Changes

- 6532990: Work on your site from Claude. Add Goodfellow's connector to Claude, sign in with GitHub or GitLab and choose your sites; Claude can then read and change pages, items, the header and footer, menus and settings in a draft, show you screenshots of them, and publish the draft or submit it for review, as a pull request or merge request. The new `@goodfellow-cms/mcp` package runs the same tools on your own computer, for Claude Code (`npx @goodfellow-cms/mcp`) and as a Claude Desktop extension, signed in with a token. A site's config can stop Claude publishing with `claude: { publish: false }`, so it only submits its changes for review. Claude sees the media library's sizes and credits, and can look at its images in screenshots. The GitHub and GitLab backends say how large files are without reading them (`fileSizes()`).
  
  For this, every build publishes `goodfellow-site.json`, describing the site's blocks and the content formats it reads, and the admin panel has a preview page (`#/preview`) that shows unpublished content for screenshots. The GitHub and GitLab backends can keep changes in drafts (`drafts`) and read many files at once (`readFiles()`), and the admin panel's change helpers are in `@goodfellow-cms/core`.
- 7e618c6: Dark mode for sites, which their owners turn on in Site Settings → Colors & fonts: sites stay light only until then. Every theme color has a dark one, pages follow each visitor's light or dark setting, and a site can have a second logo for dark backgrounds. The admin panel's previews show the site light or dark, like the admin panel or as chosen on the Theme tab, and Claude's screenshots can show it dark. Code blocks can be colored like the page, which new ones are, and code in Markdown is too. Blocks' `dark:` classes now apply only on sites with dark mode, so a light-only site never turns partly dark on a computer set to dark.
  
  The Claude Desktop extension is now packed without Anthropic's `mcpb` tool, and the connector no longer installs Puppeteer's browser downloader, leaving out packages with security advisories.

### Patch Changes

- Updated dependencies [6532990]
- Updated dependencies [ace4b9c]
- Updated dependencies [7e618c6]
- Updated dependencies [2264969]
- Updated dependencies [4d70cd8]
  - @goodfellow-cms/core@0.3.0
  - @goodfellow-cms/github@0.3.0
  - @goodfellow-cms/gitlab@0.3.0
  - @goodfellow-cms/ai@0.3.0
