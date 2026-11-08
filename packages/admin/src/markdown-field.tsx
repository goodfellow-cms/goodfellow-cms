import { canFormatMarkdown } from "@goodfellow-cms/core";
import { AutoField, FieldLabel, RichTextMenu, type RichtextField } from "@puckeditor/core";
import { useRef, useState } from "react";
import { editedMarkdown, formattedHtml } from "./markdown-text.js";
import { useStrings } from "./strings.js";

/**
 * Puck's formatted editor, without what Markdown can't store: underlining and
 * alignment. Links, pictures, and tables are edited in the Markdown tab.
 */
const formattedField: RichtextField = {
  type: "richtext",
  options: { underline: false },
  renderMenu: () => (
    <RichTextMenu>
      <RichTextMenu.Group>
        <RichTextMenu.HeadingSelect />
        <RichTextMenu.ListSelect />
      </RichTextMenu.Group>
      <RichTextMenu.Group>
        <RichTextMenu.Bold />
        <RichTextMenu.Italic />
        <RichTextMenu.Strikethrough />
        <RichTextMenu.InlineCode />
      </RichTextMenu.Group>
      <RichTextMenu.Group>
        <RichTextMenu.Blockquote />
        <RichTextMenu.CodeBlock />
        <RichTextMenu.HorizontalRule />
      </RichTextMenu.Group>
    </RichTextMenu>
  ),
};

type Tab = "formatted" | "markdown";

/**
 * The body of an entry stored as Markdown: edited formatted, or as Markdown.
 * Markdown the formatted editor can't show without losing something, such as
 * a table, is only offered as Markdown.
 */
export function MarkdownField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange(markdown: string): void;
}) {
  const t = useStrings();
  const formattable = canFormatMarkdown(value);
  const [tab, setTab] = useState<Tab>(formattable ? "formatted" : "markdown");
  // The Markdown the formatted editor started from, so text that only looks different stays as it was written.
  const start = useRef(value);
  const [html, setHtml] = useState(() => formattedHtml(value));

  const choose = (next: Tab) => {
    if (next === "formatted") {
      start.current = value;
      setHtml(formattedHtml(value));
    }
    setTab(next);
  };
  const current = formattable ? tab : "markdown";

  return (
    // A div, not Puck's usual label: clicking anywhere in a label would focus its first button, the tabs.
    <FieldLabel label={label} el="div">
      <div className="gfa-markdown-tabs" role="tablist" aria-label={label}>
        {(["formatted", "markdown"] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            className="gfa-tab"
            aria-selected={current === name}
            disabled={name === "formatted" && !formattable}
            onClick={() => choose(name)}
          >
            {t(name === "formatted" ? "markdown.formatted" : "markdown.source")}
          </button>
        ))}
      </div>
      {current === "formatted" ? (
        <div className="gfa-markdown-formatted">
          <AutoField
            id={id}
            field={formattedField}
            value={html}
            onChange={(next: unknown) => {
              const nextHtml = typeof next === "string" ? next : "";
              setHtml(nextHtml);
              onChange(editedMarkdown(start.current, nextHtml));
            }}
          />
        </div>
      ) : (
        <>
          <textarea
            id={id}
            aria-label={label}
            className="gfa-puck-input gfa-markdown-source"
            value={value}
            spellCheck
            onChange={(event) => onChange(event.target.value)}
          />
          {!formattable && <p className="gfa-puck-hint">{t("markdown.sourceOnly")}</p>}
        </>
      )}
      {hint && <p className="gfa-puck-hint">{hint}</p>}
    </FieldLabel>
  );
}
