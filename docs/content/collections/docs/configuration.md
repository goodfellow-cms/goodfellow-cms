---
version: 1
title: Configuration
description: Every option in goodfellow.config.tsx, which both the site and its admin panel import.
section: developers
order: 1
---

A site's `goodfellow.config.tsx` says which blocks it has and where it's stored. The site's pages and its admin panel import the same file, so the editor always offers exactly the blocks the site renders.

```tsx
import { blocks, categories } from "@goodfellow-cms/blocks";
import { defineConfig } from "@goodfellow-cms/core";
import { github } from "@goodfellow-cms/github";
import { installedBlocks, installedCategories } from "./blocks/installed";
import { MassTimes } from "./blocks/mass-times";

export default defineConfig({
  blocks: { ...blocks, ...installedBlocks, MassTimes },
  categories: { ...categories, ...installedCategories, parish: { title: "Parish", components: ["MassTimes"] } },
  backend: github({ repo: "your-name/your-site" }),
});
```

## Options

| Option | What it does |
|---|---|
| `blocks` | The blocks the editor offers, keyed by the name content files store. Never rename a key once pages use it. |
| `categories` | Groups for the editor's block list, as in Puck: `{ id: { title, components } }`. |
| `backend` | Where the site is stored: `github({ … })` or `gitlab({ … })`. Builds include the admin panel at `/admin` only when this or `demo` is set. |
| `base` | The address the site is served from, for hosts that use a subfolder, such as `/my-repo/`. Defaults to `/`. See [Commands](/docs/commands). |
| `styles` | The site's stylesheet. Defaults to `src/styles.css`. |
| `ai` | The AI assistant: `false` removes it, `{ providers: ["anthropic", "manual"] }` limits the services offered, and `{ stockPhotos: false }` stops it finding photos on Openverse. |
| `registries` | Block registries the Blocks screen offers blocks from, besides Goodfellow's: `{ "@acme": "https://acme.example/r/{name}.json" }`. List only registries you trust; see [Block registries](/docs/block-registries). |
| `broker` | The site's [token broker](/docs/token-broker), `{ url: "https://broker.example.org" }`, a sign-in page on an address of its own that keeps editors' tokens and AI keys and shows the admin panel in a frame. Site Settings' Security tab writes it. Editors then sign in only there. |
| `admin` | The admin panel's own address, `{ url: "https://admin.example.org", checked: true }`, which the Domain screen writes (see [An admin address](/docs/custom-domains#an-admin-address)). With `url`, builds start every page with a script that sends it to the Site address when it's opened at the admin address, and fail if a page can't start with it, such as one with a script or an event handler before it; with `checked`, the admin panel opens only there. Not for full-stack Next.js sites. |
| `claude` | What Claude can do through the Claude connector: `{ publish: false }` stops it publishing, so it can only submit its changes for review. It takes effect once the site has been rebuilt. See [Work with Claude](/docs/claude#turning-off-publishing). |
| `demo` | `true` makes the admin panel a [demo](/docs/demo-mode) anyone can try. |
| `plugins` | [Plugins](/docs/plugins), such as `[...installedPlugins, s3({ … })]`, where `installedPlugins` (from `./plugins/installed`) lists those installed from the admin panel, which add screens and code in the admin panel, steps in the build and routes on full-stack sites' servers, as well as blocks, which are added to `blocks`. Each gets only the permissions it declares, where Goodfellow can enforce them. |

## GitHub

```tsx
github({ repo: "owner/name", branch: "main" })
```

- `repo`: the repository, as `owner/name`.
- `branch`: the branch the live site is built from. Defaults to the repository's default branch.
- `signIn`: the address of a [sign-in service](/docs/sign-in-service) you run, for **Sign in with GitHub**. Without it, editors sign in with tokens.
- `contentOnly`: `true` where the repository holds only the site's content, with its code in a repository of its own (see [Content in a repository of its own](/docs/content-repository)).
- `code`: with `contentOnly`, the code's repository, as `owner/name`, whose updates the Updates screen follows.
- `apiUrl`, `webUrl`: for GitHub Enterprise.

## GitLab

```tsx
gitlab({ project: "group/site", clientId: "…" })
```

- `project`: the project's path, such as `group/site` or `group/subgroup/site`.
- `clientId`: the Application ID of the site's OAuth application, for one-click **Sign in with GitLab**. Without it, editors sign in with a token.
- `branch`: the branch the live site is built from.
- `contentOnly` and `code`: as for GitHub, with the code project's path.
- `url`: for self-managed GitLab. Defaults to `https://gitlab.com`.

## Bitbucket

```tsx
bitbucket({ repo: "workspace/site", clientId: "…" })
```

- `repo`: the repository, as `workspace/name`.
- `clientId`: the Key of the workspace's OAuth consumer, for one-click **Sign in with Bitbucket**. Without it, editors sign in with a token.
- `branch`: the branch the live site is built from.

Bitbucket Cloud only; content kept in a repository of its own isn't offered on Bitbucket yet.

## AI services

`ai.providers` takes these ids: `anthropic`, `openai`, `gemini`, `groq`, `mistral`, `openrouter`, `ovhcloud`, `custom` (any OpenAI-compatible service) and `manual` (copying the request into a chat app).
