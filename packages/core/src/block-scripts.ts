/**
 * What makes the built-in blocks that do something in the browser work: the
 * Code block's copy button, the Dark mode switch, the Search box, the
 * Gallery's lightbox and the Announcement bar's close button. Each is
 * a small script of its own rather than a React component, so a page that
 * uses them loads no React. The blocks render plain HTML marked with these
 * attributes, and `goodfellow build` adds a script only to the pages with
 * its attribute (`blockScriptsFor()`); Next.js sites, whose layout can't know
 * the page, have all of them in it.
 *
 * Each listens on the whole document rather than on its elements, and does
 * nothing a second time on a page that has it twice, so it works on what
 * Next.js's navigations add. They never move or remove the page's elements,
 * so Next.js's React, which may take over the page before or after they run,
 * keeps them. No imports but constants, since they run in visitors' browsers.
 */
import { COLOR_SCHEME_ATTRIBUTE, COLOR_SCHEME_STORAGE_KEY } from "./color-scheme.js";
import { SEARCH_INDEX_DIR } from "./search.js";

/** On the Code block's copy button: copies the text of the `<pre>` in the `<figure>` it's in. */
export const COPY_ATTRIBUTE = "data-gf-copy";

/** On the copy button for two seconds after it copied, which its icons show with `[[data-gf-copied]_&]:` classes. */
export const COPIED_ATTRIBUTE = "data-gf-copied";

/** On the Dark mode switch's `<button role="switch">` or `<select>`, which the script enables once it's running. */
export const DARK_MODE_ATTRIBUTE = "data-gf-dark-mode";

/** On the Dark mode switch once its script is running, so a menu can stay hidden until it shows the visitor's choice. */
export const DARK_MODE_READY_ATTRIBUTE = "data-gf-ready";

/**
 * On the Search box's `<search>`, with its words (`data-gf-no-results`,
 * `data-gf-unavailable`) and the site's address (`data-gf-base`, which
 * `applyBasePath()` gives the base path, as `SiteLink` does in Next.js).
 * Inside it are the box, `[data-gf-search-results]` with a
 * `[data-gf-search-message]` and a `[data-gf-search-list]`, which carries
 * the classes of the results' links, titles and excerpts.
 */
export const SEARCH_BOX_ATTRIBUTE = "data-gf-search-box";

/**
 * On a Gallery whose pictures open larger: each picture is a link to its file
 * (`LIGHTBOX_ITEM_ATTRIBUTE`), which opens without JavaScript too, and the
 * Gallery draws a `<dialog>` (`LIGHTBOX_DIALOG_ATTRIBUTE`) holding the
 * picture shown (`data-gf-lightbox-image`), its caption
 * (`data-gf-lightbox-caption`), and Close, Previous and Next buttons
 * (`data-gf-lightbox-close`, `-previous`, `-next`).
 */
export const LIGHTBOX_ATTRIBUTE = "data-gf-lightbox";

/** On each picture's link in a Gallery whose pictures open larger. */
export const LIGHTBOX_ITEM_ATTRIBUTE = "data-gf-lightbox-item";

/** On the Gallery's `<dialog>` that shows a picture larger. */
export const LIGHTBOX_DIALOG_ATTRIBUTE = "data-gf-lightbox-dialog";

/**
 * On an Announcement bar visitors can close, with what it says as a hash, so
 * a bar closed once stays closed until its message changes. Its close button
 * carries `ANNOUNCEMENT_CLOSE_ATTRIBUTE`.
 */
export const ANNOUNCEMENT_ATTRIBUTE = "data-gf-announcement";

/** On an Announcement bar's close button. */
export const ANNOUNCEMENT_CLOSE_ATTRIBUTE = "data-gf-announcement-close";

/** Where the Announcement bars a visitor closed are kept, as their hashes. */
export const ANNOUNCEMENT_STORAGE_KEY = "goodfellow-closed-announcements";

/** How many closed bars are remembered; older ones are forgotten first. */
const CLOSED_ANNOUNCEMENTS = 20;

const q = JSON.stringify;

