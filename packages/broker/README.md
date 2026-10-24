# @goodfellow-cms/broker

Goodfellow's token broker: a small static page, on an address of its own, where editors sign in. It keeps their GitHub or GitLab sign-in and AI keys in its own storage, shows the site's admin panel in a frame, and makes every call to the git host and AI services for it, so nothing on the site's own address can read them. It asks the editor, outside the admin panel's frame, before publishing the site's code, and never changes its workflows.

The package is the built page, in `site/`, with `site/files.json` listing its files. The quickest way to run one is **Site Settings → Security → Add a token broker** in the site's admin panel, or `npx goodfellow broker add` in the site's folder, which make its repository from this page. By hand, copy `site/` into a repository of its own, add a `broker.json` naming the site (see `site/broker.example.json`), put it online at an address that serves nothing else, and set that address in the site's admin panel, under **Site Settings → Security**.

[Goodfellow](https://github.com/goodfellow-cms/goodfellow-cms) is a website builder for people who aren't developers, with no server or database: pages are files in your own GitHub or GitLab repository, edited in a visual editor built on [Puck](https://puckeditor.com). To start a new site, run `npm create goodfellow@latest my-site`. See the [documentation](https://goodfellow-cms.github.io/goodfellow-cms/) for everything else.

More in the docs: [Token broker](https://goodfellow-cms.github.io/goodfellow-cms/docs/token-broker).

## License

MIT
