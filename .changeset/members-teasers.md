---
"@goodfellow-cms/core": minor
"@goodfellow-cms/next": minor
---

Full-stack sites can show a members-only page's teaser to everyone else, and the whole page to its members. `goodfellowPages(config, { paywall: "Paywall" })` names the site's block that ends a teaser: `Page` then shows everyone the blocks above a members-only page's first paywall, and the paywall, and the new `MembersPage` shows every page in full, for the route the site's own code sends members to, which builds every page with `generateStaticParams`. A page with no paywall block shows only one, so nothing an editor didn't choose to show is published, and pages shown in full leave their paywalls out. `teaserData()` and `withoutPaywall()` in `@goodfellow-cms/core`, and `shownPage()` in `@goodfellow-cms/next`, do the same for a site's own code. Members-only pages no longer carry structured data, whose description of an item is the start of its text, which would have been in the teaser.
