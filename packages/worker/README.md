# @goodfellow-cms/worker

Goodfellow's sign-in service: a Cloudflare Worker that lets editors **Sign in with GitHub**, and gives the admin panel a token for the site's repository only, lasting an hour. It stores nothing about anyone's sign-in: editors' own GitHub tokens are revoked as soon as they've signed in.

Goodfellow runs it for every site, at `https://sign-in.goodfellow-cms.workers.dev`. Sites keep working without it: editors can always sign in with a token. It isn't published to npm.

See the documentation's [Sign-in service](https://goodfellow-cms.github.io/goodfellow-cms/docs/sign-in-service) page for how it works, its limits, and running your own copy with your own GitHub Apps:

```sh
pnpm install
cd packages/worker
pnpm run deploy                          # prints its address, for the GitHub Apps' callback URL
npx wrangler@4 secret put SESSION_KEY    # then the apps' secrets
pnpm run deploy
```

`pnpm test` runs it against a fake GitHub (`@goodfellow-cms/github/testing`), including the admin panel's sign-in through it.

## License

MIT
