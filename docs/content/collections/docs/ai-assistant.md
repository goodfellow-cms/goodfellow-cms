---
version: 1
title: AI assistant
description: Draft and rewrite content with AI, using Claude, OpenAI, a free service or any chat app.
section: editors
order: 6
---

The **AI** button above the editor opens the AI panel beside it, which writes with AI. Describe what you want:

- With nothing selected, it adds new blocks to the end of the page.
- With a block selected, it changes that block.
- For a collection's item, it fills in the item's fields.
- On a page or item in another of the site's [languages](/docs/languages), **Translate into** translates all of it, keeping its layout.

The result goes straight into the editor, so you can check it, change it or undo it before publishing. It's told never to make up facts such as times or names, and to leave `[placeholders]` instead.

## Photos

Where the media library has no image that fits, the assistant can find openly licensed photos on [Openverse](https://openverse.org), which gathers Creative Commons and public domain images from Wikimedia Commons, Flickr and other collections. Leave **Find openly licensed photos** ticked in the AI panel (it's remembered in your browser), and ask for what you need, such as "a section about our choir, with a photo".

- Only photos whose license allows any use, including changes such as cropping, are used: CC BY, CC BY-SA, CC0 and the Public Domain Mark.
- Each photo is added to the media library, and its credit (its title, who made it, where it came from and its license) is saved with it. Every page that shows the photo lists its credit at the bottom, as the license requires, with links to the photo and the license.
- Openverse is asked straight from your browser, with no account or key. It allows about 20 requests a minute and 200 a day from each computer, so a request finds at most six photos; where none is found, the image is left empty for you to choose.
- Check that a photo suits your site before publishing: the photos are other people's, and Openverse can't check every one.

Deleting or replacing a photo in the media library removes its credit too. A site's developer can turn this off for everyone; see [Configuration](/docs/configuration).

## Choosing a service

Each editor chooses a service in the AI panel's settings, and it's called straight from their browser, with their own account:

| Service | Needs | Cost |
|---|---|---|
| Claude (Opus 5.5, Sonnet 5.5 or Haiku 4.5) | An API key from the [Claude Console](https://platform.claude.com/settings/keys) | Charged per use, roughly a few cents for a page |
| OpenAI, Google Gemini, Groq, Mistral, OpenRouter | An API key from the service | Gemini, Groq, Mistral and OpenRouter have free tiers with limits |
| OVHcloud AI Endpoints | Nothing | Free, about 2 requests a minute |
| A chat app such as Claude.ai or ChatGPT | Copying the request in and the answer back | Whatever your chat app plan includes |
| Any other OpenAI-compatible service | Its address, and a key if it needs one | Varies |

Keys stay in the editor's browser, for the session or on the device if they choose, and they're forgotten on sign-out. They're only ever sent to the service they belong to. Free models write less reliably, so answers are always checked against the site's blocks before they're used.

A site's developer can limit the services offered, or turn the assistant off; see [Configuration](/docs/configuration). On a [full-stack site](/docs/full-stack-nextjs#ai-keys-on-the-server), the site's server can ask services with keys of its own, which editors then use without one.
