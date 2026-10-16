---
"@goodfellow-cms/core": minor
"@goodfellow-cms/github": minor
"@goodfellow-cms/gitlab": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/next": minor
"goodfellow": minor
"create-goodfellow": minor
---

A site's content can be kept in a repository of its own (roadmap step 25), so editors' sign-in, publishing and a full-stack site's server can change the content but never the code.

- `github({ repo, contentOnly: true })` and `gitlab({ project, contentOnly: true })` point the admin panel at a repository that holds only `content/` and `public/media/`. Backends refuse to write anything else (`CodeChangeError`), and so does a full-stack site's API. The admin panel has no Blocks screen there, since adding a block changes the code, and its Updates screen says updates run where the code is.
- `goodfellow content link` and `goodfellow-next content link` link `content/` and `public/media/` to the content repository in `content-repository/`, so `goodfellow dev` and `next dev` read and save its files; `content copy` copies them instead, as builds do. The dev servers and builds say what to run when the content hasn't been put in place.
- `npm create goodfellow` asks where the content should be kept, or takes `--content your-name/your-site-content` and, on Vercel, `--build content|code`. It makes both repositories, with setup files for each: GitHub Pages and GitLab Pages build the site from the content repository, which checks out the code, while the code's repository runs the nightly update and asks for a rebuild after each change to the code; Vercel builds from either.
- The Next.js starter's GitHub Pages and GitLab Pages setups now build with `npm run build`, so they run `goodfellow-next finish out` too, which writes the search index, calendar files and redirect pages.
