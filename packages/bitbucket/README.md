# @goodfellow-cms/bitbucket

Edit a Goodfellow site stored on Bitbucket Cloud, straight from the browser: sign-in with an access token, an API token or Bitbucket's own sign-in, publishing as single commits, conflict checks, drafts and pull requests, the nightly update, scheduled changes that go live at their time, and plugins' tasks through Bitbucket Pipelines, and content kept in a repository of its own (`contentOnly` and `code`).

```tsx
import { bitbucket } from "@goodfellow-cms/bitbucket";

export default defineConfig({ blocks, backend: bitbucket({ repo: "your-workspace/your-site" }) });
```

Bitbucket's own static websites have one address for each workspace and no custom domains, so sites stored on Bitbucket are built and put online by Vercel. `npm create goodfellow@latest my-site -- --bitbucket your-workspace/your-site` sets one up, with its `bitbucket-pipelines.yml`.

[Goodfellow](https://github.com/goodfellow-cms/goodfellow-cms) is a website builder for people who aren't developers, with no server or database: pages are files in your own GitHub, GitLab or Bitbucket repository, edited in a visual editor built on [Puck](https://puckeditor.com). To start a new site, run `npm create goodfellow@latest my-site`. See the [documentation](https://goodfellow-cms.github.io/goodfellow-cms/) for everything else.

More in the docs: [Sign-in](https://goodfellow-cms.github.io/goodfellow-cms/docs/sign-in) and [Hosts and business sites](https://goodfellow-cms.github.io/goodfellow-cms/docs/hosts).

## License

MIT
