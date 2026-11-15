---
"@goodfellow-cms/core": minor
"create-goodfellow": patch
---

Goodfellow's setup page creates full-stack sites on a page of its own, `/new-site/full-stack/`, which the static sites' page links to: it creates the code and content repositories on GitHub from the company example, connects them, and lists what's left on GitHub and Cloudflare. Core's `newSetupCode()` and `setupCodeHash()` make the site's setup code, whose SHA-256 alone `planServerSite()` writes into `wrangler.jsonc` (`setupCodeHash`), and `madeBy: "page"` says in the README that the setup page made the site.

The company example, which `--server cloudflare` starts from, makes its first admin at `/setup/` with that code, once, while it has no admin. Its new **Set up Cloudflare** workflow makes the D1 database and KV namespace, names them in `wrangler.jsonc`, gives a site without an address of its own the Worker's on workers.dev, and starts the Deploy workflow. Deploy skips itself until they're named, gives the Worker `BETTER_AUTH_SECRET` and `GOODFELLOW_GIT_TOKEN` from the repository's secrets, and makes a session key on the first deploy where the Worker has none. The content repository's workflow says, rather than fails, until its token is added.
