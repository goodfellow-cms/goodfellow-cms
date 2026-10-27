# goodfellow

The `goodfellow` command: builds a site into static files, runs the development server with the admin panel at `/admin`, previews a build, and moves sites from and to WordPress.

```sh
npx goodfellow dev       # http://localhost:4321, admin panel at /admin
npx goodfellow build     # writes the site to dist/
npx goodfellow preview   # serves dist/
npx goodfellow import wordpress export.xml   # brings a WordPress site's pages, posts and media in
npx goodfellow export wordpress              # writes the site as a WordPress export file
npx goodfellow broker add --host gitlab-pages # writes the site's token broker beside it
npx goodfellow admin check  # checks the admin address named with goodfellow admin add, then uses it
npx goodfellow blocks add button  # makes a block of a shadcn component, with fields from its props
```

[Goodfellow](https://github.com/goodfellow-cms/goodfellow-cms) is a website builder for people who aren't developers, with no server or database: pages are files in your own GitHub, GitLab or Bitbucket repository, edited in a visual editor built on [Puck](https://puckeditor.com). To start a new site, run `npm create goodfellow@latest my-site`. See the [documentation](https://goodfellow-cms.github.io/goodfellow-cms/) for everything else.

More in the docs: [Commands](https://goodfellow-cms.github.io/goodfellow-cms/docs/commands).

## License

MIT
