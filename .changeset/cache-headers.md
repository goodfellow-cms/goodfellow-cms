---
"@goodfellow-cms/core": patch
"create-goodfellow": patch
---

Sites on Cloudflare Pages, Netlify and Vercel now have browsers keep files named by what's in them for a year (`Cache-Control: public, max-age=31536000, immutable`): the build's CSS and JavaScript in `/assets/` (or Next.js's `/_next/static/` on Cloudflare Pages and Netlify, since Vercel caches those itself), and the Google Fonts it copies into `/fonts/google/`. The media library's files, uploaded fonts included, aren't cached that long, since they keep their names when they're replaced, and nor is `/assets/` on a site that keeps a folder of that name in `public/`. Cloudflare Pages and Netlify sites get the rules on their next build; static sites on Vercel get them in new sites' `vercel.ts`, which older sites can copy from the starter.
