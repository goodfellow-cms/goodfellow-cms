/**
 * What makes the built-in blocks that do something in the browser work: the
 * Code block's copy button, the Dark mode switch and the Search box. Each is
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

/** Each built-in block's script, by the attribute that says a page needs it. */
export const BLOCK_SCRIPTS: readonly { attribute: string; script: () => string }[] = [
  { attribute: COPY_ATTRIBUTE, script: copyScript },
  { attribute: DARK_MODE_ATTRIBUTE, script: darkModeScript },
  { attribute: SEARCH_BOX_ATTRIBUTE, script: searchScript },
];

/** The scripts a page's HTML needs: one for each kind of block it has that does something in the browser. */
export function blockScriptsFor(html: string): string[] {
  return BLOCK_SCRIPTS.filter(({ attribute }) => html.includes(` ${attribute}`)).map(({ script }) => script());
}
