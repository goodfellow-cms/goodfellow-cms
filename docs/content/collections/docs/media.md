---
version: 1
title: Images and files
description: Upload, choose, replace and delete images and files in the media library.
section: editors
order: 4
---

The **Media** screen holds the site's images and files. They're saved in the repository's `public/media/` folder and served at `/media/`, unless a plugin keeps them in a storage service (see [below](#media-kept-in-a-storage-service)).

## Upload

Choose files, or drop them onto the Media screen. Wherever an image goes, such as an Image block, a section's background, the logo or a collection's image field, the **Choose image** button picks from the library or uploads a new one.

- Large photos are made no bigger than 2400 pixels on their longest side, and JPEGs are re-saved, which removes details hidden in them such as where a photo was taken.
- SVG images have anything that could run code removed, and anything they would load from other sites as they draw, so opening one tells no one.
- Images, PDFs, office documents, MP3 audio, MP4 and WebM video, and captions for videos (WebVTT `.vtt` files) can be uploaded, up to 25 MB each. Web pages, scripts and other files that could run code can't. Uploads stay in the site's repository for good, even after they're replaced, so longer videos are better on YouTube or Vimeo, which the [Video](/docs/built-in-blocks#video) block shows too. On a site published with Cloudflare Pages, whose terms ask free plans to serve video through its paid services, the media library says so once it has a video in it ([Hosts and business sites](/docs/hosts#business-and-commercial-sites)).
- New uploads show in the editor straight away, even before the live site has been rebuilt with them.
- When the site is built, smaller copies of each JPEG, PNG and WebP photo are made, 480, 800, 1200 and 1600 pixels wide (only those narrower than the photo), so phones download no more than they show. The photo itself is kept as it was uploaded. Sites that keep media in a storage service, full-stack Next.js sites and Next.js sites with an image loader of their own don't get the copies.

## Replace and delete

Replacing a file keeps its address, so everything that uses it shows the new version. The new file has to be the same kind as the one it replaces, such as a `.jpg` for a `.jpg`, since it's saved under the same name. Deleting a file first lists everything that uses it, and can't be published until they use another file (see [Site checks](/docs/publishing#site-checks)).

## Media kept in a storage service

A plugin can keep the site's media in a storage service in place of the repository, such as [S3 storage](https://github.com/goodfellow-cms/goodfellow-plugin-s3), which keeps it in Amazon S3, Cloudflare R2, Backblaze B2 or any other S3-compatible service. Files can then be much larger, such as long videos, up to what the plugin takes, and nothing goes into the repository's history. Content still refers to files as `/media/…`, so pages don't change when the site's media moves: builds show them from the service's public address.

- **Setting it up** happens on the plugin's own screen in **Site Settings**, which says what it needs. The service's keys stay in the site's build service's secrets (or a full-stack site's server), never in the admin panel.
- **Uploading** works as before. Photos are made web-sized and SVGs safe, as for the site's own files. Each batch of uploads then waits about a minute while the site's build service signs it with the keys, and goes straight to the storage service.
- **Moving the site's files:** the Media screen's **Where media is kept** offers to move the files already in the site's own files to the storage, in one publish, and to move them back, files up to 25 MB, once the storage isn't wanted any more. A plugin can't be removed while it keeps files the site shows.
- **The list of files** the storage keeps, with their sizes, is in `content/media-storage.json` ([Content files](/docs/content-files)).

## Credits

Photos the [AI assistant](/docs/ai-assistant#photos) finds on Openverse show their credit under their name on the Media screen, linking to where they came from. Pages that use them list their credits at the bottom, as their licenses require. The credits are kept in `content/media.json`; replacing or deleting a photo removes its credit, since it was for that photo.
