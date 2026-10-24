import { afterEach, describe, expect, it } from "vitest";
import {
  changesOn,
  nextDateChange,
  onDateChange,
  parseBuildRecord,
  resetDateChanges,
  serializeBuildRecord,
} from "./build-record.js";
import { isUpcoming, monthsAround, shownOccurrence } from "./calendar.js";

afterEach(() => resetDateChanges());

describe("build records", () => {
  it("are written with a stable key order, and read back only when they're one", () => {
    const text = serializeBuildRecord({
      currentUntil: "2026-11-02T00:00:00.000Z",
      builtAt: "2026-11-01T04:17:00.000Z",
      commit: "a".repeat(40),
      goodfellow: "1.2.3",
      version: 1,
    });
    expect(text).toBe(
      `{\n  "version": 1,\n  "goodfellow": "1.2.3",\n  "commit": "${"a".repeat(40)}",\n  "builtAt": "2026-11-01T04:17:00.000Z",\n  "currentUntil": "2026-11-02T00:00:00.000Z"\n}\n`,
    );
    expect(parseBuildRecord(text)?.currentUntil).toBe("2026-11-02T00:00:00.000Z");
    expect(parseBuildRecord("<!doctype html>")).toBeUndefined();
    expect(parseBuildRecord(JSON.stringify({ version: 2 }))).toBeUndefined();
  });
});

describe("date changes", () => {
  it("keep the earliest date reported, and tell listeners about each new one", () => {
    const heard: string[] = [];
    const stop = onDateChange((date) => heard.push(date));
    changesOn("2026-12-01");
    changesOn("2026-11-05");
    changesOn("2026-11-20");
    changesOn("not a date");
    changesOn(undefined);
    stop();
    changesOn("2026-11-01");
    expect(nextDateChange()).toBe("2026-11-01");
    expect(heard).toEqual(["2026-12-01", "2026-11-05"]);
    resetDateChanges();
    expect(nextDateChange()).toBeUndefined();
  });

  it("come from the calendar's own functions: an event's next time, whether it's still to come, and months", () => {
    const weekly = { start: "2026-11-01T09:00", end: "2026-11-01T10:00", repeat: { every: "week" as const } };
    expect(shownOccurrence(weekly, "2026-11-03")?.start).toBe("2026-11-08T09:00");
    // The one after shows the day after it's over.
    expect(nextDateChange()).toBe("2026-11-09");

    resetDateChanges();
    expect(isUpcoming({ start: "2026-11-20", end: "2026-11-22" }, "2026-11-03")).toBe(true);
    expect(nextDateChange()).toBe("2026-11-23");

    resetDateChanges();
    // An event that's over, without repeats, never changes what's shown.
    shownOccurrence({ start: "2026-10-01T09:00" }, "2026-11-03");
    expect(isUpcoming({ start: "2026-10-01T09:00" }, "2026-11-03")).toBe(false);
    expect(nextDateChange()).toBeUndefined();

    monthsAround("2026-11-03", 1, 2);
    expect(nextDateChange()).toBe("2026-12-01");
  });
});
