# @goodfellow-cms/registry

## 0.10.0

No changes in this release.

## 0.9.0

### Minor Changes

- e7dd766: New blocks and more from the ones there are. Questions and answers shows questions that open to their answers, and tells search engines about them. The Announcement bar carries news across the top of every page between a first and last day, and visitors can close it until its message changes. Galleries open their pictures larger when clicked, with the arrow keys, buttons and swiping moving between them (new galleries start with it on). Heading blocks carry link names, which On this page now lists on any page, and it can stay in view as the page scrolls. Table cells can be bold, italic or links, which WordPress imports and exports keep. The registry's Map block also shows OpenStreetMap's maps.
- b4f074a: Comments can be kept by Disqus, or by Garrul in the owner's own Cloudflare account, as well as by Giscus, so visitors without a GitHub account can comment: Site Settings' Comments takes a Disqus site's shortname or Garrul's address on any site, and the Comments block shows their comments, waiting for visitors' consent where the site asks.
  
  The Comments block offers Giscus's settings, reactions and where the box for writing goes, only for comments Giscus keeps, and editor plugins' sessions have `fields(block)`, which gives a block's settings as the site's code chooses them for its props, for blocks whose description says `resolvesFields`.

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

## 0.8.0

### Minor Changes

- d21884a: On sites kept on GitHub, Site Settings has a Comments screen that sets up comments: it makes a public repository of their own beside the site's, with Discussions turned on, or connects one you already have, and publishes where they're kept as `content/site.json`'s `comments`, which the Comments block now shows without Giscus's code. The same screen lists visitors' comments page by page, and hides, shows and deletes them and closes pages to new ones. Where the sign-in can't reach that repository, as with the sign-in service, it asks for a GitHub token of the owner's own, kept only in the tab. GitHub backends offer this as `comments` (`SiteComments`), and the token broker asks before making the repository or deleting a comment.
- 7a9a116: `goodfellow build` runs a site's Client Components with Preact (`preact/compat`) instead of React where every one of them says it works with it (`export const worksWithPreact = true` in its `"use client"` file), which every interactive block in Goodfellow's registry now does: pages with them load about 32 kB of JavaScript instead of about 230 kB. Islands are rendered with Preact where pages are built too, so `useId()` gives the same ids as in the browser, each island's with a prefix of its own. A Client Component that doesn't say so keeps the site on React, and the build names it; `preact: false` in the config keeps React whatever they say, and `goodfellow build --react` or `GOODFELLOW_REACT=1` uses React for one build, such as to find out whether a problem is Preact's. `goodfellow dev` and Next.js always use React. `@goodfellow-cms/react/island` has `setIslandRenderer()` for this.
- 6b674a8: Six more blocks to add from the Blocks screen: People, Logos, Numbers, Timeline, Countdown, and Comments through Giscus, which keeps them as GitHub Discussions and waits for visitors' consent on sites that ask first.
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
- 293bbf0: Visitors' consent asks about kinds of content: other sites' content, and statistics and advertising where Site Settings → Code says the site's code is for them. Visitors can allow each kind on its own from the notice's Choose, and code marked as needed for the site to work loads without asking. A visitor's answer now lasts as many days as Site Settings says (180 by default, at most 395), and the notice asks again once it's older, or when the site asks about a kind it didn't before. Answers kept by earlier releases are asked again once.
- 368f04e: On full-stack Next.js sites, only owners can choose to use Custom HTML exactly as written, which runs it on the site. Editors see the setting but can't change it, and the site's server refuses a publish that changes it or adds the block with it. Blocks of a site's own can mark settings like that with `metadata: { owners: true }` (`ownersOnlyFields()` and `ownersOnlyChanges()` in `@goodfellow-cms/core`, `AppApiOptions.ownersOnly`).

## 0.7.0

### Minor Changes

- ede249f: Six more blocks in Goodfellow's registry, built with Tailwind alone: **News feed** (another site's RSS or Atom feed, read when the site is built), **Map** (a Google map of an address, or from Google Maps' embed code, with no API key), **Social links**, **Panel** (a box with a colored title bar), **Slideshow with quick links** (with a stop button, and still for visitors who ask for less motion) and **Content with section links** (a page's blocks beside the other pages in its part of the menu).
  
  The Menu block has two more settings: **Colors**, which puts it in a bar of the theme's primary or secondary color with see-through dropdowns to match, and **Show the pages under each submenu link**, which opens a submenu link's own pages as a third level. Dropdowns near the menu's right end now open leftwards, so they stay on the page, and dropdowns set their own text color, so a color given to the menu doesn't make them hard to read.

