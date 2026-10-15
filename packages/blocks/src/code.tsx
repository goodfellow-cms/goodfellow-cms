import { codeStyle, type SiteSettings } from "@goodfellow-cms/core";
import { classNameField, cx } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { CopyButton } from "./copy-button.js";
import { CODE_LANGUAGES, type CodeColors, type CodeLanguage, highlightCode, loadHighlighter } from "./highlight.js";
import { options } from "./options.js";

/**
 * Highlighted code, as a `<pre>` from `highlightCode()` (or plain, escaped by
 * the caller), with a button that copies it. Shared by the Code block and code in Markdown.
 */
export function CodeView({
  code,
  html,
  title,
  copyLabel,
  className,
}: {
  code: string;
  html: string;
  title?: string;
  copyLabel?: string;
  className?: string;
}) {
  return (
    <figure className={cx("gf-code group relative my-6 overflow-hidden rounded-lg border border-border", className)}>
      {title && (
        <figcaption className="border-b border-border bg-muted px-4 py-2 font-mono text-sm text-muted-foreground">
          {title}
        </figcaption>
      )}
      <div
        className="overflow-x-auto text-sm [&_pre]:m-0 [&_pre]:p-4"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: highlighted by Shiki, which escapes the code
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {copyLabel && <CopyButton code={code} label={copyLabel} />}
    </figure>
  );
}

export interface CodeProps {
  code: string;
  language: CodeLanguage;
  title: string;
  colors: CodeColors;
  copyLabel: string;
  /** The highlighted code, filled in when the page is built. */
  html?: string;
  className: string;
}

/** Code shown with syntax highlighting, such as a command to run or a file to write. */
export const Code: ComponentConfig<CodeProps> = {
  label: "Code",
  fields: {
    code: { type: "textarea", label: "Code" },
    language: { type: "select", label: "Language", options: options(CODE_LANGUAGES) },
    title: { type: "text", label: "Title, such as a file name" },
    colors: {
      type: "radio",
      label: "Colors",
      options: options({ page: "Like the page", light: "Light", dark: "Dark" }),
    },
    copyLabel: { type: "text", label: "Copy button's label (leave empty for no button)" },
    className: classNameField,
  },
  defaultProps: {
    code: 'console.log("Hello!");',
    language: "javascript",
    title: "",
    colors: "page",
    copyLabel: "Copy code",
    className: "",
  },
  resolveData: async ({ props }, { metadata }) => {
    const style = codeStyle((metadata.site as SiteSettings | undefined)?.theme);
    const shiki = await loadHighlighter(style);
    return { props: { ...props, html: highlightCode(shiki, props.code, props.language, props.colors, style) } };
  },
  render: ({ code, html, title, copyLabel, className }) => (
    <CodeView
      code={code}
      html={html ?? ""}
      title={title || undefined}
      copyLabel={copyLabel || undefined}
      className={className}
    />
  ),
};
