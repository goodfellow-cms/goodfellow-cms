---
"@goodfellow-cms/core": patch
"@goodfellow-cms/next": patch
"create-goodfellow": patch
---

Full-stack Next.js sites (`withGoodfellow(config, { server: true })`) serve their Google Fonts themselves, as static exports do. `next build` copies them into `public/fonts/google/` before it renders any page, so pages rendered while it builds and while the site runs both point at the copies, and visitors' browsers never ask Google for them. Where Google can't be reached while building, the build says so and pages load the fonts from Google. New sites' `.gitignore` leaves out `public/fonts/google/`.
