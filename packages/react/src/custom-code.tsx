import {
  CONSENT_CODE_ATTRIBUTE,
  CONSENT_KIND_ATTRIBUTE,
  type ConsentKind,
  endsHeldTemplate,
  type HeadElement,
  headElementHtml,
  isHeldHeadElement,
  parseHeadCode,
} from "@goodfellow-cms/core";
import { createElement } from "react";

/** HTML attribute names React spells differently. */
const REACT_NAMES: Record<string, string> = {
  class: "className",
  charset: "charSet",
  "http-equiv": "httpEquiv",
  crossorigin: "crossOrigin",
  nomodule: "noModule",
  referrerpolicy: "referrerPolicy",
  fetchpriority: "fetchPriority",
  hreflang: "hrefLang",
  imagesizes: "imageSizes",
  imagesrcset: "imageSrcSet",
  itemprop: "itemProp",
};

/** Attributes that are on when present, which React takes as `true`. */
const BOOLEAN = new Set(["async", "defer", "nomodule", "disabled"]);

/** The kind code held back waits for, where `true` is other sites' content. */
function heldKind(held: true | ConsentKind): ConsentKind {
  return held === true ? "content" : held;
}

function headElement({ tag, attributes, content }: HeadElement, index: number) {
  const props: Record<string, unknown> = { key: index };
  for (const [name, value] of attributes) {
    props[REACT_NAMES[name] ?? name] = BOOLEAN.has(name) ? true : value;
  }
  // What's inside goes in as it was written, as it would in an HTML page.
  if (content) props.dangerouslySetInnerHTML = { __html: content };
  return createElement(tag, props);
}

/**
 * The site's code for the `<head>` (`content/code/head.html`), as elements.
 * Code that doesn't belong in the head is left out; the admin panel won't
 * publish it. `held`, for a site that asks visitors first, keeps scripts,
 * `noscript` and links to other sites than `siteUrl` in a template until they
 * allow its kind (`heldCode()`; `true` is other sites' content), and leaves
 * out code that would end that template early (`endsHeldTemplate()`). Never
 * render this in the admin panel, where it would run with the editor's sign-in.
 */
export function HeadCode({
  code,
  held = false,
  siteUrl,
}: {
  code?: string;
  held?: boolean | ConsentKind;
  siteUrl?: string;
}) {
  if (!code?.trim()) return null;
  let elements: HeadElement[];
  try {
    elements = parseHeadCode(code);
  } catch {
    return null;
  }
  if (!held) return <>{elements.map(headElement)}</>;
  // On a site that asks visitors first, what loads or runs waits in a template for the consent script.
  const isHeld = (element: HeadElement) => isHeldHeadElement(element, siteUrl);
  const kept = elements.filter((element) => !isHeld(element)).map(headElement);
  const waiting = elements.filter(isHeld).map(headElementHtml).join("");
  // Code that would end the template early would run before visitors agree, so it's left out.
  if (!waiting || endsHeldTemplate(waiting)) return <>{kept}</>;
  return (
    <>
      {kept}
      <template
        {...{ [CONSENT_CODE_ATTRIBUTE]: "head", [CONSENT_KIND_ATTRIBUTE]: heldKind(held) }}
        // The consent script marks it done once it has added the code.
        suppressHydrationWarning
        // biome-ignore lint/security/noDangerouslySetInnerHtml: admin-written code, which is the point; never shown in the admin panel
        dangerouslySetInnerHTML={{ __html: waiting }}
      />
    </>
  );
}

/**
 * The site's code for the end of the `<body>` (`content/code/body.html`), as it
 * was written, or in a template until visitors allow its kind where the site asks
 * (`held`, as for `HeadCode`), leaving it out if it would end that template early.
 * Never render this in the admin panel.
 */
export function BodyCode({ code, held = false }: { code?: string; held?: boolean | ConsentKind }) {
  if (!code?.trim()) return null;
  if (held) {
    if (endsHeldTemplate(code)) return null;
    return (
      <template
        {...{ [CONSENT_CODE_ATTRIBUTE]: "body", [CONSENT_KIND_ATTRIBUTE]: heldKind(held) }}
        // The consent script marks it done once it has added the code after it.
        suppressHydrationWarning
        // biome-ignore lint/security/noDangerouslySetInnerHtml: admin-written code, which is the point; never shown in the admin panel
        dangerouslySetInnerHTML={{ __html: code }}
      />
    );
  }
  // biome-ignore lint/security/noDangerouslySetInnerHtml: admin-written code, which is the point; never shown in the admin panel
  return <div data-goodfellow-code="" style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: code }} />;
}
