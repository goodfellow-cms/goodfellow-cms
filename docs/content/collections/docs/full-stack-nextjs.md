---
version: 1
title: Full-stack Next.js sites
description: Goodfellow as the CMS of a Next.js app with a server of its own, where editors sign in with the app's own sign-in and its server publishes for them.
section: developers
order: 7
---

Goodfellow sites are static files by default, and nothing on this page is needed for them. For an organization with a developer and a [Next.js](/docs/nextjs) app that has a server of its own, Goodfellow can be the app's CMS, beside the app's own pages:

- Editors sign in to the admin panel with the app's own sign-in, such as [Better Auth](https://www.better-auth.com), and the app says who may edit and who may change settings.
- The app's server reads and publishes through GitHub, GitLab, or Bitbucket with one token, from an environment variable, which never reaches a browser. What each editor publishes still names them as its author.
- Optionally, the AI assistant asks AI services through the server, with keys in environment variables, so editors don't need keys of their own.

The site is still rebuilt when something is published, as hosts that run Next.js do on every change to the repository. `next dev` still saves to the files on disk.

## Keep the content in a repository of its own

We strongly recommend keeping a full-stack site's content in a [repository of its own](/docs/content-repository#full-stack-nextjs-sites), and giving the server a token for that repository only.

The server holds its token all the time, and runs code from many places: the app's own, its packages, its blocks, and plugins' server modules. A token that can write to the site's repository can also change that code, which the host then builds and runs with every secret the server has. So anyone who gets the token, through a bug or a package with something added to it, could take over the site and its server for good, not just change its pages. A token that can reach only the content can change only the content, which [version history](/docs/publishing#version-history) can put back. The server also refuses to write anything but content then, whoever asks.

