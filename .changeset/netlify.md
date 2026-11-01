---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/github": minor
"create-goodfellow": minor
---

Netlify as a host, for sites on GitHub and GitLab: `create-goodfellow --host netlify` and the setup page write `netlify.toml` (which never builds drafts or plugins' tasks) and the nightly update and scheduled changes, which ask Netlify to rebuild through its build hook (`NETLIFY_BUILD_HOOK`). Builds on Netlify write header rules suited to it (`netlifySiteHeaders()`), an admin address works there with the guards alone, as on GitLab Pages, the Domain screen explains Netlify's domains, and the admin panel follows Netlify's deploys on GitHub.
