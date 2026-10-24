---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
"goodfellow": minor
"@goodfellow-cms/next": minor
"create-goodfellow": minor
---

Sites whose content is kept in a repository of their own can have an admin address. The Domain screen connects it and shows what a developer runs: `goodfellow admin add` names it in the code's `goodfellow.config.tsx`, and `goodfellow admin check` checks it from a computer, as the Domain screen does from the address, then marks it checked (`goodfellow-next admin` for Next.js sites, which also get `goodfellow-next broker use` and `remove`). Where Vercel builds the site from the content repository, the address's header rules are written into its `vercel.ts`. `create-goodfellow --admin` and the setup page offer an admin address with a content repository too.
