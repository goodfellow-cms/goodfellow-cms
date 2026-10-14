<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/public/media/logo-dark.svg">
    <img src="docs/public/media/logo.svg" alt="Goodfellow" width="320">
  </picture>
</h1>

A git-based website builder built on the [Puck](https://puckeditor.com) visual editor.

Goodfellow gives non-technical site owners a drag-and-drop editor at `/admin` with no server, database or monthly hosting bill. Pages are stored as files in the site's own GitHub or GitLab repository. Every save is a commit, and a free static host (GitHub Pages, GitLab Pages or Vercel) rebuilds the site.

> **Status: early development.** The packages are on npm, released together with one version number, and the [roadmap](#roadmap) shows what's done and what's next. The [documentation](https://goodfellow-cms.github.io/goodfellow-cms/), built with Goodfellow, describes the latest release: what Goodfellow does, how to [create a site](https://goodfellow-cms.github.io/goodfellow-cms/docs/create-a-site), and how to write blocks. [The demo](https://goodfellow-cms.github.io/goodfellow-demo/admin/) lets anyone try the admin panel.

## How it works

```
Editor's browser                       Git host (GitHub / GitLab)         Static host
┌──────────────────────┐   API calls   ┌──────────────────────┐    push   ┌───────────────┐
│ /admin               │ ────────────> │ content/*.json       │ ────────> │ build + serve │
│ Puck editor + forms  │ <──────────── │ public/media/*       │  trigger  │ static HTML   │
└──────────────────────┘               └──────────────────────┘           └───────────────┘
```

- **No server.** The admin panel is part of the static site and talks to the GitHub or GitLab API straight from the browser.
- **Instant preview.** The editor renders pages in the browser, so editors see changes before anything is published.
- **Publishing is a commit.** A commit to the main branch triggers the host's normal build. The admin panel shows when the new version is live.
- **Content is plain files.** One JSON file per page, readable in any diff and portable to other tools.

## Roadmap

1. **Static rendering** (done). Build a static site from hand-written `content/` files.
2. **Editor** (done). The admin panel against local files: pages, site settings, header and footer, custom CSS, live Tailwind preview.
3. **Git backends** (done). GitHub and GitLab sign-in, publishing, conflict detection and deploy status, plus GitHub Pages, GitLab Pages and Vercel setups.
4. **Collections and templates** (done). Collections with their own fields, a shared page design for their items, and a block that lists them on other pages.
5. **AI assistant** (done). Draft and rewrite pages with Claude, OpenAI or a free AI service, called straight from the editor's browser with the editor's own key. Editors without a key can copy a prompt into Claude.ai or another chat app and paste the answer back.
6. **Media library** (done). Upload, browse and replace images and files from the admin panel, and choose them for blocks and settings. A Video block plays uploaded videos, YouTube and Vimeo videos, and other sites' players, without adding JavaScript to the site's pages.
7. **Starters** (done). `create-goodfellow`, which creates a site and sets up its storage and host, and an example parish site with collections and custom blocks.
8. **Next.js adapter** (done). Goodfellow pages and the admin panel in a Next.js app, exported as static files, with a Next.js starter. Links use `next/link` and images `next/image`, sites can be served from a subfolder, and blocks can use Client Components.
9. **Interactive blocks everywhere** (done). Client Components in blocks (`"use client"`) run in the browser on sites built with `goodfellow build` too, not only with Next.js.
10. **shadcn blocks** (done). A registry of Goodfellow blocks built with [shadcn/ui](https://ui.shadcn.com), installed into the site without a developer. When creating a site, admins choose "Recommended" or "Built-in blocks only"; the admin panel lets them add and remove individual blocks. Others can publish registries of blocks built with other libraries, in a documented format. Updating installed blocks comes with step 16's automatic updates.
11. **Demo mode** (done). A site whose config sets `demo: true` (it can only be turned on in the config, never from the admin panel) opens its admin panel to anyone, with no sign-in. Visitors can try everything, from editing pages and collections to the media library, settings and the AI assistant, but nothing is published: their changes stay in their own browser until they start over. The demo starts from a copy of the site's content that the build includes, so the repository can stay private.
12. **Documentation site** (done). A documentation site built with Goodfellow itself, in `docs/`, and the blocks it needs, which any site can use: code with syntax highlighting, search (with [Pagefind](https://pagefind.app), indexed only on sites that use a search block), navigation within a collection, previous and next links, and an "On this page" list. Collections can store their items as Markdown files, edited in the admin panel's formatted editor or as Markdown. The docs cover why Goodfellow exists and how it compares with alternatives such as WordPress and TinaCMS, guides for site owners and editors, reference docs for developers, and each host's rules for business sites on its free plan. Online at [goodfellow-cms.github.io/goodfellow-cms](https://goodfellow-cms.github.io/goodfellow-cms/) since step 13.
13. **Going live** (done). Make the repository public, publish the packages to npm, and put the documentation site online with GitHub Pages. A demo site, made from the parish example in a repository of its own with the published packages, goes online with GitHub Pages too, and the docs link to it.
14. **Site setup without a developer** (done). The documentation site's [Create a site](https://goodfellow-cms.github.io/goodfellow-cms/new-site/) page creates a site from any starter, with the same choices as `create-goodfellow`, in the person's own GitHub or GitLab account, straight from their browser, and puts it online with GitHub Pages, GitLab Pages or Vercel. It asks what the site is for and recommends a host whose free plan allows it, such as GitLab Pages for a business, and warns that GitHub Pages doesn't work with private repositories on GitHub's free plan. On GitHub, people sign in with a token the page links to (step 21's sign-in worker will replace it); on GitLab, with GitLab or a token. The page writes the repository into the site's config, so nobody has to edit it.
15. **Custom domains** (done). Connect a domain from the admin panel's **Site Settings → Domain**. Goodfellow connects it on GitHub Pages or GitLab Pages, lists the records to add at the domain's registrar, with guides for popular registrars in the docs, and checks until the domain works: the records, as the world sees them, the host's HTTPS certificate, and the site at its new address. Then it sends everyone to the secure address. Sites on Vercel connect their domain in Vercel, as the screen explains.
16. **Running a site without a developer.**
    - Invite and remove editors from the admin panel (done).
    - Version history, with a way to restore an earlier version of a page (done).
    - Automatic updates (done): a scheduled job updates Goodfellow, and blocks added from block registries, and publishes the update only if the site still builds. Block updates replace only files nobody has changed. Fixes install on their own; newer releases when an owner chooses them. Owners can turn automatic fixes off, or go back to the previous release, which is then skipped.
    - Plain-language explanations when a rebuild fails (done).
17. **Calendars** (done). An Events collection and a Calendar block, worked out when the site builds, so visitors only get HTML.
    - **Events** have a start and end date and time, an all-day option, a place, and repeats (daily, weekly, monthly or yearly, every so often, on chosen weekdays or the same weekday of the month, until a date, with dates to skip), so a weekly service is one entry. Collections get a date-and-time field for them, which any collection can be a calendar of, and Site Settings a time zone. New collections can start as Events.
    - **The Calendar block** shows upcoming events as a list or a month at a time, with a page for each month. The nightly rebuilds keep "upcoming" current.
    - **Calendars kept elsewhere:** the block can also show a public calendar feed (an `.ics` address, such as Google Calendar's), read when the site builds, so editors who keep a Google Calendar go on doing so and the site catches up on its next build.
    - **Subscribing:** the build writes the events as an `.ics` file that visitors can subscribe to, and each event has "Add to calendar" links.
    - **The docs** also describe embedding a Google Calendar in a Custom HTML block (with its sanitizing turned off, since that removes embedded frames), following Google's guide, [Add a calendar to your website](https://support.google.com/calendar/answer/41207). The calendar is then managed in Google, and changes show up at once rather than after the next rebuild, though it looks like Google's calendar rather than the site.
18. **Showing collections** (done). Blocks that show a collection's items anywhere on the site, such as a blog page with every post or a home page section with the three latest news articles or the next five events, worked out when the site builds, so visitors only get HTML.
    - **Collection list** filters by a choice field or by tags (a new field type for several choices), has a heading and a "See all" link, and more ways to sort.
    - **Pages of items:** a long list is split into pages of its own (`/blog/page/2`), with links between them, and a list can have a page for each of a field's choices (`/blog/topics/events`). Any block can ask for pages like these, as the Calendar block does for its months. Each page has its own address for search engines, and only the first is in the site's own search.
    - **Collection loop:** a block whose contents, designed in the editor with any blocks, repeat once for each item, with the item's fields filled in as in a collection's page design, for layouts the list's own styles don't cover.
    - Visitors don't sort or filter lists themselves: editors choose each list's order and filters, and the Search block finds the rest.
19. **Forms** (done). A Form block whose questions (wording, kind of answer, whether it must be answered, choices and help text) are set in the editor.
    - **No server:** it's a plain HTML form that posts to a form service and works without JavaScript; the service emails the answers and sends visitors back to a thank-you page the editor chooses. The service is chosen once in Site Settings: [Web3Forms](https://web3forms.com) by default (250 answers a month free, and no account, just an email address), [Formspree](https://formspree.io) (whose free plan shows its own thank-you page), or any service that accepts a plain form post.
    - **Spam:** a hidden honeypot field on every form, plus the service's own captcha: Formspree's reCAPTCHA, or Web3Forms' hCaptcha, which a Site setting turns on, since it needs Web3Forms' script on pages with a form.
    - **Longer forms**, such as surveys and sign-up sheets, can use Google Forms: the Form block shows one from its embed code.
    - **The docs** explain that answers go to the chosen service, not to the site's repository.
20. **Stock photos from the AI assistant.** When the media library has nothing that fits, the AI assistant can add openly licensed photos from [Openverse](https://openverse.org), which gathers Creative Commons and public domain images from Wikimedia Commons, Flickr and other collections. It's searched straight from the editor's browser with no key, and only photos whose license allows commercial use and changes are offered. Each photo is saved to the media library with its credit, which the site shows as the license requires. A checkbox in the AI panel turns this on or off for each request and is remembered in the browser; a site's config can turn it off for everyone. (Not Unsplash: its API needs a key that a browser can't keep secret, and its rules require showing photos from Unsplash's own addresses rather than the site's media library.)
21. **Sign in with GitHub.** A small Cloudflare Worker that Goodfellow runs for every site, so editors sign in with GitHub instead of pasting a token. GitLab sign-in already works without one.
    - **Narrow tokens:** site owners install a Goodfellow GitHub App on the repositories they choose. The worker gives the admin panel a token for one repository only, with only the permissions it needs (not workflows or repository settings), lasting an hour and renewed while the editor is signed in. The editor's own GitHub token never leaves the worker, and commits still show the editor as their author.
    - **Only to the site's own address:** the worker hands a token only to an address the repository's site settings list, never to `localhost`, since `goodfellow dev` and `next dev` don't need one.
    - **Rate limits** per editor, per site and overall, kept below Cloudflare's free plan's daily limit.
    - **Token sign-in stays:** when the admin panel can't use the worker, for example because its limit for the day has been reached or a production build is being viewed on `localhost`, editors sign in with a token as they do now.
    - **Protected history:** the site setup page (step 14) signs in through the worker too, and gives new repositories rules that stop anyone rewriting the main branch's history, where the GitHub plan allows it. GitLab protects it by default.
    - **Owner tools:** a second Goodfellow GitHub App, with the Administration and Pages permissions, used only by owners on the Editors and Domain screens, replaces the owner token. The everyday sign-in's app never gets those permissions, so editors' tokens can't delete the repository or change its settings.
    - **Self-hosting:** site owners can run their own copy of the worker, with their own GitHub App.
22. **Claude connector.** An MCP server, so editors can work on their sites from Claude: read pages, entries and settings, see the site's blocks, make changes, check them in screenshots, and publish them or submit them for review.
    - **Ways to use it:**
      - a Claude Desktop extension (a `.mcpb` file) and `claude mcp add` for Claude Code, both running on the editor's computer with a token;
      - **Deploy to Cloudflare** and **Deploy to Vercel** buttons, which set up the server in the site owner's own account (Vercel's free plan is for non-commercial use only);
      - Goodfellow's own Worker, free, added as a custom connector in Claude on the web, on computers and on phones.
    - **Versions:** each site's build writes a description of its blocks and of the content formats it reads, so the server writes only content that site understands. It supports the current and previous minor versions of Goodfellow, and asks older sites to update.
    - **Tokens:** the hosted and deployed servers sign in through their own GitHub App, separate from step 21's. They keep editors' refresh tokens only encrypted, readable only while Claude is calling, and call GitHub with tokens limited to one repository that last an hour. GitLab's tokens reach every project the editor can and last two hours, which the docs explain.
    - **Rate limits** per editor, per site and overall, with a plain-language message that Claude passes on when one is reached.
    - **Screenshots** of the live site, and of unpublished changes through a preview page in each site's build, taken with Cloudflare's Browser Rendering.
23. **Light and dark sites.** A site can have a light and a dark mode, with every theme color set for each in Site Settings. Pages follow the visitor's light or dark setting, and blocks follow the theme in both, as the admin panel's own light and dark modes do.
24. **Full-stack Next.js sites.** For organizations with a developer: Goodfellow as the CMS of a Next.js app with a server of its own, beside the app's own pages. Sites without a server stay the default, and nothing here becomes required for them.
    - **Sign-in through the app:** the admin panel signs in with the app's own authentication (such as Better Auth), and the app says who may edit, publish and change settings.
    - **Git on the server:** the app's server reads and publishes through GitHub or GitLab with a token from an environment variable, behind that sign-in, so no git credentials reach the browser. Commits still name the editor.
    - **AI keys on the server** (optional): keys in environment variables, with the AI assistant's requests sent through the app's server, so editors don't need keys of their own.
25. **Moving from and to WordPress.** Import a WordPress site's pages, posts, categories, tags, menus and media, from its export file or its address, with WordPress's blocks turned into Goodfellow's and old addresses kept or redirected. Export a Goodfellow site as a WordPress export file, with its blocks turned into WordPress's.

Planned for later: review workflows (pull/merge requests from the admin panel), per-user permissions, importing from other systems, plugins and themes, and Bitbucket support.

## Contributing

To report a problem or suggest a feature, [open an issue](https://github.com/goodfellow-cms/goodfellow-cms/issues/new/choose); for security problems, see [SECURITY.md](SECURITY.md). See [AGENTS.md](AGENTS.md) for architecture rules and conventions. They apply to human contributors as well as coding agents. [RELEASING.md](RELEASING.md) explains how versions are released to npm.

## License

[MIT](LICENSE)

## Acknowledgements

Goodfellow is built on [Puck](https://github.com/puckeditor/puck) and is not affiliated with Puck or its maintainers. The name comes from Robin Goodfellow, the other name of Puck in *A Midsummer Night's Dream*. Sign-in and backend design draw on [Sveltia CMS](https://github.com/sveltia/sveltia-cms) and [Decap CMS](https://decapcms.org).
