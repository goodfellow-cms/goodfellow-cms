import { changesOn, isTimeZone, zonedInstant } from "@goodfellow-cms/core";
import { classNameField, useParts, useSite, withKeywords, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { CountdownClock } from "./countdown-clock";

export interface CountdownProps {
  heading: string;
  /** The day, as `YYYY-MM-DD`, and the time, as `HH:MM`, in the site's time zone. */
  date: string;
  time: string;
  /** What it says once the moment has come. */
  finished: string;
  words: { days: string; hours: string; minutes: string; seconds: string };
  className: string;
}

/** The moment, as an instant, from the day and time in the site's time zone, if they're ones. */
export function countdownInstant(date: string, time: string, timeZone: string | undefined): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return undefined;
  const clock = time.trim() || "00:00";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) return undefined;
  const instant = zonedInstant(`${date.trim()}T${clock}`, timeZone);
  return Number.isNaN(instant.getTime()) ? undefined : instant;
}

function whenText(instant: Date, language: string | undefined, timeZone: string | undefined): string {
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "full",
    timeStyle: "short",
    ...(timeZone && isTimeZone(timeZone) && { timeZone }),
  };
  try {
    return new Intl.DateTimeFormat(language || "en", options).format(instant);
  } catch {
    return new Intl.DateTimeFormat("en", options).format(instant);
  }
}

function CountdownView({
  heading,
  date,
  time,
  finished,
  words,
  className,
  puck,
}: CountdownProps & { puck?: { isEditing?: boolean } }) {
  const part = useParts();
  const { settings } = useSite();
  const instant = countdownInstant(date ?? "", time ?? "", settings.timeZone);
  if (!instant) {
    if (!puck?.isEditing) return null;
    return (
      <div className={part("gf-countdown", "rounded-lg bg-muted p-6 text-center text-muted-foreground", className)}>
        {date?.trim()
          ? "The day must be written as 2027-12-24, and the time as 18:00."
          : "Choose the day to count down to."}
      </div>
    );
  }
  // Pages are built again on the day, so once it has passed they say what's chosen without JavaScript too.
  changesOn(date.trim());
  const past = instant.getTime() <= Date.now();
  const finishedClass = part("gf-countdown-finished", "font-heading text-2xl font-semibold text-primary");
  return (
    <section className={part("gf-countdown", "flex w-full flex-col items-center gap-4 text-center", className)}>
      {heading && <h2 className={part("gf-countdown-heading", "font-heading text-3xl font-semibold")}>{heading}</h2>}
      {past ? (
        <p className={finishedClass}>{finished}</p>
      ) : (
        <CountdownClock
          until={instant.getTime()}
          iso={instant.toISOString()}
          when={whenText(instant, settings.language, settings.timeZone)}
          finished={finished}
          words={words}
          classes={{
            when: part("gf-countdown-when", "text-lg text-muted-foreground"),
            units: part("gf-countdown-units", "flex flex-wrap justify-center gap-3"),
            unit: part(
              "gf-countdown-unit",
              "flex min-w-20 flex-col items-center rounded-lg border border-border bg-card px-4 py-3 text-card-foreground",
            ),
            number: part("gf-countdown-number", "font-heading text-4xl font-bold tabular-nums"),
            label: part("gf-countdown-label", "text-sm text-muted-foreground"),
            finished: finishedClass,
          }}
        />
      )}
    </section>
  );
}

/**
 * The days, hours, minutes and seconds until a moment, such as a festival or
 * an appeal's end, in the site's time zone. Without JavaScript it shows when
 * the moment is, and once it has come, what's chosen to say then.
 */
const Countdown: ComponentConfig<CountdownProps> = withParts(
  {
    label: "Countdown",
    fields: {
      heading: { type: "text", label: "Heading", contentEditable: true },
      date: { type: "text", label: "Day, such as 2027-12-24", placeholder: "2027-12-24" },
      time: { type: "text", label: "Time, such as 18:00, in the site's time zone", placeholder: "18:00" },
      finished: { type: "text", label: "What it says once the moment has come", contentEditable: true },
      words: {
        type: "object",
        label: "Words under the numbers",
        objectFields: {
          days: { type: "text", label: "Days" },
          hours: { type: "text", label: "Hours" },
          minutes: { type: "text", label: "Minutes" },
          seconds: { type: "text", label: "Seconds" },
        },
      },
      className: classNameField,
    },
    defaultProps: {
      heading: "Christmas is coming",
      date: "",
      time: "",
      finished: "It's here!",
      words: { days: "Days", hours: "Hours", minutes: "Minutes", seconds: "Seconds" },
      className: "",
    },
    render: (props) => <CountdownView {...props} />,
  },
  {
    "gf-countdown": "Countdown",
    "gf-countdown-heading": "Heading",
    "gf-countdown-when": "When, before it starts counting",
    "gf-countdown-units": "Numbers",
    "gf-countdown-unit": "Number with its word",
    "gf-countdown-number": "Number",
    "gf-countdown-label": "Word under the number",
    "gf-countdown-finished": "What it says once the moment has come",
  },
);

export default withKeywords(Countdown, ["countdown", "timer", "launch", "event", "days until", "clock"]);
