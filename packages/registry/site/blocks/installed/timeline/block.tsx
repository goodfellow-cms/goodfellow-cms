import { classNameField, useParts, withKeywords, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";

interface Moment {
  when: string;
  title: string;
  text: string;
}

export interface TimelineProps {
  heading: string;
  moments: Moment[];
  className: string;
}

/** Moments in order down a line, such as an organization's history or the steps of a plan. */
const Timeline: ComponentConfig<TimelineProps> = withParts(
  {
    label: "Timeline",
    fields: {
      heading: { type: "text", label: "Heading", contentEditable: true },
      moments: {
        type: "array",
        label: "Moments",
        arrayFields: {
          when: { type: "text", label: "When, such as 1902 or Spring 2027" },
          title: { type: "text", label: "Title" },
          text: { type: "textarea", label: "What happened" },
        },
        defaultItemProps: { when: "", title: "What happened", text: "" },
        getItemSummary: (moment) => [moment.when, moment.title].filter(Boolean).join(": ") || "Moment",
      },
      className: classNameField,
    },
    defaultProps: {
      heading: "Our history",
      moments: [
        { when: "1902", title: "The first church is built", text: "" },
        { when: "1958", title: "The school opens", text: "" },
        { when: "2002", title: "A hundred years", text: "" },
      ],
      className: "",
    },
    render: ({ heading, moments, className }) => {
      const part = useParts();
      const Title = heading ? "h3" : "h2";
      return (
        <section className={part("gf-timeline", "w-full", className)}>
          {heading && (
            <h2 className={part("gf-timeline-heading", "mb-8 font-heading text-3xl font-semibold")}>{heading}</h2>
          )}
          <ol className={part("gf-timeline-list", "relative space-y-8 border-l-2 border-border pl-8")}>
            {(moments ?? []).map((moment, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: moments can share a title
              <li key={index} className={part("gf-timeline-moment", "relative")}>
                <span
                  aria-hidden="true"
                  className={part(
                    "gf-timeline-dot",
                    "absolute top-1.5 -left-[2.5625rem] size-4 rounded-full border-2 border-background bg-primary",
                  )}
                />
                {moment.when && (
                  <p className={part("gf-timeline-when", "text-sm font-semibold text-primary")}>{moment.when}</p>
                )}
                <Title className={part("gf-timeline-title", "font-heading text-xl font-semibold")}>
                  {moment.title}
                </Title>
                {moment.text && (
                  <p className={part("gf-timeline-text", "mt-1 whitespace-pre-line text-muted-foreground")}>
                    {moment.text}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      );
    },
  },
  {
    "gf-timeline": "Timeline",
    "gf-timeline-heading": "Heading",
    "gf-timeline-list": "Line",
    "gf-timeline-moment": "Moment",
    "gf-timeline-dot": "Dot",
    "gf-timeline-when": "When",
    "gf-timeline-title": "Title",
    "gf-timeline-text": "What happened",
  },
);

export default withKeywords(Timeline, ["timeline", "history", "milestones", "steps", "events", "journey"]);
