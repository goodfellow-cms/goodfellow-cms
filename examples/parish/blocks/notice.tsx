import { classNameField, cx } from "@goodfellow-cms/react";
import type { ComponentConfig, RichText } from "@puckeditor/core";

type Tone = "subtle" | "highlight";

export interface NoticeProps {
  title: string;
  text: RichText;
  tone: Tone;
  className: string;
}

const toneClasses: Record<Tone, string> = {
  subtle: "border-primary bg-muted text-foreground",
  highlight: "border-secondary bg-accent text-accent-foreground",
};

/** A short announcement that stands out from the text around it, such as a change to the Mass schedule. */
export const Notice: ComponentConfig<NoticeProps> = {
  label: "Notice",
  fields: {
    title: { type: "text", label: "Heading", contentEditable: true },
    text: {
      type: "richtext",
      label: "Text",
      contentEditable: true,
      options: { link: { HTMLAttributes: { target: null, rel: null } } },
    },
    tone: {
      type: "radio",
      label: "Style",
      options: [
        { value: "subtle", label: "Subtle" },
        { value: "highlight", label: "Highlighted" },
      ],
    },
    className: classNameField,
  },
  defaultProps: { title: "Please note", text: "<p>Write the announcement here.</p>", tone: "subtle", className: "" },
  render: ({ title, text, tone, className }) => (
    // A note, not an <aside>: asides belong beside the page's content, not in it.
    <div role="note" className={cx("rounded-lg border-l-4 p-5", toneClasses[tone], className)}>
      {title && <p className="font-heading text-lg font-semibold">{title}</p>}
      <div className="gf-prose mt-1">{text}</div>
    </div>
  ),
};
