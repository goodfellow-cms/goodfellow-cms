---
version: 1
title: Full-stack Next.js sites
description: Goodfellow as the CMS of a Next.js app with a server of its own, where editors sign in with the app's own sign-in and its server publishes for them.
section: developers
order: 7
---

Goodfellow sites are static files by default, and nothing on this page is needed for them. For an organization with a developer and a [Next.js](/docs/nextjs) app that has a server of its own, Goodfellow can be the app's CMS, beside the app's own pages:

- Editors sign in to the admin panel with the app's own sign-in, such as [Better Auth](https://www.better-auth.com), and the app says who may edit and who may change settings.
- The app's server reads and publishes through GitHub or GitLab with one token, from an environment variable, which never reaches a browser. What each editor publishes still names them as its author.
- Optionally, the AI assistant asks AI services through the server, with keys in environment variables, so editors don't need keys of their own.

The content still lives in the site's repository, so the site is still rebuilt when something is published, as hosts that run Next.js do on every change to the repository. `next dev` still saves to the files on disk.

## Setting it up

1. In `goodfellow.config.tsx`, say where the site is stored, as for any site: `backend: github({ repo: "your-name/your-site" })` or `backend: gitlab({ project: "your-group/your-site" })`.

2. In `next.config.ts`, build it for a server rather than as static files:

   ```ts
   export default withGoodfellow({ agentRules: false }, { server: true });
   ```

   The build script is then `next build && goodfellow-next finish --server`, which writes the [search](/docs/search) index into `public/pagefind/` (leave that folder out of the repository). Calendar files and redirects come from the server, so there's nothing else to finish.

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
   <GoodfellowAdmin config={config} server="/api/goodfellow" />
   ```

5. If the site has [collections of events](/docs/calendars), serve their calendar files at `app/calendars/[...path]/route.ts`:

   ```ts
   import { goodfellowCalendars } from "@goodfellow-cms/next/server";

   export const GET = goodfellowCalendars();
   ```

6. Give the server its token as `GOODFELLOW_GIT_TOKEN` in the host's environment variables:

   - **GitHub:** a fine-grained token for the site's repository only, with Contents read and write, and Deployments and Actions read, which the admin panel uses to say when a change is live and why a rebuild failed. Make it from an account kept for the site, such as a machine user, rather than a person's own.
   - **GitLab:** a project access token with the Developer role (Maintainer if the main branch only lets Maintainers push) and the `api` scope.

## Who may do what

`authorize` is asked on every request, so taking someone's access away in the app takes effect at once. It gives each editor one of two roles:

| Role | May |
|---|---|
| `editor` | Edit and publish pages, collections' items, media, menus, and the header and footer |
| `owner` | Also change Site Settings, redirects, collections' settings and templates, and blocks |

The admin panel hides what editors can't change, and the server refuses it whatever a browser sends. Moving a page doesn't offer an editor a redirect from its old address, since redirects are part of Site Settings.

Signing in and out stay the app's own: the admin panel sends people to `signIn`, and its Sign out button goes to `signOut`, if there is one.

## AI keys on the server

With `ai`, the AI assistant asks those services through the server, which adds its own key, so editors don't need keys of their own and never see the site's. Give a key for any of the [AI assistant's](/docs/ai-assistant) services, or a key and an address, such as `custom: { key, baseUrl: "https://ai.example/v1" }`. Editors see them as provided by the site. They can still use other services with keys of their own, unless the config's `ai.providers` leaves those out.

The server sends on only the requests the assistant makes, and only for people `authorize` lets in.

## Safety

- The API answers people who aren't signed in only with where to sign in. Every request must come from the site's own pages: it carries a header that browsers don't send to another site without asking it first, and requests that say they come from another site are refused.
- It reads and writes only what the admin panel edits: `content/`, `public/media/` and installed blocks' code.
- Errors from GitHub or GitLab stay on the server, which reports them with `console.error`, or `onError` if given. Editors see only that something went wrong.

## What's different

- **Search** finds the pages Next.js renders while building, which is all of the site's pages. A page made later is found once the site is rebuilt, which publishing does anyway.
- **Uploads** go through the server. Some hosts limit what a request can send, such as Vercel's functions, at 4.5 MB, so larger uploads fail there.
- **Screens for the git host:** the Editors, Domain and Updates screens aren't shown, since the app manages its own people and its host its own domain. `goodfellow-next update` still updates the site from a computer.
