// What visitors' browsers run to ask before loading other sites' content. It has no imports, since it
// runs on every page of a site that asks.

/** Where a visitor's answer is kept in their browser: `yes` or `no`. */
export const CONSENT_STORAGE_KEY = "goodfellow-consent";

/** The notice's id. */
export const CONSENT_NOTICE_ID = "gf-consent";

/**
 * On the notice, which the consent script finds by it rather than by its id,
 * since rich text keeps ids, and an element of its own with that id earlier in
 * the page would keep the notice from showing. Rich text leaves `data-` attributes out.
 */
export const CONSENT_NOTICE_ATTRIBUTE = "data-gf-consent-notice";

/** The notice's words, which name it for screen readers. */
export const CONSENT_MESSAGE_ID = "gf-consent-message";

/** Links to this, such as a menu's "Privacy choices", open the notice again. */
export const CONSENT_LINK = "#consent";

/** On a player, frame or script held back: the address it loads once the visitor agrees, in place of `src`. */
export const CONSENT_SRC_ATTRIBUTE = "data-gf-consent-src";

/** On what's shown in place of a player held back, which goes once the visitor agrees. */
export const CONSENT_PLACEHOLDER_ATTRIBUTE = "data-gf-consent-placeholder";

/** On a `<template>` of the site's custom code: `head` or `body`, where it goes once the visitor agrees. */
export const CONSENT_CODE_ATTRIBUTE = "data-gf-consent-code";

/** On a template of custom code the consent script has added to the page, so it adds it once. */
export const CONSENT_DONE_ATTRIBUTE = "data-gf-consent-done";

/** On buttons that agree, or that don't. */
export const CONSENT_ACCEPT_ATTRIBUTE = "data-gf-consent-accept";
export const CONSENT_DECLINE_ATTRIBUTE = "data-gf-consent-decline";

/**
 * The script a site that asks puts after its notice, at the end of the page.
 * It shows the notice until the visitor answers, keeps the answer in their
 * browser, and once they agree loads what was held back: each player's
 * address, Web3Forms' hCaptcha script and the site's custom code, written
 * again so its scripts run. It watches the page, so what Next.js shows later
 * is held back or loaded too, and links to `#consent` open the notice again. Choosing no after
 * yes reloads the page, which can't unload what it loaded.
 *
 * It never changes the page's elements, so Next.js's React, which may take
 * over the page before or after it runs, keeps what it loaded rather than
 * drawing the page again and loading it all twice: a player gets its address
 * in place, a placeholder is hidden, and what it adds (another site's
 * scripts, the head's code) goes at the end of the head, which React lets
 * other scripts add to, or, for the body's code, in one element after its
 * template, which it marks as done. Opened from a link, the notice takes the
 * keyboard's focus, on its first button.
 */
export function consentScript(): string {
  const q = JSON.stringify;
  return `(function(){var d=document,K=${q(CONSENT_STORAGE_KEY)},S=${q(CONSENT_SRC_ATTRIBUTE)},P=${q(CONSENT_PLACEHOLDER_ATTRIBUTE)},C=${q(CONSENT_CODE_ATTRIBUTE)},D=${q(CONSENT_DONE_ATTRIBUTE)},A=${q(CONSENT_ACCEPT_ATTRIBUTE)},N=${q(CONSENT_DECLINE_ATTRIBUTE)},L=${q(CONSENT_LINK)},O=${q(CONSENT_NOTICE_ATTRIBUTE)};
function get(){try{return localStorage.getItem(K)}catch(e){return null}}
function put(v){try{localStorage.setItem(K,v)}catch(e){}}
function show(open,focus){var n=d.querySelector("["+O+"]");if(!n)return;n.hidden=!open;if(open&&focus){var b=n.querySelector("button");if(b)b.focus()}}
function code(t){t.setAttribute(D,"");var f=t.content.cloneNode(true);f.querySelectorAll("script").forEach(function(o){var s=d.createElement("script");for(var i=0;i<o.attributes.length;i++)s.setAttribute(o.attributes[i].name,o.attributes[i].value);if(!o.hasAttribute("async"))s.async=false;s.text=o.text;o.replaceWith(s)});if(t.getAttribute(C)==="head")d.head.appendChild(f);else{var w=d.createElement("div");w.setAttribute("data-goodfellow-code","");w.style.display="contents";w.appendChild(f);t.after(w)}}
function release(){d.querySelectorAll("["+S+"]").forEach(function(e){var a=e.getAttribute(S);e.removeAttribute(S);if(e.tagName==="SCRIPT"){var s=d.createElement("script");s.src=a;s.async=true;d.head.appendChild(s)}else e.setAttribute("src",a)});d.querySelectorAll("["+P+"]").forEach(function(e){e.hidden=true;e.style.display="none"});d.querySelectorAll("template["+C+"]:not(["+D+"])").forEach(code)}
function check(){var g=get();if(g==="yes")release();else if(g!=="no")show(true)}
d.addEventListener("click",function(e){var t=e.target&&e.target.closest?e.target.closest("["+A+"],["+N+"],a[href]"):null;if(!t)return;if(t.hasAttribute(A)){put("yes");show(false);release()}else if(t.hasAttribute(N)){var was=get();put("no");show(false);if(was==="yes")location.reload()}else if(t.getAttribute("href")===L){e.preventDefault();show(true,true)}});
new MutationObserver(check).observe(d.body,{childList:true,subtree:true});check()})();`;
}

/** The site a held-back player is from, to name in its place, such as `youtube-nocookie.com`. */
export function consentSource(src: string): string {
  try {
    return new URL(src).hostname.replace(/^www\./, "");
  } catch {
    return src;
  }
}
