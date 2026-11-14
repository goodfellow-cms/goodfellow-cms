# create-goodfellow

Creates a new Goodfellow site from a starter, the parish example, or the Next.js starter, and sets up where it's stored and where it's put online. It can start the site with a WordPress site's content.

```sh
npm create goodfellow@latest my-site
npm create goodfellow@latest my-site -- --template parish --host github-pages
npm create goodfellow@latest my-site -- --wordpress wordpress-export.xml
npm create goodfellow@latest my-site -- --gitlab my-group/my-site --host gitlab-pages --broker gitlab-pages
npm create goodfellow@latest my-site -- --bitbucket my-workspace/my-site
```

`--server cloudflare` makes a full-stack site instead, from Goodfellow's company example: editors sign in with the site's own accounts, on a Cloudflare Worker with a D1 database, its code and content in GitHub repositories of their own (`--github`, `--content`, and `--url` for its address). In a terminal, it then offers to put the site online with wrangler, asking before each step. See [Full-stack sites on Cloudflare](https://goodfellowcms.com/docs/full-stack-cloudflare).

It asks where editors sign in: in the admin panel at the site's address, at an admin address of its own (`--admin`), or at a sign-in page of its own, a token broker (`--broker`), which it writes into a folder beside the site's.

[Goodfellow](https://github.com/goodfellow-cms/goodfellow-cms) is a website builder for people who aren't developers, with no server or database: pages are files in your own GitHub, GitLab, or Bitbucket repository, edited in a visual editor built on [Puck](https://puckeditor.com). To start a new site, run `npm create goodfellow@latest my-site`. See the [documentation](https://goodfellowcms.com/) for everything else.

More in the docs: [Create a site](https://goodfellowcms.com/docs/create-a-site).

## License

MIT
