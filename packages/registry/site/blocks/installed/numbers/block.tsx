import { classNameField, useParts, withKeywords, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";

interface NumberItem {
  value: string;
  label: string;
  text: string;
}

export interface NumbersProps {
  heading: string;
  items: NumberItem[];
  look: "plain" | "boxes";
  className: string;
}

const lookClasses: Record<NumbersProps["look"], string> = {
  plain: "",
  boxes: "rounded-lg border border-border bg-card p-6 text-card-foreground",
};

/** A few numbers worth knowing, such as families served or years open, each with what it counts. */
const NumbersBlock: ComponentConfig<NumbersProps> = withParts(
  {
    label: "Numbers",
    fields: {
      heading: { type: "text", label: "Heading", contentEditable: true },
      items: {
        type: "array",
        label: "Numbers",
        arrayFields: {
          value: { type: "text", label: "Number, such as 1,200 or 98%" },
          label: { type: "text", label: "What it counts" },
          text: { type: "text", label: "More words under it (optional)" },
        },
        defaultItemProps: { value: "100", label: "What it counts", text: "" },
        getItemSummary: (item) => [item.value, item.label].filter(Boolean).join(" ") || "Number",
      },
      look: {
        type: "radio",
        label: "Look",
        options: [
          { value: "plain", label: "Plain" },
          { value: "boxes", label: "In boxes" },
        ],
      },
      className: classNameField,
    },
    defaultProps: {
      heading: "",
      items: [
        { value: "150", label: "Years in the town", text: "" },
        { value: "1,200", label: "Families", text: "" },
        { value: "40", label: "Groups and ministries", text: "" },
      ],
      look: "plain",
      className: "",
    },
    render: ({ heading, items, look, className }) => {
      const part = useParts();
      return (
        <section className={part("gf-numbers", "w-full", className)}>
          {heading && (
            <h2 className={part("gf-numbers-heading", "mb-8 text-center font-heading text-3xl font-semibold")}>
              {heading}
            </h2>
          )}
          {/* What each number counts is its term, so screen readers read "Families: 1,200". */}
          <dl className={part("gf-numbers-list", "grid gap-6 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]")}>
            {(items ?? []).map((item, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: numbers can repeat
                key={index}
                className={part("gf-numbers-item", [
                  "flex flex-col-reverse items-center gap-1 text-center",
                  lookClasses[look] ?? "",
                ])}
              >
                <dt className={part("gf-numbers-label", "font-medium")}>
                  {item.label}
                  {item.text && (
                    <span className={part("gf-numbers-text", "mt-1 block text-sm font-normal text-muted-foreground")}>
                      {item.text}
                    </span>
                  )}
                </dt>
                <dd className={part("gf-numbers-value", "font-heading text-4xl font-bold text-primary")}>
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      );
    },
  },
  {
    "gf-numbers": "Numbers",
    "gf-numbers-heading": "Heading",
    "gf-numbers-list": "List",
    "gf-numbers-item": "Number with its words",
    "gf-numbers-value": "Number",
    "gf-numbers-label": "What it counts",
    "gf-numbers-text": "More words",
  },
);

export default withKeywords(NumbersBlock, ["numbers", "statistics", "stats", "facts", "figures", "counters"]);
