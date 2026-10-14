# @goodfellow-cms/connector

Goodfellow's Claude connector: a Cloudflare Worker that's an MCP server with Goodfellow's tools (`@goodfellow-cms/mcp`), and the OAuth server Claude signs in with, through the Goodfellow for Claude GitHub App or a GitLab application. Editors add it to Claude as a custom connector. It keeps who connected and which sites only sealed in Claude's own tokens, and stores just each connection's refresh token generation, in D1.

Goodfellow runs it at `https://claude.goodfellow-cms.workers.dev/mcp`. It isn't published to npm.

See the documentation's [Claude connector service](https://goodfellow-cms.github.io/goodfellow-cms/docs/claude-connector) page for how it works, its limits, and running your own copy:

```sh
pnpm install
cd packages/connector
pnpm run setup    # creates its database, deploys it, creates the GitHub App, sets its secrets and deploys it again
```

`scripts/setup.mjs` creates the app with GitHub's app manifest flow, from a page it serves on 127.0.0.1, and gives its keys to Wrangler through its standard input, so they're never printed or written to disk. Its parts that don't touch the computer are in `src/setup.ts`.

`pnpm test` runs it against fakes of GitHub and GitLab (`@goodfellow-cms/github/testing`, `@goodfellow-cms/gitlab/testing`), as Claude would, from registering to calling tools.

## License

MIT
