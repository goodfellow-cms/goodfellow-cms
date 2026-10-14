# @goodfellow-cms/mcp

Work on a [Goodfellow](https://goodfellow-cms.github.io/goodfellow-cms/) site from Claude. An [MCP](https://modelcontextprotocol.io) server with Goodfellow's tools: Claude reads a site's pages, items and settings, sees what blocks it has, makes changes in a draft, takes screenshots, and publishes the draft or submits it for review.

Most editors use Goodfellow's hosted connector instead; see [Work with Claude](https://goodfellow-cms.github.io/goodfellow-cms/docs/claude). This package runs the same tools on your own computer, signed in with a GitHub or GitLab token that stays there.

## Claude Code

```sh
claude mcp add goodfellow --env GOODFELLOW_SITE=github:your-name/your-site --env GOODFELLOW_TOKEN=your-token -- npx -y @goodfellow-cms/mcp
```

- `GOODFELLOW_SITE`: the site's repository, `github:owner/name` or `gitlab:group/name`.
- `GOODFELLOW_TOKEN`: a token that can change the site's files and open pull requests or merge requests.
- `GITLAB_URL`: for a GitLab of your own.
- `GOODFELLOW_BROWSER`: a Chromium-based browser for screenshots, if not Google Chrome or Microsoft Edge.

## Claude Desktop

Install the [Goodfellow extension](https://goodfellow-cms.github.io/goodfellow-cms/goodfellow.mcpb), which `pnpm pack-extension` builds from this package.

## In your own server

`createGoodfellowServer()` gives an `McpServer` with the tools, for any transport:

```ts
import { createGoodfellowServer } from "@goodfellow-cms/mcp";

const server = createGoodfellowServer({
  sites: async () => [{ id: "github:your-name/your-site" }],
  backend: async (site) => signInSomehow(site), // a GitBackend from @goodfellow-cms/github or @goodfellow-cms/gitlab
});
```

Goodfellow's hosted connector (`packages/connector` in the repository) is built this way.

## License

MIT
