import {
  CONSENT_CODE_ATTRIBUTE,
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
 * links and `noscript` in a template until they agree. Never render this in the admin panel, where it would run with
 * the editor's sign-in.
 */
export function HeadCode({ code, held = false }: { code?: string; held?: boolean }) {
  if (!code?.trim()) return null;
  let elements: HeadElement[];
  try {
    elements = parseHeadCode(code);
  } catch {
    return null;
  }
  if (!held) return <>{elements.map(headElement)}</>;
  // On a site that asks visitors first, what loads or runs waits in a template for the consent script.
  const waiting = elements.filter(isHeldHeadElement);
  return (
    <>
      {elements.filter((element) => !isHeldHeadElement(element)).map(headElement)}
      {waiting.length > 0 && (
        <template
          {...{ [CONSENT_CODE_ATTRIBUTE]: "head" }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: admin-written code, which is the point; never shown in the admin panel
          dangerouslySetInnerHTML={{ __html: waiting.map(headElementHtml).join("") }}
        />
      )}
    </>
  );
}

/**
 * The site's code for the end of the `<body>` (`content/code/body.html`), as it
 * was written, or in a template until visitors agree where the site asks (`held`). Never render this in the admin panel.
 */
export function BodyCode({ code, held = false }: { code?: string; held?: boolean }) {
  if (!code?.trim()) return null;
  if (held) {
    return (
      <template
        {...{ [CONSENT_CODE_ATTRIBUTE]: "body" }}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: admin-written code, which is the point; never shown in the admin panel
        dangerouslySetInnerHTML={{ __html: code }}
      />
    );
  }
  // biome-ignore lint/security/noDangerouslySetInnerHtml: admin-written code, which is the point; never shown in the admin panel
  return <div data-goodfellow-code="" style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: code }} />;
}
