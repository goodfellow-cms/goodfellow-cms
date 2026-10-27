# @goodfellow-cms/mcp

Work on a [Goodfellow](https://goodfellow-cms.github.io/goodfellow-cms/) site from Claude. An [MCP](https://modelcontextprotocol.io) server with Goodfellow's tools: Claude reads a site's pages, items and settings, sees what blocks it has, makes changes in a draft, takes screenshots, and publishes the draft or submits it for review.

See [Work with Claude](https://goodfellow-cms.github.io/goodfellow-cms/docs/claude) for setting it up. This package runs the tools on your own computer, signed in with GitHub, GitLab or Bitbucket tokens that stay there, for as many sites as you like, including sites in folders on your computer.

## Claude Code

```sh
claude mcp add goodfellow --env GOODFELLOW_SITE="github:your-name/your-site, gitlab:your-group/other-site" --env GOODFELLOW_GITHUB_TOKEN=your-github-token --env GOODFELLOW_GITLAB_TOKEN=your-gitlab-token -- npx -y @goodfellow-cms/mcp
```

- `GOODFELLOW_SITE`: the sites, separated by commas or new lines: `github:owner/name`, `gitlab:group/name`, `bitbucket:workspace/name`, or a folder's full path (`local:` in front is optional), with `@` and its development server's address after it if that isn't `http://localhost:4321` or `http://localhost:3000`. Sites can be given as arguments too.
- `GOODFELLOW_GITHUB_TOKEN`, `GOODFELLOW_GITLAB_TOKEN`, `GOODFELLOW_BITBUCKET_TOKEN`: a token for each host, which can change the sites' files and open pull requests or merge requests. `GOODFELLOW_TOKEN` is used for any host without one of its own.
- `GITLAB_URL`: for a GitLab of your own.
- `GOODFELLOW_BROWSER`: a Chromium-based browser for screenshots, if not Google Chrome or Microsoft Edge.

## Claude Desktop

Install the [Goodfellow extension](https://goodfellow-cms.github.io/goodfellow-cms/goodfellow.mcpb), which `pnpm pack-extension` builds from this package; [Work with Claude](https://goodfellow-cms.github.io/goodfellow-cms/docs/claude#2-add-goodfellow-to-claude) goes through it step by step.

## In your own server

`createGoodfellowServer()` gives an `McpServer` with the tools, for any transport:

```ts
import { createGoodfellowServer } from "@goodfellow-cms/mcp";

const server = createGoodfellowServer({
  sites: async () => [{ id: "github:your-name/your-site" }],
  backend: async (site) => signInSomehow(site), // a GitBackend from @goodfellow-cms/github, gitlab or bitbucket
});
```

The Claude connector service (`packages/connector` in the repository) is built this way.

## License

MIT
