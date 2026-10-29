"use client";

import type { ReactNode } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

/** Runs with Preact as well as React, so sites whose Client Components all do load Preact instead (see Islands). */
export const worksWithPreact = true;

/**
 * The questions, one open at a time, with their parts' classes from the block.
 * Closed answers stay in the page, hidden, rather than being left out.
 */
export function FaqList({
  questions,
  classes,
}: {
  questions: Array<{ question: string; answer: ReactNode }>;
  classes: { question: string; trigger: string; answer: string };
}) {
  return (
    <Accordion type="single" collapsible className="w-full">
      {questions.map((item, index) => (
        <AccordionItem
          // biome-ignore lint/suspicious/noArrayIndexKey: questions have no ids of their own
          key={index}
          value={`question-${index}`}
          className={classes.question}
        >
          <AccordionTrigger className={classes.trigger}>{item.question}</AccordionTrigger>
          <AccordionContent forceMount>
            <div className={classes.answer}>{item.answer}</div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