/** The Code block's copy button. */
export function copyScript(): string {
  return `(function(){if(window.__gfCopy)return;window.__gfCopy=1;var C=${q(COPY_ATTRIBUTE)},D=${q(COPIED_ATTRIBUTE)};
document.addEventListener("click",function(e){var b=e.target&&e.target.closest?e.target.closest("["+C+"]"):null,f=b&&b.closest("figure"),p=f&&f.querySelector("pre");if(!p||!navigator.clipboard)return;navigator.clipboard.writeText(p.textContent||"").then(function(){b.setAttribute(D,"");clearTimeout(b.__gfCopied);b.__gfCopied=setTimeout(function(){b.removeAttribute(D)},2000)},function(){})})})();`;
}

/**
 * The Dark mode switch: a switch between light and dark, or a menu that can
 * also follow the computer's setting. The page's `<html>` says what's shown
 * (`COLOR_SCHEME_ATTRIBUTE`), so every switch on the page agrees, and a
 * choice is kept for the next page, which `colorSchemeScript()` puts back
 * before it's shown, and for the site's other tabs.
 */
export function darkModeScript(): string {
  return `(function(){if(window.__gfDarkMode)return;window.__gfDarkMode=1;var d=document,r=d.documentElement,A=${q(COLOR_SCHEME_ATTRIBUTE)},K=${q(COLOR_SCHEME_STORAGE_KEY)},E=${q(DARK_MODE_ATTRIBUTE)},R=${q(DARK_MODE_READY_ATTRIBUTE)},m=matchMedia("(prefers-color-scheme: dark)");
function shown(){var v=r.getAttribute(A);return v==="light"||v==="dark"?v:"system"}
function apply(c){if(c==="system")r.removeAttribute(A);else r.setAttribute(A,c)}
function choose(c){try{if(c==="system")localStorage.removeItem(K);else localStorage.setItem(K,c)}catch(e){}apply(c)}
function sync(){var c=shown(),dark=c==="dark"||c==="system"&&m.matches;d.querySelectorAll("["+E+"]").forEach(function(e){e.disabled=false;e.setAttribute(R,"");if(e.tagName==="SELECT"){if(e.value!==c)e.value=c}else e.setAttribute("aria-checked",dark?"true":"false")})}
d.addEventListener("click",function(e){var b=e.target&&e.target.closest?e.target.closest("button["+E+"]"):null;if(b)choose(b.getAttribute("aria-checked")==="true"?"light":"dark")});
d.addEventListener("change",function(e){var s=e.target;if(s&&s.matches&&s.matches("select["+E+"]"))choose(s.value)});
addEventListener("storage",function(e){if(e.key===K)apply(e.newValue==="light"||e.newValue==="dark"?e.newValue:"system")});
m.addEventListener("change",sync);
new MutationObserver(sync).observe(r,{attributes:true,attributeFilter:[A]});
new MutationObserver(function(l){for(var i=0;i<l.length;i++)if(l[i].addedNodes.length)return sync()}).observe(d.body,{childList:true,subtree:true});
sync()})();`;
}

/**
 * The Search box: results as visitors type, from the site's Pagefind index,
 * which the build wrote. Pagefind searches the pages in the language
 * `<html lang>` says when it starts, so on a site in several languages it
 * starts again when a visitor moves to a page in another one without
 * loading a new page, as Next.js sites do. Pagefind's excerpts are escaped
 * text with the matches in `<mark>`; any other `<` or `>` is shown as text.
 */
