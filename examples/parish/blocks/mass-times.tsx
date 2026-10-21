import { classNameField, cx } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";

export interface MassTime {
  day: string;
  time: string;
  note: string;
}

export interface MassTimesProps {
  title: string;
  times: MassTime[];
  className: string;
}

/** A list of Mass (or confession) times, each with a day, a time and an optional note. */
export const MassTimes: ComponentConfig<MassTimesProps> = {
  label: "Mass times",
  fields: {
    title: { type: "text", label: "Heading", contentEditable: true },
    times: {
      type: "array",
      label: "Times",
      arrayFields: {
        day: { type: "text", label: "Day", placeholder: "Sunday" },
        time: { type: "text", label: "Time", placeholder: "10:30 am" },
        note: { type: "text", label: "Note (optional)", placeholder: "Spanish, livestreamed…" },
      },
      defaultItemProps: { day: "Sunday", time: "10:30 am", note: "" },
      getItemSummary: (item) => [item.day, item.time].filter(Boolean).join(", ") || "New time",
    },
    className: classNameField,
  },
  defaultProps: {
    title: "Sunday Masses",
    times: [
      { day: "Saturday", time: "5:00 pm", note: "Vigil" },
      { day: "Sunday", time: "10:30 am", note: "" },
    ],
    className: "",
  },
  render: ({ title, times, className }) => (
    <div className={cx("rounded-lg border border-border bg-background p-6 text-foreground", className)}>
      {title && <h2 className="font-heading text-2xl font-semibold">{title}</h2>}
      <dl className="mt-4 divide-y divide-border">
        {times.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: times have no ids, and can repeat
          <div key={index} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
            <dt className="font-medium">{item.day}</dt>
            <dd className="text-right">
              {item.time}
              {item.note && <span className="block text-sm text-muted-foreground">{item.note}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  ),
};
