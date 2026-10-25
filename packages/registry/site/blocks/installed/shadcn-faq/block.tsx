import { classNameField, useParts, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig, RichText } from "@puckeditor/core";
import { FaqList } from "./faq-list";

interface Question {
  question: string;
  answer: RichText;
}

export interface FaqProps {
  title: string;
  questions: Question[];
  className: string;
}

/** Questions that open to show their answers. Every answer is in the page, so search engines see them. */
const Faq: ComponentConfig<FaqProps> = withParts(
  {
    label: "FAQ",
    fields: {
      title: { type: "text", label: "Heading" },
      questions: {
        type: "array",
        label: "Questions",
        arrayFields: {
          question: { type: "text", label: "Question" },
          answer: { type: "richtext", label: "Answer" },
        },
        defaultItemProps: { question: "A question", answer: "<p>Its answer.</p>" },
        getItemSummary: (item) => item.question || "Question",
      },
      className: classNameField,
    },
    defaultProps: {
      title: "Questions and answers",
      questions: [
        { question: "A question people ask", answer: "<p>Its answer.</p>" },
        { question: "Another question", answer: "<p>Its answer.</p>" },
      ],
      className: "",
    },
    render: ({ title, questions, className }) => {
      const part = useParts();
      return (
        <section className={part("gf-shadcn-faq", "mx-auto w-full max-w-3xl px-4 py-12", className)}>
          {title && (
            <h2 className={part("gf-shadcn-faq-heading", "mb-6 text-3xl font-bold tracking-tight")}>{title}</h2>
          )}
          <FaqList
            questions={questions.map(({ question, answer }) => ({ question, answer }))}
            classes={{
              question: part(
                "gf-shadcn-faq-question",
                undefined,
                "[&>[data-slot=accordion-content][data-state=closed]]:hidden",
              ),
              trigger: part("gf-shadcn-faq-trigger", "text-base"),
              answer: part("gf-shadcn-faq-answer", "gf-prose"),
            }}
          />
        </section>
      );
    },
  },
  {
    "gf-shadcn-faq": "Questions and answers",
    "gf-shadcn-faq-heading": "Heading",
    "gf-shadcn-faq-question": "Question and answer",
    "gf-shadcn-faq-trigger": "Question",
    "gf-shadcn-faq-answer": "Answer",
  },
);

export default Faq;
