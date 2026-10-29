---
"@goodfellow-cms/core": patch
"@goodfellow-cms/react": patch
"@goodfellow-cms/next": patch
"@goodfellow-cms/blocks": patch
"@goodfellow-cms/admin": patch
"@goodfellow-cms/registry": patch
---

Fixes to asking visitors before loading other sites' content:

- The head's links to the site's own files, such as a stylesheet or icons, stay on the page; only links to other sites wait for visitors to agree (`isHeldHeadElement(element, siteUrl)`).
- Code that has `</template>` in it, which would run before visitors agree, is left out of pages while the site asks. Site Settings won't publish it, and Custom HTML used as written is made safe instead (`endsHeldTemplate()`).
- The consent script finds the notice by `data-gf-consent-notice`, so an element in rich text with the same id can't hide it. The notice is named by its message for screen readers, and a link to `#consent` moves the keyboard's focus to it.
- The notice's words come in the site's main language where there are default words for it (English and Spanish), and each language's pages get their own default words (`consentDefaults()`, `consentInLanguage()`). Turning asking off and on again keeps the words that were written.
- Google forms and maps keep their Style on the box around them, in the editor and on the site alike (`ConsentFrame`'s `boxClassName`).
- The docs say that full-stack Next.js sites load fonts from Google before visitors agree.
