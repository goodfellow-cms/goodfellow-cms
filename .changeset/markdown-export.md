---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
"goodfellow": minor
"@goodfellow-cms/next": minor
---

Export a site as a folder of Markdown files, for Hugo, Jekyll, Eleventy, Astro, notes apps and AI tools: each page and collection item at its address with YAML front matter, the media library and the menus. Site Settings → Import has **Export as Markdown**, which downloads a zip, and `goodfellow export markdown` and `goodfellow-next export markdown` write a folder. Links keep the site's addresses, or link to the files with `--links files`. Layout, the header and footer, and blocks Markdown can't hold, such as forms and calendars, are left out and listed. The WordPress export now gives images without alt text of their own the media library's description.