export function searchScript(): string {
  return `(function(){if(window.__gfSearch)return;window.__gfSearch=1;var d=document,B=${q(SEARCH_BOX_ATTRIBUTE)},I=${q(`${SEARCH_INDEX_DIR}/pagefind.js`)},L=null,G;
function base(s){return (s.getAttribute("data-gf-base")||"/").replace(/\\/?$/,"/")}
function ready(f){return f.options({baseUrl:"/"}).then(function(){return f})}
function load(b){var g=d.documentElement.lang;if(L&&G!==g)L=L.then(function(f){return f.destroy().then(function(){return ready(f)})});G=g;if(!L){L=import(b+I).then(ready);L.catch(function(){L=null})}return L}
function marks(t){return String(t||"").split(/(<\\/?mark>)/).map(function(x){return /^<\\/?mark>$/.test(x)?x:x.replace(/</g,"&lt;").replace(/>/g,"&gt;")}).join("")}
function box(t){return t&&t.closest?t.closest("["+B+"]"):null}
function part(s,n){return s.querySelector("[data-gf-search-"+n+"]")}
function show(s,open){part(s,"results").hidden=!(open&&s.querySelector("input").value.trim())}
function say(s,t){part(s,"list").replaceChildren();var m=part(s,"message");m.textContent=t;m.hidden=false}
function search(s){var q=s.querySelector("input").value.trim(),n=s.__gfSearch=(s.__gfSearch||0)+1;show(s,true);if(!q)return;
load(base(s)).then(function(f){return f.debouncedSearch(q)}).then(function(r){return r&&n===s.__gfSearch?Promise.all(r.results.slice(0,8).map(function(x){return x.data()})):null}).then(function(found){if(!found||n!==s.__gfSearch)return;if(!found.length)return say(s,(s.getAttribute("data-gf-no-results")||"").replace("{query}",q));
var u=part(s,"list"),at=base(s).slice(0,-1);part(s,"message").hidden=true;u.replaceChildren.apply(u,found.map(function(x){var li=d.createElement("li"),a=d.createElement("a"),t=d.createElement("span"),e=d.createElement("span");a.className=u.getAttribute("data-gf-link-class")||"";a.href=at+x.url;t.className=u.getAttribute("data-gf-title-class")||"";t.textContent=x.meta&&x.meta.title||x.url;e.className=u.getAttribute("data-gf-excerpt-class")||"";e.innerHTML=marks(x.excerpt);a.append(t,e);li.append(a);return li}))},function(){if(n===s.__gfSearch)say(s,s.getAttribute("data-gf-unavailable")||"")})}
d.addEventListener("input",function(e){var s=box(e.target);if(s&&e.target.tagName==="INPUT")search(s)});
d.addEventListener("focusin",function(e){var s=box(e.target);if(s&&e.target.tagName==="INPUT")show(s,true)});
d.addEventListener("pointerdown",function(e){d.querySelectorAll("["+B+"]").forEach(function(s){if(!s.contains(e.target))show(s,false)})});
d.addEventListener("keydown",function(e){if(e.key==="Escape")d.querySelectorAll("["+B+"]").forEach(function(s){show(s,false)})});
d.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("["+B+"] a"):null;if(a)show(box(a),false)});
d.querySelectorAll("["+B+"] input").forEach(function(i){if(i.value)search(box(i))})})();`;
}

/**
 * The Gallery's lightbox: a picture's link opens it larger in the Gallery's
 * `<dialog>`, with its caption, where the arrow keys, the buttons and
 * swiping move between the Gallery's pictures, and Escape, Close or a click
 * outside the picture closes it, giving the keyboard's focus back to the
 * picture. A click with a key held, to open the picture's file elsewhere,
 * is left to the browser.
 */
export function lightboxScript(): string {
  return `(function(){if(window.__gfLightbox)return;window.__gfLightbox=1;var d=document,G=${q(LIGHTBOX_ATTRIBUTE)},I=${q(LIGHTBOX_ITEM_ATTRIBUTE)},D=${q(LIGHTBOX_DIALOG_ATTRIBUTE)},open=null;
function items(g){return Array.prototype.slice.call(g.querySelectorAll("["+I+"]"))}
function part(dl,n){return dl.querySelector("[data-gf-lightbox-"+n+"]")}
function show(o,i){var l=items(o.g);if(!l.length)return;o.i=(i+l.length)%l.length;var a=l[o.i],im=a.querySelector("img"),f=a.closest("figure"),c=f&&f.querySelector("figcaption"),pi=part(o.dl,"image"),pc=part(o.dl,"caption");pi.src=a.href;pi.alt=im?im.alt:"";pi.removeAttribute("aria-hidden");var nm=pi.alt||(c?c.textContent:"");if(nm)o.dl.setAttribute("aria-label",nm);if(pc){pc.textContent=c?c.textContent:"";pc.hidden=!c}var p=part(o.dl,"previous"),n=part(o.dl,"next");if(p)p.hidden=l.length<2;if(n)n.hidden=l.length<2}
function start(a){var g=a.closest("["+G+"]"),dl=g&&g.querySelector("dialog["+D+"]");if(!dl||!dl.showModal)return false;open={g:g,dl:dl,from:a,i:0};show(open,items(g).indexOf(a));if(!dl.open)dl.showModal();return true}
d.addEventListener("click",function(e){var t=e.target;if(!t||!t.closest)return;var a=t.closest("["+I+"]");if(a&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey&&e.button===0){if(start(a))e.preventDefault();return}
if(!open)return;if(t.closest("[data-gf-lightbox-close]")||t===open.dl)open.dl.close();else if(t.closest("[data-gf-lightbox-previous]"))show(open,open.i-1);else if(t.closest("[data-gf-lightbox-next]"))show(open,open.i+1)});
d.addEventListener("keydown",function(e){if(!open||!open.dl.open)return;if(e.key==="ArrowLeft")show(open,open.i-1);else if(e.key==="ArrowRight")show(open,open.i+1)});
d.addEventListener("close",function(e){if(open&&e.target===open.dl){var f=open.from;open=null;if(f&&f.focus)f.focus()}},true);
var x=null;d.addEventListener("pointerdown",function(e){x=open&&open.dl.contains(e.target)?e.clientX:null});
d.addEventListener("pointerup",function(e){if(x===null||!open)return;var dx=e.clientX-x;x=null;if(Math.abs(dx)>50)show(open,open.i+(dx<0?1:-1))})})();`;
}

