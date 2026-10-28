import { classNameField, SiteLink, useParts, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig, Slot } from "@puckeditor/core";

export interface PanelProps {
  title: string;
  tone: "primary" | "secondary";
  content: Slot;
  buttonLabel: string;
  buttonHref: string;
  className: string;
}

const titleClasses: Record<PanelProps["tone"], string> = {
  primary: "bg-primary text-primary-foreground",
  secondary: "bg-secondary text-secondary-foreground",
};

const buttonClasses: Record<PanelProps["tone"], string> = {
  primary: "bg-secondary text-secondary-foreground",
  secondary: "bg-primary text-primary-foreground",
};

/** A box with its title in a colored bar, other blocks inside it, and an optional button at its foot. */
const Panel: ComponentConfig<PanelProps> = withParts(
  {
    label: "Panel",
    fields: {
      title: { type: "text", label: "Title", contentEditable: true },
      tone: {
        type: "radio",
        label: "Title bar's color",
        options: [
          { value: "primary", label: "Primary" },
          { value: "secondary", label: "Secondary" },
        ],
      },
      content: { type: "slot" },
      buttonLabel: { type: "text", label: "Button at the foot (leave empty for none)" },
      buttonHref: { type: "text", label: "Button links to" },
      className: classNameField,
    },
    defaultProps: { title: "Panel", tone: "primary", content: [], buttonLabel: "", buttonHref: "", className: "" },
    render: ({ title, tone, content: Content, buttonLabel, buttonHref, className }) => {
      const part = useParts();
      return (
        <div
          className={part(
            "gf-panel",
            "flex h-full flex-col overflow-hidden rounded-md bg-background text-foreground shadow-md",
            className,
          )}
        >
          {title && (
            <h2
              className={part("gf-panel-title", [
                "px-4 py-3 text-center font-heading text-2xl font-semibold",
                titleClasses[tone],
              ])}
            >
              {title}
            </h2>
          )}
          <Content className={part("gf-panel-content", "flex-1 p-5")} />
          {buttonLabel && buttonHref && (
            <div className={part("gf-panel-foot", "px-5 pb-5 text-center")}>
              <SiteLink
                href={buttonHref}
                className={part("gf-panel-button", [
                  "inline-block rounded-md px-5 py-2 text-sm font-semibold hover:opacity-90",
                  buttonClasses[tone],
                ])}
              >
                {buttonLabel}
              </SiteLink>
            </div>
          )}
        </div>
      );
    },
  },
  {
    "gf-panel": "Panel",
    "gf-panel-title": "Title bar",
    "gf-panel-content": "Content",
    "gf-panel-foot": "Foot",
    "gf-panel-button": "Button",
  },
);

export default Panel;
