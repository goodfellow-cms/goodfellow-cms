---
version: 1
title: Full-stack Next.js sites
description: Goodfellow as the CMS of a Next.js app with a server of its own, where editors sign in with the app's own sign-in and its server publishes for them.
section: developers
order: 7
---

Goodfellow sites are static files by default, and nothing on this page is needed for them. For an organization with a developer and a [Next.js](/docs/nextjs) app that has a server of its own, Goodfellow can be the app's CMS, beside the app's own pages:

- Editors sign in to the admin panel with the app's own sign-in, such as [Better Auth](https://www.better-auth.com), and the app says who may edit and who may change settings.
- The app's server reads and publishes through GitHub, GitLab or Bitbucket with one token, from an environment variable, which never reaches a browser. What each editor publishes still names them as its author.
- Optionally, the AI assistant asks AI services through the server, with keys in environment variables, so editors don't need keys of their own.

The content still lives in the site's repository, so the site is still rebuilt when something is published, as hosts that run Next.js do on every change to the repository. `next dev` still saves to the files on disk.

## Setting it up

1. In `goodfellow.config.tsx`, say where the site is stored, as for any site: `backend: github({ repo: "your-name/your-site" })` or `backend: gitlab({ project: "your-group/your-site" })`.

2. In `next.config.ts`, build it for a server rather than as static files:

   ```ts
   export default withGoodfellow({ agentRules: false }, { server: true });
   ```

   The build script is then `next build && goodfellow-next finish --server`, which writes the [calendar files](/docs/calendars#adding-to-calendars-and-subscribing) of collections of events into `public/calendars/`, collections' [feeds](/docs/search-engines#feeds) into `public/feeds/`, the [content API](/docs/content-api) into `public/api/` and the [search](/docs/search) index into `public/pagefind/`, so they're served as static files, as the pages are. Next.js sends redirects itself.

   Both folders are written again by every build, so keep them out of the repository with these lines in `.gitignore`, which the Next.js starter's already has:

   ```text
   public/calendars/
   public/pagefind/
   ```

3. Add the admin panel's API, at `app/api/goodfellow/[...path]/route.ts`:

   ```ts
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
   });
   ```

4. In `app/admin/page.tsx`, point the admin panel at it:

   ```tsx
   <GoodfellowAdmin site={site.admin()} server="/api/goodfellow" />
   ```

5. Give the server its token as `GOODFELLOW_GIT_TOKEN` in the host's environment variables:

   - **GitHub:** a fine-grained token for the site's repository only, with Contents read and write, and Deployments and Actions read, which the admin panel uses to say when a change is live and why a rebuild failed. Make it from an account kept for the site, such as a machine user, rather than a person's own.
   - **GitLab:** a project access token with the Developer role (Maintainer if the main branch only lets Maintainers push) and the `api` scope.
   - **Bitbucket:** a repository access token with Repositories read and write and Pipelines read. Commits still name each editor as their author.

## Who may do what

`authorize` is asked on every request, so taking someone's access away in the app takes effect at once. It gives each editor one of two roles:

| Role | May |
|---|---|
| `editor` | Edit and publish pages, collections' items, media, menus, and the header and footer |
| `owner` | Also change Site Settings, redirects, collections' settings and templates, and submit blocks for review |

The admin panel hides what editors can't change, and the server refuses it whatever a browser sends. Editors also can't choose to use [Custom HTML](/docs/add-blocks) exactly as written, which would run it on the site: they see the setting but can't change it, and the server refuses a publish that changes it. Blocks of your own can mark settings like that with `metadata: { owners: true }` ([Write blocks](/docs/write-blocks#blocks-for-collections)).

A block's code, and what it shares in `components/`, `lib/` and `hooks/`, runs on the site's server, which holds its token and AI keys. So on the Blocks screen, adding or removing blocks is submitted for review, as a pull request or merge request for a developer to accept, and the server refuses to publish those files otherwise. To let owners publish them themselves, pass `codeChanges: "publish"` to `goodfellowApi()`. Moving a page doesn't offer an editor a redirect from its old address, since redirects are part of Site Settings.

Owners can also [limit what each person changes](/docs/sign-in#limiting-what-editors-can-change), by their `login`. The server checks every publish against their limits too, and takes changes outside them for review: a pull request or merge request asking the people the limits name as reviewers, since the server can't tell which of the app's people are owners on the git host.

Signing in and out stay the app's own: the admin panel sends people to `signIn`, and its Sign out button goes to `signOut`, if there is one.

## AI keys on the server

With `ai`, the AI assistant asks those services through the server, which adds its own key, so editors don't need keys of their own and never see the site's. Give a key for any of the [AI assistant's](/docs/ai-assistant) services, or a key and an address, such as `custom: { key, baseUrl: "https://ai.example/v1" }`. Editors see them as provided by the site. They can still use other services with keys of their own, unless the config's `ai.providers` leaves those out.

The server sends on only the requests the assistant makes, and only for people `authorize` lets in.

To keep the server's token away from the site's code, the content can be kept in a [repository of its own](/docs/content-repository#full-stack-nextjs-sites), with a token for that repository only.

## Plugins' routes

[Plugins](/docs/plugins#on-full-stack-sites-servers) with a server module answer at `/api/goodfellow/plugins/<id>/`. Import each server module in the API route and pass it to `goodfellowApi()` as `plugins: { "goodfellow-plugin-gallery": galleryServer }`. They're answered for anyone, as webhooks need, and told who's signed in only for requests from the site's own pages. A server module runs with everything the server has, so add only plugins you'd trust with its token.

Owners can choose plugins on the admin panel's Plugins screen too, but on a full-stack site installing, updating or removing one is submitted for review, as a pull request or merge request for a developer to accept, since the site's builds and server hold its secrets. Changes to `plugins/installed/` are refused from the admin panel otherwise. Once you've accepted one, add its server module to the API route if it has one.

## Safety

- The API answers people who aren't signed in only with where to sign in. Every request must come from the site's own pages: it carries a header that browsers don't send to another site without asking it first, and requests that say they come from another site are refused.
- It reads and writes only what the admin panel edits: `content/`, `public/media/` and installed blocks' code.
- Errors from GitHub, GitLab or Bitbucket stay on the server, which reports them with `console.error`, or `onError` if given. Editors see only that something went wrong.

## What's different

- **Search** finds the pages Next.js renders while building, which is all of the site's pages. A page made later is found once the site is rebuilt, which publishing does anyway.
- **Fonts** load from Google Fonts, as in `next dev`: `goodfellow-next finish --server` can't change the pages Next.js serves, so it doesn't copy them into the site as exports do.
- **Uploads** go through the server. Some hosts limit what a request can send, such as Vercel's functions, at 4.5 MB, so larger uploads fail there.
- **Screens for the git host:** the Editors, Domain and Updates screens aren't shown, since the app manages its own people and its host its own domain. A full-stack site can't have an [admin address](/docs/custom-domains#an-admin-address): its admin panel signs in with the app's own sign-in, and `withGoodfellow()` and `goodfellow-next finish --server` refuse a config that names one. `goodfellow-next update` still updates the site from a computer.