## 0.6.0

### Minor Changes

- 6bf08ae: Every part of a block has a stable name, such as `gf-heading` or `gf-card-title`, and **Colors & fonts → Blocks' parts** gives a part classes for every block of that kind at once, kept in `content/site.json`'s `theme.parts`. A part's classes come after the block's own and before what's chosen for each block, so a choice made for one block still wins. Blocks name their parts with `useParts()` and declare them with `withParts()`, from `@goodfellow-cms/react`; the registry's blocks name theirs after themselves, such as `gf-shadcn-cards-title`. Images and videos with **Rounded corners** off now have the `rounded-none` class, and Rows that don't wrap `flex-nowrap`, so a theme's classes can't change them.

## 0.5.0

### Patch Changes

- d74cf94: The Custom HTML block, used as written, is shown in the editor without running its scripts, in a frame sandboxed with nothing allowed, with a note that they run on the published site. The editor runs only its own scripts, so its scripts couldn't run there anyway.
- 93c5b2c: Goodfellow needs Node.js 22.23.4, 24.22.1 or 26.12.1 or later. Earlier versions decompress Brotli unsafely (CVE-2026-111497, "Node2Shell"). Builds read other sites, such as Calendar blocks' feeds, so a feed's server could run code on the computer building the site. New sites' GitHub workflows (`deploy.yml`, `scheduled.yml`) set up Node with `check-latest: true`, so they always get the newest Node 22 instead of an older copy on GitHub's runner. To do the same on an existing site, add `check-latest: true` under `node-version: 22` in each `actions/setup-node` step of its `.github/workflows/` files. GitLab's `node:22` image already has the fix. On Cloudflare Pages and Vercel, check the Node.js version in the project's build settings.

## 0.4.0

No changes in this release.

## 0.3.0

No changes in this release.

## 0.2.0

### Patch Changes

- 699e0dd: Goodfellow's repository moved to the `goodfellow-cms` organization on GitHub. Package READMEs and repository links, and the admin panel's link to release notes, now point to https://github.com/goodfellow-cms/goodfellow-cms and the documentation at https://goodfellow-cms.github.io/goodfellow-cms/.
  
  The starters' READMEs link to the documentation instead of sections of Goodfellow's README, which is now shorter.

## 0.1.0

### Minor Changes

- fd6f851: Blocks from block registries. The admin panel has a **Blocks** screen that adds blocks built with shadcn/ui to the editor, and removes them, with no developer: adding one publishes its code into the site's `blocks/installed/` and the shadcn components it uses into `components/ui/`, in one commit, and the editor offers it once the site has been rebuilt. Removing a block is refused while content uses it, and keeps files someone has changed.
  
  `@goodfellow-cms/registry` is Goodfellow's registry, with nine blocks: Hero, Cards, Call to action, Testimonials, Notice, Pricing table, FAQ, Tabs and Image carousel. Its README documents the format for registries of blocks built with other libraries, which a site offers once its config lists them in `registries`.
  
  `create-goodfellow` starts new sites with the recommended blocks, or with `--blocks built-in` the built-in blocks only. `@goodfellow-cms/core` plans installs and removals (`planInstall()`, `planRemove()`), and its stores and the GitLab backend read and write the folders installed blocks use. `goodfellow dev` and `next dev` serve the site's copy of the registry, and `goodfellow` resolves `@/` imports from the site's root, as shadcn code expects. `@goodfellow-cms/react`'s theme adds the colors shadcn components use, such as `card` and `destructive`.
- ce5faee: A Custom HTML block in Goodfellow's block registry (not recommended, under "Advanced"), for HTML written by hand. `sanitizeHtml()` makes it safe by default; used exactly as written, it runs on the site but only in a sandboxed frame in the editor.

### Patch Changes

- 0ed1018: Custom HTML used exactly as written now runs its scripts whenever its page is shown, also after moving to the page from another one on a Next.js site, where browsers don't run scripts in HTML added to the page. Opened directly, the page runs them once, as before.
- 4ca2dc1: Every package has a README, keywords and links to its documentation, repository and issues, for its page on npm. All the packages are released together with the same version.
- d91eea1: The packages are published under the `@goodfellow-cms` scope on npm, such as `@goodfellow-cms/core` and `@goodfellow-cms/react`, since `@goodfellow` was taken. `goodfellow` and `create-goodfellow` keep their names, and the block registry's name in `components.json` and refs such as `@goodfellow/shadcn-faq` stays `@goodfellow`.
