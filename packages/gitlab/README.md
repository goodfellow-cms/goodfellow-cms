# @goodfellow-cms/gitlab

Edit a Goodfellow site stored on GitLab, straight from the browser: sign-in with an access token, publishing as single commits, conflict checks and deploy status.

```tsx
import { gitlab } from "@goodfellow-cms/gitlab";

export default defineConfig({ blocks, backend: gitlab({ project: "your-name/your-site" }) });
```

[Goodfellow](https://github.com/goodfellow-cms/goodfellow-cms) is a website builder for people who aren't developers, with no server or database: pages are files in your own GitHub, GitLab or Bitbucket repository, edited in a visual editor built on [Puck](https://puckeditor.com). To start a new site, run `npm create goodfellow@latest my-site`. See the [documentation](https://goodfellow-cms.github.io/goodfellow-cms/) for everything else.

More in the docs: [Hosts and business sites](https://goodfellow-cms.github.io/goodfellow-cms/docs/hosts).

## License

MIT
