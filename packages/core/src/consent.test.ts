import { type HTMLElement, Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import { CONSENT_STORAGE_KEY, consentScript, consentSource } from "./consent.js";
import { headElementHtml, isHeldHeadElement, parseHeadCode } from "./content/code.js";
import { localizedSettings } from "./content/languages.js";
import { siteSettingsSchema } from "./content/schemas.js";

const PAGE = `<!DOCTYPE html><html><head>
<template data-gf-consent-code="head"><script>window.headRan = (window.headRan || 0) + 1</script></template>
</head><body>
<div class="player"><iframe title="Video" data-gf-consent-src="https://www.youtube-nocookie.com/embed/abc"></iframe>
<div data-gf-consent-placeholder=""><button type="button" data-gf-consent-accept="">Show it</button></div></div>
<script data-gf-consent-src="https://web3forms.com/client/script.js"></script>
<a href="#consent">Privacy choices</a>
<div id="gf-consent" hidden><button type="button" data-gf-consent-decline="">No</button><button type="button" data-gf-consent-accept="">Allow</button></div>
<template data-gf-consent-code="body"><p id="widget">Widget</p><script>window.bodyRan = (window.bodyRan || 0) + 1</script></template>
</body></html>`;

let window: Window | undefined;
afterEach(async () => {
  await window?.happyDOM.close();
  window = undefined;
});

/** A page of a site that asks, with the consent script run in it, and the visitor's earlier answer if any. */
function open(answer?: "yes" | "no") {
  window = new Window({
    url: "https://example.org/",
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
      disableIframePageLoading: true,
      disableJavaScriptFileLoading: true,
    },
  });
  if (answer) window.localStorage.setItem(CONSENT_STORAGE_KEY, answer);
  window.document.write(PAGE);
  window.eval(consentScript());
  const page = window as unknown as Window & { headRan?: number; bodyRan?: number };
  const document = window.document;
  const notice = () => document.getElementById("gf-consent") as unknown as HTMLElement;
  const click = (selector: string) => (document.querySelector(selector) as unknown as HTMLElement).click();
  return { page, document, notice, click };
}

describe("the consent script", () => {
  it("asks first, and loads nothing from other sites until the visitor agrees", () => {
    const { page, document, notice, click } = open();
    expect(notice().hidden).toBe(false);
    expect(document.querySelector("iframe")?.getAttribute("src")).toBeNull();
    expect(page.headRan).toBeUndefined();
    expect(page.bodyRan).toBeUndefined();

    click("#gf-consent [data-gf-consent-accept]");
    expect(notice().hidden).toBe(true);
    expect(window?.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe("yes");
    expect(document.querySelector("iframe")?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/abc");
    expect((document.querySelector("[data-gf-consent-placeholder]") as unknown as HTMLElement).hidden).toBe(true);
    expect(document.head.querySelector('script[src="https://web3forms.com/client/script.js"]')).not.toBeNull();
    // The site's code runs once each, the body's after its template.
    expect(page.headRan).toBe(1);
    expect(page.bodyRan).toBe(1);
    expect(
      document.querySelector("template[data-gf-consent-code=body] + [data-goodfellow-code] #widget"),
    ).not.toBeNull();
  });

  it("leaves the page's elements where they were, so Next.js's React keeps them", () => {
    const { document } = open();
    const shape = () =>
      [...document.body.querySelectorAll("*")]
        .filter((element) => !element.closest("[data-goodfellow-code]"))
        .map((element) => element.tagName)
        .join(" ");
    const before = shape();
    const body = document.body.innerHTML.length;
    (document.querySelector("#gf-consent [data-gf-consent-accept]") as unknown as HTMLElement).click();
    expect(shape()).toBe(before);
    expect(document.body.innerHTML.length).toBeGreaterThan(body);
  });

  it("adds what was held back once, however often the page changes", async () => {
    const { page, document } = open("yes");
    document.body.appendChild(document.createElement("p"));
    document.body.appendChild(document.createElement("p"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(page.headRan).toBe(1);
    expect(page.bodyRan).toBe(1);
    expect(document.querySelectorAll("[data-goodfellow-code]")).toHaveLength(1);
    expect(document.head.querySelectorAll('script[src="https://web3forms.com/client/script.js"]')).toHaveLength(1);
  });

  it("remembers the answer, and opens the notice again from a link to #consent", () => {
    const declined = open("no");
    expect(declined.notice().hidden).toBe(true);
    expect(declined.document.querySelector("iframe")?.getAttribute("src")).toBeNull();
    declined.click('a[href="#consent"]');
    expect(declined.notice().hidden).toBe(false);
  });

  it("loads everything at once for a visitor who agreed before", () => {
    const { page, document, notice } = open("yes");
    expect(notice().hidden).toBe(true);
    expect(document.querySelector("iframe")?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/abc");
    expect(page.bodyRan).toBe(1);
  });

  it("agrees from a held-back player's own button too", () => {
    const { document, click } = open();
    click(".player [data-gf-consent-accept]");
    expect(document.querySelector("iframe")?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/abc");
  });
});

describe("consent settings", () => {
  it("fill in the notice's words, and take each language's own", () => {
    const settings = siteSettingsSchema.parse({
      version: 1,
      consent: { accept: "OK", policy: "/privacy" },
      languages: [{ code: "es" }],
      translations: { es: { consent: { accept: "Aceptar", message: " " } } },
    });
    expect(settings.consent).toMatchObject({ accept: "OK", decline: "No, thanks", policy: "/privacy" });
    const spanish = localizedSettings(settings, "es").consent;
    expect(spanish).toMatchObject({ accept: "Aceptar", policy: "/privacy" });
    // An empty translation leaves the main language's words.
    expect(spanish?.message).toBe(settings.consent?.message);
  });

  it("are left out where the site doesn't ask", () => {
    expect(siteSettingsSchema.parse({ version: 1 }).consent).toBeUndefined();
  });
});

describe("held-back head code", () => {
  it("keeps meta tags in the page and writes the rest again as they were", () => {
    const elements = parseHeadCode(
      '<meta name="google-site-verification" content="abc"><script async src="https://example.com/a.js?x=1&amp;y=&quot;2&quot;"></script><link rel="stylesheet" href="https://example.com/a.css">',
    );
    expect(elements.map(isHeldHeadElement)).toEqual([false, true, true]);
    expect(elements.slice(1).map(headElementHtml).join("")).toBe(
      '<script async src="https://example.com/a.js?x=1&amp;y=&quot;2&quot;"></script><link rel="stylesheet" href="https://example.com/a.css">',
    );
  });

  it("names where a held-back player is from", () => {
    expect(consentSource("https://www.youtube-nocookie.com/embed/abc")).toBe("youtube-nocookie.com");
    expect(consentSource("not an address")).toBe("not an address");
  });
});
