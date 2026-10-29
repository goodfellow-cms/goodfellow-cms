import {
  CONSENT_ACCEPT_ATTRIBUTE,
  CONSENT_CODE_ATTRIBUTE,
  CONSENT_PLACEHOLDER_ATTRIBUTE,
  type ConsentSettings,
  consentSource,
  endsHeldTemplate,
} from "@goodfellow-cms/core";
import { classNameField, sanitizeHtml, useParts, useSite, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { HtmlPreview } from "./html-preview";
import { HtmlWithScripts } from "./html-scripts";

export interface CustomHtmlProps {
  html: string;
  sanitize: boolean;
  className: string;
}

/** HTML that loads or runs something, which a site that asks visitors first holds back. */
const LOADS = /<(script|iframe|object|embed|link)[\s>/]/i;

const escapeText = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/**
 * HTML used as written, held back in a template for the consent script, with
 * a note and a button in its place, which the script hides once the visitor
 * agrees. It's all one element's HTML, so Next.js's React never looks inside
 * it, and leaves what the script adds there alone.
 */
function heldHtml(html: string, consent: ConsentSettings): string {
  const src = /\ssrc\s*=\s*["']?((?:https?:)?\/\/[^"'\s>]+)/i.exec(html)?.[1];
  const words = src
    ? consent.held.replaceAll("{site}", consentSource(src.startsWith("//") ? `https:${src}` : src))
    : consent.message;
  return `<template ${CONSENT_CODE_ATTRIBUTE}="body">${html}</template><div class="gf-consent-placeholder gf-consent-inline" ${CONSENT_PLACEHOLDER_ATTRIBUTE}=""><p>${escapeText(words)}</p><button type="button" ${CONSENT_ACCEPT_ATTRIBUTE}="content">${escapeText(consent.show)}</button></div>`;
}

/**
 * HTML written by hand, such as a widget's embed code. It's made safe by
 * default: scripts, styles, frames, forms and inline styles are left out. Used
 * as it's written, it runs on the site, but in the editor it's only shown,
 * inside a sandboxed frame, where it can't reach the admin panel, and its
 * scripts don't run. On the site they run whenever its page is shown, also
 * after moving to it on a Next.js site. On a site that asks visitors before
 * loading other sites' content, HTML that loads or runs anything waits until
 * they agree, as other sites' players do.
 */
const CustomHtml: ComponentConfig<CustomHtmlProps> = withParts(
  {
    label: "Custom HTML",
    fields: {
      html: { type: "textarea", label: "HTML" },
      sanitize: {
        type: "radio",
        label: "Make it safe",
        // HTML used as written runs on the site: on full-stack sites, only owners may choose it.
        metadata: { owners: true },
        options: [
          { label: "Yes: leave out scripts, styles and frames", value: true },
          { label: "No: use it exactly as written", value: false },
        ],
      },
      className: classNameField,
    },
    defaultProps: { html: "<p>Your HTML goes here.</p>", sanitize: true, className: "" },
    render: ({ html, sanitize, className: chosen, puck }) => {
      const part = useParts();
      const { settings } = useSite();
      const className = part("gf-custom-html", undefined, chosen);
      if (!sanitize && puck.isEditing) return <HtmlPreview html={html} className={className} />;
      // Where pages are built: the admin panel's previews render in the browser and show it at once.
      const consent = typeof document === "undefined" ? settings.consent : undefined;
      if (!sanitize && consent && LOADS.test(html)) {
        // HTML that would end the template early would run before the visitor agrees, so it's made safe instead.
        if (endsHeldTemplate(html)) {
          // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized
          return <div className={className} dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />;
        }
        return (
          <div
            className={className || undefined}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: the editor chose to use this HTML as written; it waits for the visitor's agreement
            dangerouslySetInnerHTML={{ __html: heldHtml(html, consent) }}
          />
        );
      }
      // Only HTML with scripts needs the browser's help, which loads React on the page.
      if (!sanitize && /<script[\s>]/i.test(html)) return <HtmlWithScripts html={html} className={className} />;
      return (
        <div
          className={className}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized unless the editor chose to use it as written
          dangerouslySetInnerHTML={{ __html: sanitize ? sanitizeHtml(html) : html }}
        />
      );
    },
  },
  {
    "gf-custom-html": "Custom HTML",
  },
);

export default CustomHtml;
