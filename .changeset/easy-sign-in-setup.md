---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
"goodfellow": minor
"@goodfellow-cms/next": minor
"create-goodfellow": minor
---

Setting up one-click sign-in no longer needs a developer.

- **Sign in with GitHub:** the sign-in service is put online from the browser, with Cloudflare's Deploy to Cloudflare button. The deployed service's own setup page, at `/setup`, takes a Cloudflare API token once, made from a link that fills it in, with the sites' addresses. It saves its settings in Cloudflare and makes its two GitHub Apps with the owner, never keeping the token. Copies update themselves each week from create-goodfellow on npm, which now carries the service as `templates/sign-in/`.
- **Naming the service:** Site Settings → Security has a **Sign in with GitHub** section. It checks the service is set up and publishes its address in the site's config.
- **GitLab and Bitbucket:** the same section walks owners through GitLab's application form or Bitbucket's consumer form, with every value to copy. It then publishes the Application ID or the consumer's Key.
- **Content repositories:** for sites whose content is kept in a repository of its own, `goodfellow sign-in service <address>`, `goodfellow sign-in client-id <id>` and `goodfellow sign-in remove` do the same, with `goodfellow-next sign-in` for Next.js sites.
