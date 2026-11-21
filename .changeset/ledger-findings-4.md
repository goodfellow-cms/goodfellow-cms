---
"@goodfellow-cms/core": patch
"goodfellow": patch
"@goodfellow-cms/next": patch
---

The editor's and plugins' frames' folders hold only their pages, scripts, styles, fonts, and pictures that aren't SVGs: a build stops, naming the file, where a block's or plugin's code brings a page or an SVG as a file (such as `import help from "./help.html?url"`), which could open as a page at the admin panel's address, and the header rules builds write for Cloudflare Pages, Netlify, and Vercel sandbox both folders (`sandbox allow-scripts`), as the admin panel frames them. `goodfellow dev` and `next dev` don't serve what a stopped build left there. Sites with their own `vercel.ts` from the starter can copy its frames' rule. A build with an admin address also stops at a file that starts as markup in UTF-16 or UTF-32, and a theme's install screen lists a header's or footer's picture from another site however its address is spelled, such as `\\tracker.example/p`.
