# @goodfellow-cms/worker

Goodfellow's sign-in service: a Cloudflare Worker that lets editors **Sign in with GitHub**, and gives the admin panel a token for the site's repository only, lasting an hour. The editor's own GitHub token stays sealed inside a session only the worker can read.

Goodfellow runs it for every site, at `https://sign-in.goodfellow-cms.workers.dev`. Sites keep working without it: editors can always sign in with a token. It isn't published to npm.

See the documentation's [Sign-in service](https://goodfellow-cms.github.io/goodfellow-cms/docs/sign-in-service) page for how it works, its limits, and running your own copy with your own GitHub Apps:

```sh
pnpm install
cd packages/worker
npx wrangler@4 secret put SESSION_KEY   # and the apps' secrets
pnpm run deploy
```

`pnpm test` runs it against a fake GitHub (`@goodfellow-cms/github/testing`), including the admin panel's sign-in through it.

## License

MIT
