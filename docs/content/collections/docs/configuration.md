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
| `claude` | What Claude can do through the Claude connector: `{ publish: false }` stops it publishing, so it can only submit its changes for review. It takes effect once the site has been rebuilt. See [Work with Claude](/docs/claude#turning-off-publishing). |
| `demo` | `true` makes the admin panel a [demo](/docs/demo-mode) anyone can try. |

## GitHub

```tsx
github({ repo: "owner/name", branch: "main" })
```

- `repo`: the repository, as `owner/name`.
- `branch`: the branch the live site is built from. Defaults to the repository's default branch.
- `signIn`: the [sign-in service](/docs/sign-in-service) for **Sign in with GitHub**. Defaults to Goodfellow's; give your own copy's address, or `false` for signing in with tokens only.
- `apiUrl`, `webUrl`: for GitHub Enterprise.

## GitLab

```tsx
gitlab({ project: "group/site", clientId: "…" })
```

- `project`: the project's path, such as `group/site` or `group/subgroup/site`.
- `clientId`: the Application ID of the site's OAuth application, for one-click **Sign in with GitLab**. Without it, editors sign in with a token.
- `branch`: the branch the live site is built from.
- `url`: for self-managed GitLab. Defaults to `https://gitlab.com`.

## AI services

`ai.providers` takes these ids: `anthropic`, `openai`, `gemini`, `groq`, `mistral`, `openrouter`, `ovhcloud`, `custom` (any OpenAI-compatible service) and `manual` (copying the request into a chat app).
