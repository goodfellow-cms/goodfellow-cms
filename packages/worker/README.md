# @goodfellow-cms/worker

Goodfellow's sign-in service, for sites to run: a Cloudflare Worker that lets editors **Sign in with GitHub**, and gives the admin panel a token for the site's repository only, lasting an hour. It stores nothing about anyone's sign-in: editors' own GitHub tokens are revoked as soon as they've signed in.

Goodfellow doesn't run it for everyone yet, and may in the future; a site uses it once its owner runs one and names it under Site Settings → Security, which writes `github({ signIn })`. Sites work without it: editors sign in with a token. It isn't published to npm.

Owners put it online from their browser with Cloudflare's Deploy to Cloudflare button, from [goodfellow-cms/goodfellow-sign-in](https://github.com/goodfellow-cms/goodfellow-sign-in), which holds `deploy/` and the worker bundled into one file (`pnpm build` writes `dist/bundle/worker.js`). The deployed worker's own page, `/setup` (`src/self-setup.ts`), takes a Cloudflare API token once and saves its settings and GitHub Apps' keys as its secrets, keeping nothing. Copies update themselves from create-goodfellow on npm, which carries the same files as `templates/sign-in/`.

See the documentation's [Sign-in service](https://goodfellow-cms.github.io/goodfellow-cms/docs/sign-in-service) page for how it works, its limits, and running it from a computer with your own GitHub Apps:

```sh
pnpm install
cd packages/worker
pnpm run setup    # deploys it, creates the GitHub Apps, sets its secrets and deploys it again
```

`scripts/setup.mjs` creates the apps with GitHub's app manifest flow, from a page it serves on 127.0.0.1, and gives their keys to Wrangler through its standard input, so they're never printed or written to disk. Its parts that don't touch the computer are in `src/setup.ts`.

`pnpm test` runs it against a fake GitHub (`@goodfellow-cms/github/testing`), including the admin panel's sign-in through it.

## License

MIT
