---
version: 1
title: Themes
description: Change the site's look with a theme from npm, keep your own changes when it updates, or publish a theme of your own.
section: owners
order: 4.5
---

A theme changes how a site looks: its colors, fonts and rounded corners, the classes it gives [blocks' parts](/docs/layout-and-settings#blocks-parts), some CSS, and sometimes a header and footer design. A theme is only settings and styles, with no code, so installing one runs nobody else's code on your site or in the admin panel.

Goodfellow has a theme of its own, [Harbor](https://github.com/goodfellow-cms/goodfellow-theme-harbor): deep harbor blue on warm sand, with a serif for headings, rounded cards and pill-shaped buttons, in light and dark. Search for it on the Themes screen.

## Install a theme

**Site Settings → Themes** lists the themes published on npm. Search them by name or description, then choose **Show** to see one:

- **What it is:** its description, a picture of a site with it if it has one, its colors, its version and when it was published, and who published it.
- **Where it came from:** a version built by GitHub Actions or GitLab CI with npm's provenance says which repository it was built from, which npm checked when it was published. A version without it may not come from its publisher's own code.
- **What it loads:** if the theme asks visitors' browsers for files from other sites, such as pictures or fonts in its CSS or its classes, they're listed before you install it, since those sites then learn who visits yours. Google Fonts and your own media library aren't listed.
- **Header and footer:** a theme with its own header and footer offers **Use the theme's header and footer**. They replace yours, but your menus, logo and contact details stay as they are, since the header's blocks read them from Site Settings. A theme's header and footer can only use built-in blocks that show text or your site's own settings, so they can't run anything on your site.
- **Preview:** your site as the theme would leave it, before anything is published. It starts on the home page, and **Page to look at** shows any other page, items' pages included.

**Install and publish** publishes the theme in one go, and the site shows it once it's rebuilt. The theme's colors, fonts and other settings go into **Colors & fonts**, its CSS goes at the start of **Custom CSS**, between two comments that mark it, and its header and footer, if you chose them, into **Header & Footer**. Change any of them afterwards like any other setting. Settings the theme doesn't give stay as they were.

A theme replaces the theme before it: settings the old theme gave and nobody changed go back to Goodfellow's defaults, and the old theme's CSS is removed. If you'd changed any of what it replaces, the Themes screen says so before you install it. [Site history](/docs/publishing#restoring-the-whole-site) can put the site back as it was before.

## Which versions are offered

- **Only themes:** the list shows only npm packages named `goodfellow-theme-<name>`, or `@someone/goodfellow-theme-<name>`, with the `goodfellow-theme` keyword.
- **A few days old:** a new version is offered once it's 3 days old, since most harmful versions of npm packages are found and removed by then. The Themes screen says when a newer one is waiting.
- **Made for your Goodfellow:** a version is offered only if it says it works with your site's version of Goodfellow. Versions its publisher marked as not to be used aren't offered.

## Updates

Themes never update by themselves, since a new version can change how your site looks. When a newer version of the installed theme can be installed, **Installed theme** says so and offers **See version …**, which shows the same preview of your site as the update would leave it, with nothing published until you choose **Update to …**. An update replaces only what nobody has changed since the version before: if you changed the main color, it stays yours while the theme's other colors update, and if you changed the theme's CSS, or its header or footer, they stay as you left them. The Themes screen lists what it keeps.

The [Updates](/docs/updates) screen also says when a newer release of Goodfellow is outside the releases your theme says it works with, so you can check for a newer version of the theme first.

## Remove a theme

**Remove** takes the theme away: its colors, fonts and other settings go back to Goodfellow's defaults, unless you changed them, and its CSS is removed. The header and footer stay as they are. If you'd changed the theme's CSS, removing it removes your changes too, and the Themes screen says so first.

## Publish a theme

A theme is an npm package. Keep each in a repository of its own, called `goodfellow-theme-<name>` with the `goodfellow-theme` topic on GitHub or GitLab, so people looking for themes find it.

The easiest start is a copy of [Harbor's repository](https://github.com/goodfellow-cms/goodfellow-theme-harbor), whose README goes through each of its files. It has everything below, a test that checks a theme as installing it would, and a workflow that publishes releases with provenance.

`package.json` names it and says which Goodfellow releases it works with, as a `peerDependencies` range on `@goodfellow-cms/core`. The admin panel offers a version only on releases in that range, and never offers a version without one.

```json
{
  "name": "goodfellow-theme-harbor",
  "version": "1.0.0",
  "description": "Deep harbor blue on warm sand, with rounded cards and pill-shaped buttons.",
  "keywords": ["goodfellow-theme"],
  "repository": { "type": "git", "url": "git+https://github.com/goodfellow-cms/goodfellow-theme-harbor.git" },
  "peerDependencies": { "@goodfellow-cms/core": ">=0.6.0 <1.0.0" },
  "files": ["goodfellow-theme.json", "theme.css", "header.json", "footer.json", "preview.png"]
}
```

`goodfellow-theme.json`, at the root of the package, says what the theme is and which of its files to install:

```json
{
  "version": 1,
  "title": "Harbor",
  "description": "Deep harbor blue on warm sand, with rounded cards and pill-shaped buttons.",
  "theme": {
    "colors": { "primary": "#1f4e6b", "primaryForeground": "#ffffff", "background": "#fbf8f3" },
    "darkColors": { "primary": "#86b8d6", "primaryForeground": "#0f1a24", "background": "#0f1a24" },
    "fonts": { "heading": "Newsreader", "headingCategory": "serif", "body": "Source Sans 3" },
    "radius": "0.625rem",
    "parts": { "gf-card": "rounded-xl shadow-sm", "gf-button": "rounded-full" }
  },
  "css": "theme.css",
  "header": "header.json",
  "footer": "footer.json",
  "image": "preview.png"
}
```

- **`theme`** has the same settings as `content/site.json`'s `theme` (see [Content files](/docs/content-files)): `colors`, `darkMode` and `darkColors`, `fonts` (Google Fonts families, with their categories), `radius`, `code` and `parts`. Leave out what the theme doesn't change. Choose colors whose text is easy to read, since the admin panel warns about colors that aren't.
- **`css`** is added at the start of the site's custom CSS, so the site's own CSS comes after it. Style blocks by their [parts' names](/docs/built-in-blocks#named-parts), such as `.gf-card-title`, which never change. Load fonts only from Google Fonts and pictures only from data addresses, since anything else is listed to owners before they install it.
- **`header`** and **`footer`** are a header and footer as `content/layout/header.json` and `footer.json` have them. They can use only these [built-in blocks](/docs/built-in-blocks): Section, Grid, Flex, Space, Heading, Text, Button, Contact details, Menu, Site name and logo, Search, Dark mode switch and Language switch, since other blocks could load or run something on the site. Leave out pictures, since they'd point to files the site doesn't have, and addresses such as `javascript:`, which make the theme refused. Blocks such as Site name and logo and Menu read the site's own logo and menus.
- **`image`** is a picture of a site with the theme, shown on the Themes screen.

Publish it from GitHub Actions or GitLab CI with [npm's provenance](https://docs.npmjs.com/generating-provenance-statements) (`npm publish --provenance`), so the Themes screen can say which repository it was built from. Never change a published version: publish a new one, which sites update to once it's 3 days old.