It only helps if the token reaches nothing but the content repository. Make it a token for that one repository, as [step 5](#setting-it-up) says for each host, rather than one that reaches everything its account can. On GitLab, members of a group reach every project in it, and on Bitbucket, a workspace's admins reach every repository in it. So make sure the token's account, and the people who manage it, can't reach the code repository some other way.

The cost is a second repository to set up. Blocks and plugins are then added by a developer in the code repository, since the admin panel can't change code. And where the host builds from the code repository, as hosts that run Next.js do, the admin panel can't say when a change is live.

## Setting it up

1. In `goodfellow.config.tsx`, say where the site is stored, as for any site: `backend: github({ repo: "your-name/your-site" })` or `backend: gitlab({ project: "your-group/your-site" })`. With the content in a [repository of its own](#keep-the-content-in-a-repository-of-its-own), as we recommend, that's the content repository, with `contentOnly: true`: `backend: github({ repo: "your-name/your-site-content", contentOnly: true })`.

2. In `next.config.ts`, build it for a server rather than as static files:

   ```ts
   export default withGoodfellow({ agentRules: false }, { server: true });
   ```

   The build script is then `next build && goodfellow-next finish --server`, which writes the [calendar files](/docs/calendars#adding-to-calendars-and-subscribing) of collections of events into `public/calendars/`, collections' [feeds](/docs/search-engines#feeds) into `public/feeds/`, the [content API](/docs/content-api) into `public/api/`, the [search](/docs/search) index into `public/pagefind/`, and the editor's frames into `public/admin/editor/frames/`, so they're served as static files, as the pages are. It reads the pages from the content and the site's config rather than from what `next build` wrote, and bundles the editor's frames from the site's code, as `next dev` bundles them, so it can also run before the build. The server sends the frames' Content Security Policy as a header. Next.js sends redirects itself.

   These folders are written again by every build, so keep them out of the repository with these lines in `.gitignore`, which the Next.js starter's already has:

   ```text
   public/calendars/
   public/pagefind/
   public/admin/editor/frames/
   ```

3. Add the admin panel's API, at `app/api/goodfellow/[...path]/route.ts`:

   ```ts
   import { nodeProvenance } from "@goodfellow-cms/core/node";
   import { goodfellowApi } from "@goodfellow-cms/next/server";
   import config from "@/goodfellow.config";
   import { auth } from "@/lib/auth";

   export const { GET, POST } = goodfellowApi({
     config,
     // Who's signed in, and what they may do: null for nobody, false for someone who may not edit.
     async authorize(request) {
       const session = await auth.api.getSession({ headers: request.headers });
       if (!session) return null;
       const { user } = session;
       if (user.role !== "admin" && user.role !== "editor") return false;
       return {
         login: user.email,
         name: user.name,
         email: user.email,
         role: user.role === "admin" ? "owner" : "editor",
       };
     },
     signIn: "/sign-in?next=/admin/",
     signOut: "/sign-out",
     ai: { anthropic: process.env.ANTHROPIC_API_KEY },
     // Checks plugin and theme updates owners install before they're three days old.
     provenance: nodeProvenance(),
   });
   ```

   `provenance` checks, with npm's registry and Sigstore, that an update an owner installs early was built where the version installed was (see [Plugins](/docs/plugins#install-a-plugin-from-the-admin-panel)). It needs Node, so leave it out on servers that don't run Node, such as Cloudflare Workers: owners then install updates once they're three days old, and the admin panel doesn't offer them sooner.

4. In `app/admin/page.tsx`, point the admin panel at it:

   ```tsx
   <GoodfellowAdmin site={site.admin()} server="/api/goodfellow" />
   ```

5. Give the server its token as `GOODFELLOW_GIT_TOKEN` in the host's environment variables. Make it for the content repository if the site has one, as we recommend, and never for the code's:

   - **GitHub:** a fine-grained token for that one repository only, with Contents read and write, and Deployments and Actions read, which the admin panel uses to say when a change is live and why a rebuild failed. Make it from an account kept for the site, such as a machine user, rather than a person's own.
   - **GitLab:** a project access token with the Developer role (Maintainer if the main branch only lets Maintainers push) and the `api` scope. GitLab.com's free plan has no project access tokens; there, use a fine-grained personal access token (GitLab 19.2 and later) that reaches only that project, from an account kept for the site that's a Developer there. Never use a personal access token without that limit: it reaches every project its account can, the code's too if the account can reach it, directly or through a group.
   - **Bitbucket:** a repository access token with Repositories read and write and Pipelines read. Commits still name each editor as their author.

## Who may do what

`authorize` is asked on every request, so taking someone's access away in the app takes effect at once. It gives each editor one of two roles:

| Role | May |
|---|---|
| `editor` | Edit and publish pages, collections' items, media, menus, and the header and footer |
| `owner` | Also change Site Settings, redirects, collections' settings and templates, and submit blocks for review |

The admin panel hides what editors can't change, and the server refuses it whatever a browser sends. Editors also can't choose to use [Custom HTML](/docs/add-blocks) exactly as written, which would run it on the site: they see the setting but can't change it, and the server refuses a publish that changes it. A block an owner set to be used exactly as written is the owner's whole: editors can move it or take it away, but the server refuses any other change to it, since its HTML would run as written. Blocks of your own can mark settings like that with `metadata: { owners: true }` ([Write blocks](/docs/write-blocks#blocks-for-collections)).

The server also checks what it's sent the way the admin panel checks uploads, since a browser could send anything: a file in the media library must be a kind the site can use by the name it's saved under, so a page can't be saved as `/media/x.html`, and an SVG must already be cleaned as an upload is. Editors may add files to [media storage](/docs/plugins#media-storage) and remove them, as uploading does, but only owners can change which plugin keeps them or where they're served from, which decides where every `/media/` address on the site points. Settings are owners' when they're submitted for review too.

A block's code, and what it shares in `components/`, `lib/`, and `hooks/`, runs on the site's server, which holds its token and AI keys. So on the Blocks screen, adding or removing blocks is submitted for review, as a pull request or merge request for a developer to accept, and the server refuses to publish those files otherwise. To let owners publish them themselves, pass `codeChanges: "publish"` to `goodfellowApi()`. Moving a page doesn't offer an editor a redirect from its old address, since redirects are part of Site Settings.

Owners can also [limit what each person changes](/docs/sign-in#limiting-what-editors-can-change), by their `login`. The server checks every publish against their limits too, and takes changes outside them for review: a pull request or merge request asking the people the limits name as reviewers, since the server can't tell which of the app's people are owners on the git host.

Signing in and out stay the app's own: the admin panel sends people to `signIn`, and its Sign out button goes to `signOut`, if there is one.

## Pages for members

On a full-stack site, a page's settings have **Who can see this page**: **Everyone**, or **Only signed-in members**, which `visibility: "members"` stores. A collection's settings can keep every item's page to members too. Only the site's owners can change either, or delete a members' page: editors see a page's setting but can't change it, and the site's server refuses such a change from them. Other sites aren't offered it, since only a server can keep a page to anyone, and `goodfellow build` and `goodfellow-next finish` warn when a static site has pages marked for members, which they publish to everyone.

Goodfellow doesn't decide who's a member or what everyone else sees: your app does. `isMembersOnly(page, content.collections)` from `@goodfellow-cms/core` says whether a page is for members, whether by its own setting, its collection's template, or its collection. Decide on every request, in `proxy.ts` or a route that renders for each request, never in the starter's page route: `next build` renders its pages once, and everyone is sent the same copy. Whatever is sent to a member mustn't be kept and sent to anyone else, so mark it `Cache-Control: private, no-store`.

What builds publish beside the pages leaves members' pages and collections out, since anyone can read them: the site's search, feeds, calendar files, and the content API. Members' calendars offer no calendar files to download or subscribe to. Three things stay your app's to keep private: the content repository, which holds every page, so make it private; anything a public page shows of members' items, such as a list of their titles; and the files members' pages show. The media library's files are in `public/media/`, which the server serves to anyone who has the address, so keep files only members may have out of it, somewhere your app checks who's asking before sending them.

### Teasers and a paywall

Rather than turn everyone else away, a members-only page can show them its start, a teaser, and say how to read the rest. Give `goodfellowPages()` the name of a block of your own that says so, such as a Paywall block with a link to subscribe and one to sign in:

```ts
export const site = goodfellowPages(config, { paywall: "Paywall" });
```

Editors put the block where a members-only page's teaser ends. `site.Page` then shows everyone the blocks above it, and the block itself. A paywall inside another block, such as a Section, ends the teaser before that whole block, since what else it holds may be for members. A members-only page with no paywall, such as a members' collection's item whose template places none, shows only the block, with its default words, so nothing an editor didn't choose to show is published. Members-only pages tell search engines nothing in structured data either, since an item's would start with its text.

`site.MembersPage` shows every page in full, without its paywalls, for a route of its own, such as `app/(site)/members/pages/[[...path]]/page.tsx`, which your `proxy.ts` sends members' requests to. Give that route the same `dynamic` and `revalidate` as your page route, so each members' version is kept once it has rendered, as its version for everyone is, and both are served from the cache without rendering a page for any one visitor. Every page has one, since the proxy can't tell which are for members. The members' versions render as they're asked for, so the site needs a `source` (see [Publishing without a rebuild](#publishing-without-a-rebuild)) where its server can't read `content/`, such as on a Worker. Only your app knows who's a member, so the proxy has to answer a request for that route's own address "Page not found", however it's spelled (`%70` for `p`, say), or anyone could read the pages there. It's also what keeps the members' version out of every cache between the site and the browser: send it with `Cache-Control: private`.

The [company example](https://github.com/goodfellow-cms/goodfellow-cms/tree/master/examples/company) does all of this, deciding who's a member from a signed cookie, so most requests read no database; its README says how.

## AI keys on the server

With `ai`, the AI assistant asks those services through the server, which adds its own key, so editors don't need keys of their own and never see the site's. Give a key for any of the [AI assistant's](/docs/ai-assistant) services, or a key and an address, such as `custom: { key, baseUrl: "https://ai.example/v1" }`, with `models` listing the only models editors may ask for where the service has others that cost more, Claude included (`anthropic: { key, models: ["claude-haiku-4-5"] }`). The server sends on only what the assistant asks for: Claude's answers in its own models and up to the assistant's length, never tools, files, or other services' features the site would pay for. Editors see them as provided by the site. They can still use other services with keys of their own, unless the config's `ai.providers` leaves those out.

The server sends on only the requests the assistant makes, and only for people `authorize` lets in.

## Plugins' routes

[Plugins](/docs/plugins#on-full-stack-sites-servers) with a server module answer at `/api/goodfellow/plugins/<id>/`. Import each server module in the API route and pass it to `goodfellowApi()` as `plugins: { "goodfellow-plugin-gallery": galleryServer }`. They're answered for anyone, as webhooks need, and told who's signed in only for requests from the site's own pages. A server module runs with everything the server has, so add only plugins you'd trust with its token.

Owners can choose plugins on the admin panel's Plugins screen too, but on a full-stack site installing, updating, or removing one is submitted for review, as a pull request or merge request for a developer to accept, since the site's builds and server hold its secrets. Changes to `plugins/installed/` are refused from the admin panel otherwise. Once you've accepted one, add its server module to the API route if it has one.

## After each publish

`onPublish` is called after each publish from the admin panel, before the editor hears it worked. It's given the files the publish changed (`paths`, such as `content/pages/about.json`), who published them (`editor`, as `authorize` gave them), and the new `revision`:

```ts
export const { GET, POST } = goodfellowApi({
  config,
  authorize,
  signIn: "/sign-in",
  onPublish: async ({ paths, editor }) => {
    await notifyTeam(`${editor.name} published ${paths.join(", ")}`);
  },
});
```

Use it to tell another system, or to refresh pages your app caches itself. The site still rebuilds as usual, which is when visitors see the change, unless its pages render from the repository (below). The publish has already happened when it's called, so if it fails, the failure goes to `onError` and the editor still sees "Published."

## Publishing without a rebuild

A full-stack site can render its pages from the repository as it is now, rather than from the files it was built with, so a publish shows without building the site again. Give `goodfellowPages()` a `source`, such as `repositorySource()` from `@goodfellow-cms/core`, which asks the host for the live branch's newest revision each time and reads each revision's content once, and keep rendered pages in your host's cache until a publish says they changed:

```ts
// lib/site.ts
import { repositorySource } from "@goodfellow-cms/core";
import { goodfellowPages } from "@goodfellow-cms/next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import config from "@/goodfellow.config";

let live: ReturnType<typeof repositorySource> | undefined;

export const site = goodfellowPages(config, {
  source: () => {
    // `next dev`, and `next build`, which renders pages from the files it builds.
    if (process.env.NODE_ENV === "development" || process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return undefined;
    const token = process.env.GOODFELLOW_GIT_TOKEN;
    if (!token) throw new Error("Set GOODFELLOW_GIT_TOKEN, which pages read the repository with.");
    const backend = config.backend;
    if (!backend?.server) throw new Error("The site's backend can't be reached from its server.");
    live ??= repositorySource(backend.server({ token }));
    return live();
  },
});
```

```ts
// app/api/goodfellow/[...path]/route.ts
import { revalidatePath } from "next/cache";

export const { GET, POST } = goodfellowApi({
  config,
  authorize,
  signIn: "/sign-in",
  // A publish can change the header, menus, or a list every page shows, so every page renders again.
  onPublish: () => revalidatePath("/", "layout"),
});
```

Mark the page route `export const dynamic = "force-static"`, so each page is kept once it has rendered, and give it, and the sitemap, a `revalidate` time, such as `export const revalidate = 3600`, since only a publish through the admin panel says pages changed: a page renders again once it's that old, so a scheduled time coming, what a page shows by today's date, and changes that reach the repository another way, such as from Claude or a merged review, show within about that long. It isn't exact: the first visit after that time still gets the old page while the new one renders, and if rendering fails, as when the host's API doesn't answer, the old page stays until a later visit renders it, so give a scheduled change some time before it has to be online. Where `source` gives nothing, as in `next dev` and while `next build` renders pages, pages read the files on your computer. Without the token it throws, so pages fail rather than show the files the site was built with, which the host would keep as though they were current while publishes never showed. Give the root layout's `<html lang>` `await site.language()` rather than the site's settings: it falls back to the language of the files the site was built with where `source` can't be read, such as without its token, so the admin panel and sign-in, which the root layout wraps, still open to fix it, while the pages themselves fail. A page's first visit after a publish renders it, which needs the host's API to answer then; the pages already kept don't. New photos and other files in `public/media/` are served from the files the site was built with, so build the site again after each publish, as the company example's content repository asks its code repository to, and until that build is online a page that shows a new photo shows it missing. `revalidatePath()` clears the pages kept where it runs, so a site on more than one server needs them kept in one place every server reads, such as Next.js's `cacheHandler` over a shared store, or every server but the one that took the publish shows the old pages until they're `revalidate` old. The company example does this on Cloudflare Workers, keeping pages in Workers KV, which every location reads, and where a publish can take up to a minute to reach every location.

## Safety

- The API answers people who aren't signed in only with where to sign in. Every request must come from the site's own pages: it carries a header that browsers don't send to another site without asking it first, and requests that say they come from another site are refused.
- It reads and writes only what the admin panel edits: `content/`, `public/media/`, and installed blocks' code.
- Errors from GitHub, GitLab, or Bitbucket stay on the server, which reports them with `console.error`, or `onError` if given. Editors see only that something went wrong.

## What's different

- **Search** finds the pages Next.js renders while building, which is all of the site's pages. A page made later is found once the site is rebuilt, which publishing does anyway.
- **Fonts** are copied into `public/fonts/google/` by `next build` before it renders any page, so visitors' browsers never ask Google for them, as with exports. Where Google can't be reached while building, the build says so and pages load them from Google. `next dev` always loads them from Google.
- **Uploads** go through the server. Some hosts limit what a request can send, such as Vercel's functions, at 4.5 MB, so larger uploads fail there.
- **Screens for the git host:** the Editors, Domain, and Updates screens aren't shown, since the app manages its own people and its host its own domain. A full-stack site can't have an [admin address](/docs/custom-domains#an-admin-address): its admin panel signs in with the app's own sign-in, and `withGoodfellow()` and `goodfellow-next finish --server` refuse a config that names one. `goodfellow-next update` still updates the site from a computer.
