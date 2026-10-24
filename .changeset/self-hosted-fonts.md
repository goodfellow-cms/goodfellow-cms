---
"@goodfellow-cms/core": minor
"goodfellow": minor
"@goodfellow-cms/next": minor
---

Builds copy the site's Google Fonts into it: `goodfellow build` and `goodfellow-next finish` write them, with Google's stylesheet, into `fonts/google/`, and point every page at them, so visitors' browsers load them from the site without connecting to Google. Where Google can't be reached during the build, pages keep loading them from Google, and the build says so. For a site in a subfolder, such as `your-name.github.io/your-site/`, builds also say that search engines read `robots.txt` only at the domain's root, and how to have them find the sitemap.
