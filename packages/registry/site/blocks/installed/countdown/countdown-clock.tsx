"use client";

import { useEffect, useState } from "react";

/** Runs with Preact as well as React, so sites whose Client Components all do load Preact instead (see Islands). */
export const worksWithPreact = true;

interface Words {
  days: string;
  hours: string;
  minutes: string;
  seconds: string;
}

const UNITS = ["days", "hours", "minutes", "seconds"] as const;

function left(until: number, now: number): Record<(typeof UNITS)[number], number> | undefined {
  const seconds = Math.floor((until - now) / 1000);
  if (seconds <= 0) return undefined;
  return {
    days: Math.floor(seconds / 86_400),
    hours: Math.floor(seconds / 3600) % 24,
    minutes: Math.floor(seconds / 60) % 60,
    seconds: seconds % 60,
  };
}

/**
 * The time left, counting down each second once the page has loaded. Before
 * then, and for visitors without JavaScript, it shows when the moment is,
 * which screen readers always read in place of the ticking numbers.
 */
export function CountdownClock({
  until,
  when,
  iso,
  finished,
  words,
  classes,
}: {
  until: number;
  when: string;
  iso: string;
  finished: string;
  words: Words;
  classes: { when: string; units: string; unit: string; number: string; label: string; finished: string };
}) {
  const [now, setNow] = useState<number | undefined>(undefined);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const time = (
    <time dateTime={iso} className={now === undefined ? classes.when : "sr-only"}>
      {when}
    </time>
  );
  if (now === undefined) return time;
  const remaining = left(until, now);
  if (!remaining) return <p className={classes.finished}>{finished}</p>;
  return (
    <>
      {time}
      <div aria-hidden="true" className={classes.units}>
        {UNITS.map((unit) => (
          <div key={unit} className={classes.unit}>
            <span className={classes.number}>{String(remaining[unit]).padStart(unit === "days" ? 1 : 2, "0")}</span>
            <span className={classes.label}>{words[unit]}</span>
          </div>
        ))}
      </div>
    </>
  );
}
