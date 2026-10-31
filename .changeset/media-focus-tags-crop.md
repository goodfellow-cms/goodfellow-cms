---
"@goodfellow-cms/core": minor
"@goodfellow-cms/react": minor
"@goodfellow-cms/blocks": minor
"@goodfellow-cms/admin": minor
"goodfellow": minor
"@goodfellow-cms/next": minor
---

The media library's **Details** keeps an image's focal point in view wherever it's cut to fit, on images and Section backgrounds, and gives files tags, which filter the Media screen and the image picker; several files can be tagged at once. Photos can be cropped and turned in the browser, saved as a new image or in place of the original. Builds' smaller copies of photos are now WebP, about a third smaller. `content/media.json` gains optional `focus` and `tags`, and `mediaDetailsOf()` reads all of it for `mediaFileChange()`.
