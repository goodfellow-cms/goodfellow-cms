# @goodfellow-cms/admin

The admin panel: the visual editor for a site's pages, collections, media, header and footer, and settings, which publishes to the site's repository from the browser.

Its editor is built with each site's own config, so it always has the site's blocks, and runs them in frames sandboxed away from the admin panel's page, which signs in and publishes: `goodfellow build` adds the page at `/admin` and the editor at `/admin/editor/`, and Next.js sites render `GoodfellowAdmin` and `GoodfellowEditor` from `@goodfellow-cms/next` there.

[Goodfellow](https://github.com/goodfellow-cms/goodfellow-cms) is a website builder for people who aren't developers, with no server or database: pages are files in your own GitHub, GitLab or Bitbucket repository, edited in a visual editor built on [Puck](https://puckeditor.com). To start a new site, run `npm create goodfellow@latest my-site`. See the [documentation](https://goodfellow-cms.github.io/goodfellow-cms/) for everything else.

More in the docs: [Edit pages](https://goodfellow-cms.github.io/goodfellow-cms/docs/edit-pages).

## License

MIT
