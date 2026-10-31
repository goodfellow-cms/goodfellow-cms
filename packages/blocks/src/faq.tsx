import { classNameField, useParts, withParts, withStructuredData } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import type { ReactNode } from "react";
import { faqStructuredData } from "./faq-data.js";
import { FAQ_PARTS } from "./parts.js";

export interface FaqProps {
  heading: string;
  /** Each question, with its answer as formatted text (which Puck draws as content). */
  items: Array<{ question: string; answer: string | ReactNode }>;
  className: string;
}

/**
 * Questions and answers, each opening to show its answer with no
 * JavaScript, as the browser's own `<details>`. The page tells search
 * engines about them as schema.org's `FAQPage` (`faqStructuredData()`),
 * with every FAQ block on the page in one.
 */
export const Faq: ComponentConfig<FaqProps> = withStructuredData(
  withParts(
    {
      label: "Questions and answers",
      fields: {
        heading: { type: "text", label: "Heading", contentEditable: true },
        items: {
          type: "array",
          label: "Questions",
          arrayFields: {
            question: { type: "text", label: "Question" },
            answer: {
              type: "richtext",
              label: "Answer",
              options: { link: { HTMLAttributes: { target: null, rel: null } } },
            },
          },
          defaultItemProps: { question: "", answer: "" },
          getItemSummary: (item) => item.question || "Question",
        },
        className: classNameField,
      },
      defaultProps: {
        heading: "Questions and answers",
        items: [{ question: "What time is Mass on Sunday?", answer: "<p>At 9:00 and 11:00.</p>" }],
        className: "",
      },
      render: (props) => <FaqView {...props} isEditing={props.puck?.isEditing === true} />,
    },
    FAQ_PARTS,
  ),
  (props) => faqStructuredData(props.items),
);

function FaqView({ heading, items, className, isEditing }: FaqProps & { isEditing: boolean }) {
  const part = useParts();
  const shown = (items ?? []).filter((item) => typeof item.question === "string" && item.question.trim());
  if (shown.length === 0 && !heading) return null;
  return (
    <section className={part("gf-faq", "my-6", className)}>
      {heading && <h2 className={part("gf-faq-heading", "mb-4 text-2xl font-semibold")}>{heading}</h2>}
      <div className={part("gf-faq-items", "divide-y divide-border border-y border-border")}>
        {shown.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: questions have no ids
          <details key={index} className={part("gf-faq-item", "py-3")} open={isEditing || undefined}>
            <summary className={part("gf-faq-question", "cursor-pointer font-semibold")}>{item.question}</summary>
            <div className={part("gf-faq-answer", "gf-prose mt-2")}>{item.answer}</div>
          </details>
        ))}
      </div>
    </section>
  );
}
