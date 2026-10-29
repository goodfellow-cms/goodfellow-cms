import { classNameField, sanitizeHtml, useParts, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { HtmlPreview } from "./html-preview";
import { HtmlWithScripts } from "./html-scripts";

export interface CustomHtmlProps {
  html: string;
  sanitize: boolean;
  className: string;
}

/**
 * HTML written by hand, such as a widget's embed code. It's made safe by
 * default: scripts, styles, frames, forms and inline styles are left out. Used
 * as it's written, it runs on the site, but in the editor it's only shown,
 * inside a sandboxed frame, where it can't reach the admin panel, and its
 * scripts don't run. On the site they run whenever its page is shown, also
 * after moving to it on a Next.js site.
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
      const className = part("gf-custom-html", undefined, chosen);
      if (!sanitize && puck.isEditing) return <HtmlPreview html={html} className={className} />;
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
