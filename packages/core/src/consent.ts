// What visitors' browsers run to ask before loading other sites' content. It has no imports, since it
// runs on every page of a site that asks.

/**
 * Where a visitor's answer is kept in their browser, as JSON (`ConsentAnswer`).
 * An answer in another form, such as the `yes` or `no` of earlier releases, is asked again.
 */
export const CONSENT_STORAGE_KEY = "goodfellow-consent";

/** A visitor's answer: the kinds they allowed, the kinds they were asked about, and when, in milliseconds. */
export interface ConsentAnswer {
  yes: string[];
  asked: string[];
  at: number;
}

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

/** On buttons that agree, or that don't. One that agrees to only one kind, such as a player's, names it. */
export const CONSENT_ACCEPT_ATTRIBUTE = "data-gf-consent-accept";
export const CONSENT_DECLINE_ATTRIBUTE = "data-gf-consent-decline";

/**
 * On what's held back, and on the notice's choices: the kind of content it
 * is (one of core's `CONSENT_KINDS`), which the visitor allows on its own.
 * What doesn't say is other sites' content.
 */
export const CONSENT_KIND_ATTRIBUTE = "data-gf-consent-kind";

/** On the notice: the kinds the site asks about, separated by spaces. */
export const CONSENT_KINDS_ATTRIBUTE = "data-gf-consent-kinds";

/** On the notice: how many days an answer lasts before the visitor is asked again. */
export const CONSENT_DAYS_ATTRIBUTE = "data-gf-consent-days";

/** How long an answer lasts where the notice doesn't say, as core's `CONSENT_DAYS`. */
const CONSENT_DEFAULT_DAYS = 180;

/** On the notice's button that shows its choices, the choices themselves, and the button that keeps them. */
export const CONSENT_CHOOSE_ATTRIBUTE = "data-gf-consent-choose";
export const CONSENT_CHOICES_ATTRIBUTE = "data-gf-consent-choices";
export const CONSENT_SAVE_ATTRIBUTE = "data-gf-consent-save";

/**
 * The script a site that asks puts after its notice, at the end of the page.
 * It shows the notice until the visitor answers about every kind the site
 * asks about, keeps the answer in their browser (`ConsentAnswer`) for the
 * notice's number of days, and loads what was held back of each kind they
 * allow: each player's address, Web3Forms' hCaptcha script and the site's
 * custom code, written again so its scripts run. A player's own button allows
 * only its kind; the notice's Choose shows a choice for each kind. It
 * watches the page, so what Next.js shows later is held back or loaded too,
 * and links to `#consent` open the notice again. Taking back a kind allowed
 * before reloads the page, which can't unload what it loaded. Where the
 * browser keeps nothing, the answer lasts while the page is open.
 *
 * It never changes the page's elements, so Next.js's React, which may take
 * over the page before or after it runs, keeps what it loaded rather than
 * drawing the page again and loading it all twice: a player gets its address
 * in place, a placeholder is hidden, and what it adds (another site's
 * scripts, the head's code) goes at the end of the head, which React lets
 * other scripts add to, or, for the body's code, in one element after its
 * template, which it marks as done. Opened from a link, the notice takes the
 * keyboard's focus, on its first button, and its choices on their first.
 */
