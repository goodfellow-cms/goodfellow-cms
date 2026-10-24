---
"@goodfellow-cms/core": minor
"@goodfellow-cms/github": minor
"@goodfellow-cms/next": minor
"goodfellow": minor
"create-goodfellow": minor
---

Safer builds on GitHub: every job in the starters' workflows, and in the ones new sites get, has only the permissions it needs. The jobs that run the site's code can only read the repository and keep no credentials in it, and the nightly update builds the site before a separate job, which runs none of its code, publishes it (`goodfellow update --commit`). Sites' `.npmrc` turns off packages' install scripts. The admin panel's page has a Content Security Policy that keeps its frames on the editor's pages. Existing sites can copy the starter's `.github/workflows/` and `.npmrc` to get the same.
