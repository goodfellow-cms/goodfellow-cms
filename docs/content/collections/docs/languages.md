---
version: 1
title: Several languages
description: A site in more than one language, with translations linked together, a language switch, and search and search engines that know each page's language.
section: editors
order: 2.8
---

A site can be in more than one language, such as a parish with Masses in English and Spanish. Its main language's pages stay where they are; each other language's pages are under its code, so the Spanish home page is `/es` and the Spanish About page might be `/es/sobre`. A page's language is where it is, so nothing else needs setting.

## Adding a language

In **Site Settings**, the **Languages** tab has the main language and a button, **Add a language**. Give the new language its code, such as `es`, `fr` or `pt-BR`. It's named in its own language (Español, Français, Português) unless you name it yourself, and it can have the site's name, description and page title pattern in that language. Publish, and the language is ready for pages.

A language's code is where its pages go, so it can't change once it's published, and the main language's code can't change while the site has pages or items in other languages. A language can be removed once nothing is in it.

## Translating a page

On the **Pages** screen, each page in the main language lists the site's other languages:

- **Translate into Español** makes a copy of the page under the language's code, which you then translate in the editor. The copy remembers which page it translates.
- Once a translation exists, it shows **Up to date**, or **Out of date** when the original has changed since. Update the translation, then **Mark as up to date**.

The editor shows a page in its own language: the site's name and menus in that language, and only that language's items in lists. Its header has a **Language** menu, as **Header & Footer** does: pick a language to open the page's translation in it, marked **(out of date)** where the original has changed since, or **Translate into Español…** for a language it has none in. A translation's menu goes back to the original, and to its other translations. Items' editors have the same.

Deleting a page keeps its translations, as pages of their own. Moving a page keeps them linked to it.

### Translating with AI

In a page that's in another language, the [AI assistant](/docs/ai-assistant) has **Translate into Español**: it translates the whole page, its blocks and settings, keeping its layout, and links to pages that have a translation go to the translation. Whatever you write in the box is passed on too, such as how formal to be. As with anything the AI writes, read it through before publishing.

## Collections

A collection's items can be in any of the site's languages. On a collection's list, each item in the main language has **Translate into Español**, which copies it with a name of its own, such as `open-house-es`, and the same **Up to date** and **Out of date** as pages. **Add** asks for the language when the site has more than one, for items in only one language, such as news that's only for Spanish speakers.

An item's page is under its language's code: a story at `/news/{slug}` in English is at `/es/news/{slug}` in Spanish. Lists, calendars and feeds on a page show only the items in the page's language, so a Spanish page lists only Spanish items.

## Menus

On the **Menus** tab, pick a language. Each language starts with the main language's menus; tick **Español has menus of its own** to give it its own, with its links' names in Spanish and links to its pages. The header and footer show each page's language's menus.

## The header and footer

Each language starts with the main language's header and footer. In **Header & Footer**, pick a language, then **Make a footer for Español** to give it one of its own, a copy of the main language's to translate, with the [AI assistant](/docs/ai-assistant) too. The language's pages then show it in place of the main one. **Use the main language's footer** goes back.

## The Language switch

The **Language switch** block, under Navigation, links to the page in each of the site's languages, each named in itself: to its translation, or, where it has none, to the language's home page. Put it in the header so it's on every page. It shows as links side by side, or as a menu that opens.

The site's name and logo link to the home page of the page's own language.

## Checking translations