/**
 * The Announcement bar's close button: hides the bar and remembers it closed,
 * by its hash, which `announcementHideScript()` reads before the next page
 * shows.
 */
export function announcementScript(): string {
  return `(function(){if(window.__gfAnnouncement)return;window.__gfAnnouncement=1;var A=${q(ANNOUNCEMENT_ATTRIBUTE)},C=${q(ANNOUNCEMENT_CLOSE_ATTRIBUTE)},K=${q(ANNOUNCEMENT_STORAGE_KEY)};
document.addEventListener("click",function(e){var b=e.target&&e.target.closest?e.target.closest("["+C+"]"):null,bar=b&&b.closest("["+A+"]");if(!bar)return;var h=bar.getAttribute(A);bar.hidden=true;
try{var l=JSON.parse(localStorage.getItem(K)||"[]");if(!Array.isArray(l))l=[];l=l.filter(function(x){return x!==h});l.push(h);localStorage.setItem(K,JSON.stringify(l.slice(-${CLOSED_ANNOUNCEMENTS})))}catch(e){}})})();`;
}

/**
 * Hides the Announcement bars a visitor closed before they show: the bar
 * renders it just before itself, so it runs as the page is read, adding a
 * style for each closed bar to the page's `<head>`. Only hashes are read back,
 * so what a page's storage holds can't add anything else to it.
 */
export function announcementHideScript(): string {
  return `(function(){if(window.__gfAnnouncementHidden)return;window.__gfAnnouncementHidden=1;try{var l=JSON.parse(localStorage.getItem(${q(ANNOUNCEMENT_STORAGE_KEY)})||"[]");if(!Array.isArray(l))return;var r=l.filter(function(h){return typeof h==="string"&&/^[0-9a-f]{1,32}$/.test(h)}).map(function(h){return "["+${q(ANNOUNCEMENT_ATTRIBUTE)}+"='"+h+"']{display:none!important}"}).join("");if(!r)return;var s=document.createElement("style");s.textContent=r;document.head.appendChild(s)}catch(e){}})();`;
}

/** Each built-in block's script, by the attribute that says a page needs it. */
export const BLOCK_SCRIPTS: readonly { attribute: string; script: () => string }[] = [
  { attribute: COPY_ATTRIBUTE, script: copyScript },
  { attribute: DARK_MODE_ATTRIBUTE, script: darkModeScript },
  { attribute: SEARCH_BOX_ATTRIBUTE, script: searchScript },
  { attribute: LIGHTBOX_ATTRIBUTE, script: lightboxScript },
  { attribute: ANNOUNCEMENT_CLOSE_ATTRIBUTE, script: announcementScript },
];

/** The scripts a page's HTML needs: one for each kind of block it has that does something in the browser. */
export function blockScriptsFor(html: string): string[] {
  return BLOCK_SCRIPTS.filter(({ attribute }) => html.includes(` ${attribute}`)).map(({ script }) => script());
}
