---
version: 1
title: Demo mode
description: Let anyone try the admin panel without signing in, with their changes kept in their own browser.
section: owners
order: 3
---

To let anyone try the admin panel without signing in, for example from a product page or in a training session, set `demo: true` in `goodfellow.config.tsx`. [Goodfellow's own demo](https://goodfellow-cms.github.io/goodfellow-cms/demo/admin/) is one: the parish example as `npm create goodfellow` makes it, with the recommended blocks and the [Gutenberg plugin](https://github.com/goodfellow-cms/goodfellow-plugin-gutenberg), which edits pages in WordPress's block editor, rebuilt with the documentation every night and with each release.

```tsx
export default defineConfig({ blocks, demo: true });
```

The site's `/admin` then opens straight away, with a banner saying it's a demo. Visitors can try everything editors can: pages, collections, the header and footer, the media library, site settings and the AI assistant (with their own key or a free service).

- **Nothing is published.** Publish saves the changes, uploads included, in the visitor's own browser, so they're still there after reloading. **Start over** in the banner undoes them all.
- **Changes show only in the admin panel.** Its editors and previews show what the visitor changed, but the site's pages are the files the last build made, so **View site** shows the site as it was built. The repository never changes either.
- **It starts from the site as last built.** The build puts a copy of the content at `/admin/demo-content.json`. The repository can stay private, and `backend` is ignored.
- **Blocks** can be browsed but not added or removed, since adding one changes the site's code.
- **Only the config turns it on.** The admin panel never changes `goodfellow.config.tsx`, so editors can't turn a real site into a demo or back.
- **In development**, the demo starts from the files on disk, and changes stay in the browser there too. To edit a demo site's own content in the admin panel, turn demo mode off while you do.

## Put a demo online

A demo is best kept as a site of its own, separate from any real site, so trying it never gets in the way of real content. To make one from the parish example and put it online with GitHub Pages, as Goodfellow's demo is:

1. Create the site, here in a folder called `goodfellow-demo`:

   ```sh
   npm create goodfellow@latest goodfellow-demo -- --template parish --host github-pages --yes
   ```

2. In `goodfellow-demo/goodfellow.config.tsx`, add `demo: true,` inside `defineConfig({ ... })`. It doesn't need a `backend`.
3. Try it on your computer:

   ```sh
   cd goodfellow-demo
   npm run build
   npm run preview
   ```

   The demo is at <http://localhost:4322/admin> (`npm run preview` prints the address), with the banner saying it's a demo.
4. Create an empty public repository on GitHub, such as `your-name/goodfellow-demo`, without a README. Then commit the change to the config and push the site to it:

   ```sh
   git commit -am "Turn on demo mode"
   git remote add origin https://github.com/your-name/goodfellow-demo.git
   git push -u origin main
   ```

   `npm create goodfellow` already ran `npm install` and made the folder a git repository on the branch `main`, with everything in its first commit.

5. In the repository on GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**. Then, under **Actions**, open **Deploy to GitHub Pages** and choose **Run workflow**, since its first run started before Pages was turned on.

The demo is then at `https://your-name.github.io/goodfellow-demo/admin/`, and the site itself at `https://your-name.github.io/goodfellow-demo/`. It rebuilds every night, so its dates stay current.

To change what the demo starts from, turn demo mode off on your computer, edit the content in the admin panel with `npm run dev`, turn it back on and push. To move it to a new release of Goodfellow, update its Goodfellow packages and push:

```sh
npm install @goodfellow-cms/admin@latest @goodfellow-cms/blocks@latest @goodfellow-cms/core@latest @goodfellow-cms/github@latest @goodfellow-cms/gitlab@latest @goodfellow-cms/react@latest goodfellow@latest
```
