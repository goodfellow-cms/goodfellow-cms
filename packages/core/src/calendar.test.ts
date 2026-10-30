import { describe, expect, it } from "vitest";
import {
  addMonths,
  cleanEventValue,
  datesInMonth,
  eventValueProblem,
  formatOccurrence,
  isTimeZone,
  isUpcoming,
  monthsAround,
  occurrences,
  shownOccurrence,
  todayIn,
  wallClock,
  weekdayOf,
  zonedInstant,
  zonedTime,
} from "./calendar.js";

const starts = (event: Parameters<typeof occurrences>[0], from: string, to: string) =>
  occurrences(event, { from, to }).map((occurrence) => occurrence.start);

describe("event values", () => {
  it("reads dates and times, and rejects ones that don't exist", () => {
    expect(wallClock("2026-12-24")).toBe(Date.UTC(2026, 11, 24));
    expect(wallClock("2026-12-24T19:30")).toBe(Date.UTC(2026, 11, 24, 19, 30));
    expect(wallClock("2026-02-30")).toBeUndefined();
    expect(wallClock("2026-12-24T25:00")).toBeUndefined();
    expect(wallClock("24/12/2026")).toBeUndefined();
  });

  it("say what's wrong with them", () => {
    expect(eventValueProblem({ start: "2026-12-24T19:00", end: "2026-12-24T21:00" })).toBeUndefined();
    expect(eventValueProblem("2026-12-24")).toBe("must have a start date");
    expect(eventValueProblem({ start: "soon" })).toMatch(/must start on a date/);
    expect(eventValueProblem({ start: "2026-12-24T19:00", end: "2026-12-24T18:00" })).toBe("must end after it starts");
    expect(eventValueProblem({ start: "2026-12-24", end: "2026-12-25T10:00" })).toMatch(/written the same way/);
    expect(eventValueProblem({ start: "2026-12-24", repeat: { every: "fortnight" } })).toMatch(/every day/);
    expect(eventValueProblem({ start: "2026-12-24", repeat: { every: "week", days: ["monday"] } })).toMatch(/mo, tu/);
    expect(eventValueProblem({ start: "2026-12-24", repeat: { every: "week", skip: ["Christmas"] } })).toMatch(/skip/);
    expect(eventValueProblem({ start: "2026-12-24T19:00", repeat: { every: "week", until: "2026-12-01" } })).toBe(
      "must stop repeating on or after the day it starts",
    );
    expect(eventValueProblem({ start: "2026-12-24T19:00", repeat: { every: "week", until: "2026-12-24" } })).toBe(
      undefined,
    );
  });

  it("show a daily event that started long ago on its next day, however long ago", () => {
    const prayer = { start: "1901-01-01T07:00", repeat: { every: "day" as const } };
    expect(shownOccurrence(prayer, "2026-10-10")?.start).toBe("2026-10-10T07:00");
    // Every third day from its start, still.
    const every3 = { start: "1901-01-01", repeat: { every: "day" as const, interval: 3 } };
    const [next] = occurrences(every3, { from: "2026-10-10", to: "2026-12-31", limit: 1 });
    const days = ((wallClock(next?.start ?? "") ?? 0) - (wallClock("1901-01-01") ?? 0)) / 86_400_000;
    expect(days % 3).toBe(0);
    expect(next?.start.slice(0, 7)).toBe("2026-10");
  });

  it("are tidied before they're saved", () => {
    expect(
      cleanEventValue({
        start: "2026-10-04T09:00",
        end: "2026-10-04T09:00",
        repeat: { every: "week", interval: 1, days: ["su", "we"], on: "weekday", skip: ["2026-12-27", "2026-12-27"] },
      }),
    ).toEqual({ start: "2026-10-04T09:00", repeat: { every: "week", days: ["we", "su"], skip: ["2026-12-27"] } });
  });
});

