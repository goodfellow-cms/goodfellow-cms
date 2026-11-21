---
"@goodfellow-cms/core": minor
"@goodfellow-cms/blocks": minor
"@goodfellow-cms/expo": minor
"@goodfellow-cms/admin": minor
"goodfellow": minor
"@goodfellow-cms/next": minor
---

Sites can choose what searches them, on Site Settings' General tab (`content/site.json`'s `search.engine`): Pagefind on the website, as before and still the default; MiniSearch on the website and in apps, from one index, so both find the same pages for the same words; or Pagefind on the website and MiniSearch in apps. With MiniSearch, the Search block in Expo apps searches every page's words, offline too, where before it found pages by their titles only. MiniSearch's index is written for each language into `minisearch/` and, for apps, into the content API (each language's `search` in the manifest), with every file named by its hash, so the header rules builds write for Cloudflare Pages, Netlify, and Vercel let browsers keep them for a year. Sites with their own `vercel.ts` from the starter can copy its two new header rules, for `/minisearch/assets/` and `/api/search/`.
