---
"@goodfellow-cms/core": minor
"@goodfellow-cms/github": minor
"@goodfellow-cms/gitlab": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/broker": minor
"goodfellow": minor
"create-goodfellow": minor
---

Add a token broker from the admin panel: Site Settings' Security tab makes the broker's repository from Goodfellow's released page, with a token that can create repositories, and puts it online with GitHub Pages (at a domain of its own) or GitLab Pages (at the project's unique domain), or leaves it ready for Cloudflare Pages or Vercel. `goodfellow broker add`, `use` and `remove` do the same from a computer. `create-goodfellow` (`--admin`, `--broker`, `--broker-domain`) and the setup page offer an admin address or a sign-in page of its own for new sites. The docs have a new Security page.