describe("occurrences", () => {
  it("finds a one-off event, and one still going on", () => {
    const festival = { start: "2026-10-09", end: "2026-10-11" };
    expect(occurrences(festival, { from: "2026-10-10", to: "2026-10-31" })).toEqual([
      { start: "2026-10-09", end: "2026-10-11", allDay: true },
    ]);
    expect(occurrences(festival, { from: "2026-10-12", to: "2026-10-31" })).toEqual([]);
  });

  it("finds nothing between dates that don't exist, rather than going on forever", () => {
    expect(
      occurrences({ start: "2026-10-04", repeat: { every: "week" } }, { from: "2026-11-01", to: "2026-11-31" }),
    ).toEqual([]);
  });

  it("repeats weekly on chosen days, skipping dates, until a date", () => {
    const mass = {
      start: "2026-10-04T09:00",
      end: "2026-10-04T10:00",
      repeat: {
        every: "week" as const,
        days: ["we" as const, "su" as const],
        skip: ["2026-10-14"],
        until: "2026-10-25",
      },
    };
    expect(starts(mass, "2026-10-01", "2026-12-31")).toEqual([
      "2026-10-04T09:00",
      "2026-10-07T09:00",
      "2026-10-11T09:00",
      "2026-10-18T09:00",
      "2026-10-21T09:00",
      "2026-10-25T09:00",
    ]);
    expect(occurrences(mass, { from: "2026-10-05", to: "2026-12-31", limit: 1 })).toEqual([
      { start: "2026-10-07T09:00", end: "2026-10-07T10:00", allDay: false },
    ]);
  });

  it("repeats every other week, and every few days", () => {
    expect(starts({ start: "2026-10-01", repeat: { every: "week", interval: 2 } }, "2026-10-01", "2026-11-15")).toEqual(
      ["2026-10-01", "2026-10-15", "2026-10-29", "2026-11-12"],
    );
    expect(starts({ start: "2026-10-30", repeat: { every: "day", interval: 3 } }, "2026-11-01", "2026-11-07")).toEqual([
      "2026-11-02",
      "2026-11-05",
    ]);
  });

  it("repeats monthly on a date, a weekday of the month, or the last such weekday", () => {
    expect(starts({ start: "2026-01-31", repeat: { every: "month" } }, "2026-01-01", "2026-05-31")).toEqual([
      "2026-01-31",
      "2026-03-31",
      "2026-05-31",
    ]);
    // The second Tuesday.
    expect(
      starts({ start: "2026-10-13T19:00", repeat: { every: "month", on: "weekday" } }, "2026-10-01", "2027-01-31"),
    ).toEqual(["2026-10-13T19:00", "2026-11-10T19:00", "2026-12-08T19:00", "2027-01-12T19:00"]);
    // The last Friday.
    expect(starts({ start: "2026-10-30", repeat: { every: "month", on: "last" } }, "2026-10-01", "2027-01-31")).toEqual(
      ["2026-10-30", "2026-11-27", "2026-12-25", "2027-01-29"],
    );
  });

  it("repeats yearly, with February 29 only in leap years", () => {
    expect(starts({ start: "2024-02-29", repeat: { every: "year" } }, "2024-01-01", "2032-12-31")).toEqual([
      "2024-02-29",
      "2028-02-29",
      "2032-02-29",
    ]);
  });

  it("shows an event's next occurrence, or its first once none are left", () => {
    const weekly = { start: "2026-10-04T09:00", repeat: { every: "week" as const, until: "2026-10-18" } };
    expect(shownOccurrence(weekly, "2026-10-10")?.start).toBe("2026-10-11T09:00");
    expect(shownOccurrence(weekly, "2026-11-01")?.start).toBe("2026-10-04T09:00");
    expect(isUpcoming(weekly, "2026-10-18")).toBe(true);
    expect(isUpcoming(weekly, "2026-10-19")).toBe(false);
    expect(shownOccurrence({ start: "2025-01-01" }, "2026-01-01")?.start).toBe("2025-01-01");
  });

  it("are written out in the site's language", () => {
    expect(formatOccurrence({ start: "2026-12-24T19:00", end: "2026-12-24T21:00", allDay: false })).toBe(
      "Thursday, December 24, 2026, 7:00 PM – 9:00 PM",
    );
    expect(formatOccurrence({ start: "2026-12-24", end: "2026-12-26", allDay: true })).toBe(
      "Thursday, December 24, 2026 – Saturday, December 26, 2026",
    );
    expect(formatOccurrence({ start: "2026-12-24", allDay: true }, "fr")).toBe("jeudi 24 décembre 2026");
  });
});

describe("time zones", () => {
  it("turn wall-clock times into instants and back, across daylight saving changes", () => {
    expect(isTimeZone("America/New_York")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(zonedInstant("2026-07-01T09:00", "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedInstant("2026-12-01T09:00", "America/New_York").toISOString()).toBe("2026-12-01T14:00:00.000Z");
    // 2:30 doesn't exist on the day the clocks go forward.
    expect(zonedInstant("2026-03-08T02:30", "America/New_York").toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(zonedTime(new Date("2026-07-01T13:00:00Z"), "America/New_York")).toBe("2026-07-01T09:00");
    expect(zonedTime(new Date("2026-07-01T13:00:00Z"), undefined)).toBe("2026-07-01T13:00");
    expect(todayIn("Pacific/Auckland", new Date("2026-10-10T20:00:00Z"))).toBe("2026-10-11");
  });
});

describe("months", () => {
  it("are counted and listed", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthsAround("2026-10-10", 1, 2)).toEqual(["2026-09", "2026-10", "2026-11", "2026-12"]);
    expect(datesInMonth("2028-02")).toHaveLength(29);
    expect(weekdayOf("2026-10-11")).toBe("su");
  });
});