export function consentScript(): string {
  const q = JSON.stringify;
  return `(function(){var d=document,K=${q(CONSENT_STORAGE_KEY)},S=${q(CONSENT_SRC_ATTRIBUTE)},P=${q(CONSENT_PLACEHOLDER_ATTRIBUTE)},C=${q(CONSENT_CODE_ATTRIBUTE)},D=${q(CONSENT_DONE_ATTRIBUTE)},A=${q(CONSENT_ACCEPT_ATTRIBUTE)},N=${q(CONSENT_DECLINE_ATTRIBUTE)},L=${q(CONSENT_LINK)},O=${q(CONSENT_NOTICE_ATTRIBUTE)},T=${q(CONSENT_KIND_ATTRIBUTE)},G=${q(CONSENT_KINDS_ATTRIBUTE)},Y=${q(CONSENT_DAYS_ATTRIBUTE)},H=${q(CONSENT_CHOOSE_ATTRIBUTE)},X=${q(CONSENT_CHOICES_ATTRIBUTE)},V=${q(CONSENT_SAVE_ATTRIBUTE)},M=null;
function box(){return d.querySelector("["+O+"]")}
function kinds(){var n=box(),k=n&&n.getAttribute(G);return k?k.split(" "):["content"]}
function days(){var n=box(),v=n?Number(n.getAttribute(Y)):0;return v>0?v:${CONSENT_DEFAULT_DAYS}}
function list(a){return Array.isArray(a)&&a.every(function(k){return typeof k==="string"})}
function stored(){var v=null;try{v=JSON.parse(localStorage.getItem(K)||"null")}catch(e){}v=v||M;return v&&list(v.yes)&&list(v.asked)&&typeof v.at==="number"&&Date.now()-v.at<days()*864e5?v:null}
function allows(k){var v=stored();return !!v&&v.yes.indexOf(k)>=0}
function answered(){var v=stored();return !!v&&kinds().every(function(k){return v.asked.indexOf(k)>=0})}
function kind(e){return e.getAttribute(T)||"content"}
function panel(open){var n=box(),f=n&&n.querySelector("["+X+"]");if(!f)return;f.hidden=!open;n.querySelectorAll("["+H+"]").forEach(function(b){b.hidden=open});n.querySelectorAll("["+V+"]").forEach(function(b){b.hidden=!open});if(open){var v=stored();f.querySelectorAll("input["+T+"]").forEach(function(i){i.checked=!!v&&v.yes.indexOf(i.getAttribute(T))>=0});var i=f.querySelector("input");if(i)i.focus()}}
function show(open,focus){var n=box();if(!n)return;n.hidden=!open;if(!open)panel(false);if(open&&focus){var b=n.querySelector("button:not([hidden])");if(b)b.focus()}}
function code(t){t.setAttribute(D,"");var f=t.content.cloneNode(true);f.querySelectorAll("script").forEach(function(o){var s=d.createElement("script");for(var i=0;i<o.attributes.length;i++)s.setAttribute(o.attributes[i].name,o.attributes[i].value);if(!o.hasAttribute("async"))s.async=false;s.text=o.text;o.replaceWith(s)});if(t.getAttribute(C)==="head")d.head.appendChild(f);else{var w=d.createElement("div");w.setAttribute("data-goodfellow-code","");w.style.display="contents";w.appendChild(f);t.after(w)}}
function release(){d.querySelectorAll("["+S+"]").forEach(function(e){if(!allows(kind(e)))return;var a=e.getAttribute(S);e.removeAttribute(S);if(e.tagName==="SCRIPT"){var s=d.createElement("script");s.src=a;s.async=true;d.head.appendChild(s)}else e.setAttribute("src",a)});d.querySelectorAll("["+P+"]").forEach(function(e){if(allows(kind(e))){e.hidden=true;e.style.display="none"}});d.querySelectorAll("template["+C+"]:not(["+D+"])").forEach(function(t){if(allows(kind(t)))code(t)})}
function answer(yes,asked){var was=stored();M={yes:yes,asked:asked,at:Date.now()};try{localStorage.setItem(K,JSON.stringify(M))}catch(e){}if(answered())show(false);if(was&&was.yes.some(function(k){return yes.indexOf(k)<0}))location.reload();else release()}
function check(){release();if(!answered())show(true)}
d.addEventListener("click",function(e){var t=e.target&&e.target.closest?e.target.closest("["+A+"],["+N+"],["+H+"],["+V+"],a[href]"):null;if(!t)return;var all=kinds(),v=stored();if(t.hasAttribute(A)){var k=t.getAttribute(A);if(!k)return answer(all,all);var yes=v?v.yes.slice():[],asked=v?v.asked.slice():[];if(yes.indexOf(k)<0)yes.push(k);if(asked.indexOf(k)<0)asked.push(k);answer(yes,asked)}else if(t.hasAttribute(N))answer([],all);else if(t.hasAttribute(H))panel(true);else if(t.hasAttribute(V)){var chosen=[];box().querySelectorAll("input["+T+"]:checked").forEach(function(i){chosen.push(i.getAttribute(T))});answer(chosen,all)}else if(t.getAttribute("href")===L){e.preventDefault();show(true,true)}});
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
