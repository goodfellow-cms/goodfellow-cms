/**
 * What the FAQ block and its version for apps share, with no React: the
 * questions it shows, and what it tells search engines about them.
 */
import { richTextToPlainText, type StructuredData } from "@goodfellow-cms/core";

export interface FaqItem {
  question: string;
  /** Formatted text, as the editor's rich text writes it. */
  answer: string;
}

/** The questions an FAQ shows: those with a question, in its order. */
export function faqItems(items: unknown): FaqItem[] {
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { question, answer } = item as Partial<FaqItem>;
    return typeof question === "string" && question.trim()
      ? [{ question: question.trim(), answer: typeof answer === "string" ? answer : "" }]
      : [];
  });
}

/** schema.org's `FAQPage` for an FAQ's questions, with their answers as plain text, or nothing without any. */
export function faqStructuredData(items: unknown): StructuredData | undefined {
  const questions = faqItems(items).flatMap(({ question, answer }) => {
    const text = richTextToPlainText(answer);
    return text ? [{ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text } }] : [];
  });
  return questions.length > 0 ? { "@type": "FAQPage", mainEntity: questions } : undefined;
}