The [site checks](/docs/publishing#site-checks) suggest translating pages and items that have no translation into one of the site's languages, or whose translation is out of date. They're listed when you publish a change that brings them, such as a new page, not every time, and builds list them all. A page or item that's only for one language can stay as it is.

## Search and search engines

- **Search** only finds pages in the language of the page it's on. Each page says its language, and [search](/docs/search) keeps each language's pages apart.
- **Search engines** are told each page's translations with `hreflang` links, and the sitemap lists them, so they show people the page in their own language. Events and stories say their language in the details search engines read. All of these need the Site address.
- **Feeds and calendars** come in each language that has items, under its code: `/es/feeds/news.rss`, `/es/calendars/events.ics`.

## The admin panel's own language

The admin panel speaks English or Spanish, whichever each editor's browser asks for first, or chooses with the language menu at the top right. That's each editor's own, kept in their browser, and has nothing to do with the site's languages, so a Spanish-speaking editor can work on the English pages, and the other way round.

### The admin panel in other languages

A site can have the admin panel in any other language too, with its text in a file of the site's own: `content/admin-text/fr.json` for French, named by the language's code. The language menu then offers it, named as the file names it, and editors whose browser asks for it first start in it.

Owners add one in **Site Settings → Admin panel languages**: give the language's code and its name in that language, choose the [AI service](/docs/ai-assistant) and its key, as in the editor's AI panel, and **Add and translate**. The service translates the admin panel's words, the editor's controls and your blocks' labels, a batch at a time, with a glossary that keeps words such as Publish, Draft and Version history the same throughout and never uses git's. What comes back is published as the language's file, even if the service stops part way, so nothing is translated twice. The screen then shows how much of the admin panel each language says, with **Translate what's missing**, **Translate again what's out of date** for strings whose English has changed in a later release, and **Remove**. A box says anything the translation should know, such as how formal to be. A chat app can't do it, since the admin panel asks the service itself.

A developer or a translation tool can write the files too:

```json
{
  "version": 1,
  "name": "Français",
  "strings": {
    "nav.pages": { "text": "Les pages", "source": "7decab7f" }
  },
  "puck": {},
  "labels": {
    "Link text": { "text": "Texte du lien" }
  }
}
```

- **`strings`** are the admin panel's own words, by the keys in `packages/admin/src/strings.tsx`; **`puck`** is the editor's controls, by Puck's dictionary's keys; **`labels`** are blocks' names, settings and choices, by their English wording.
- **`source`** is a hash of the English the text was made from, `englishHash()` from `@goodfellow-cms/core`, so text whose English has changed since can be found again. **`reviewed`** can mark text someone who speaks the language has read.
- **Anything the file leaves out is in English**, or in Goodfellow's own translation where it ships one, so a file for `es` changes only the strings it has.
- **Every string is checked as it's used**: one that's empty, very long, or has other `{placeholders}` than the English, such as `{title}`, is shown in English instead.
- **The English is shown beside** the site's own words where a wrong translation could cost something: signing in and tokens, owners' screens, plugins, and what can't be undone, such as deleting a page.
- **Only owners** change these files, as they do Site Settings.
- **Builds publish them** beside the admin panel, in `admin/text/`, so the sign-in screen speaks them before it can read the site's files; once someone has signed in, the admin panel reads the site's own, which may be newer. A file that can't be read is left out, with a note in the build's output, and never stops the build.

## For developers

What the languages are and what translates what is all in [content files](/docs/content-files):

- `content/site.json`: `languages`, a list of `{ code, name }`, besides the main `language` and its optional `languageName`, and `translations`, each language's `title`, `description` and `titleTemplate`.
- `content/menus.json`: `languages`, each language's own menus by name.
- Pages: a translation's file has `translationOf`, the address of the page it translates, and `translatedFrom`, a hash of that page's content when it was translated, which says whether it's out of date. A page under a language's code without `translationOf` is a page of its own in that language.
- Items: `inLanguage`, the item's language, besides `translationOf` (the name of the item it translates) and `translatedFrom`. Markdown items have them in their front matter.
- A collection's `languagePaths` gives a language's items an address pattern of its own, such as `{ "es": "/es/noticias/{slug}" }`, in place of the collection's under the language's code. It starts with the language's code too, since that's how pages know what language they're in.
- A language can have a header or footer of its own in `content/layout/header.es.json` or `footer.es.json`, used in place of the main one on its pages.

[Site checks](/docs/publishing) warn about a translation of a page that isn't in the main language, and about missing and out-of-date translations. With Next.js, the shared layout has the header and footer in each language, and the browser shows the one for the page's address, so they stay mounted as visitors move between pages, even from one language to another; the Language switch there finds the page's translations in the browser too. `goodfellow-next finish` writes each exported page's language on its `<html>`.
