---
"@goodfellow-cms/admin": patch
"@goodfellow-cms/ai": patch
"@goodfellow-cms/blocks": patch
"@goodfellow-cms/core": patch
"@goodfellow-cms/github": patch
"@goodfellow-cms/gitlab": patch
"@goodfellow-cms/mcp": patch
"@goodfellow-cms/next": patch
"@goodfellow-cms/react": patch
"@goodfellow-cms/registry": patch
"create-goodfellow": patch
"goodfellow": patch
---

Goodfellow needs Node.js 22.23.4, 24.22.1 or 26.12.1 or later. Earlier versions decompress Brotli unsafely (CVE-2026-111497, "Node2Shell"). Builds read other sites, such as Calendar blocks' feeds, so a feed's server could run code on the computer building the site. New sites' GitHub workflows (`deploy.yml`, `scheduled.yml`) set up Node with `check-latest: true`, so they always get the newest Node 22 instead of an older copy on GitHub's runner. To do the same on an existing site, add `check-latest: true` under `node-version: 22` in each `actions/setup-node` step of its `.github/workflows/` files. GitLab's `node:22` image already has the fix. On Cloudflare Pages and Vercel, check the Node.js version in the project's build settings.
