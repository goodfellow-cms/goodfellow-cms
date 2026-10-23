import {
  type FileChange,
  type RepositoryVisibility,
  type Schedule,
  type ScheduledBuilds,
  type ScheduledBuildTiming,
  type SiteContent,
  scheduleProblem,
  scheduleState,
  upcomingChanges,
  wallClock,
} from "@goodfellow-cms/core";
import { useEffect, useState } from "react";
import { useAdmin } from "./admin-context.js";
import { siteSettingsFileChange } from "./changes.js";
import { entryEditorHref, pageEditorHref } from "./router.js";
import { type StringKey, useStrings } from "./strings.js";
import { Field } from "./ui.js";

/** The computer's own time zone, which a site without one takes when something is first scheduled. */
function computerTimeZone(): string | undefined {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
}

/** The time zone schedules are in: the site's, or the computer's, which `scheduleSettingsChanges()` gives it. */
export function scheduleTimeZone(content: SiteContent): string | undefined {
  return content.settings.timeZone ?? computerTimeZone();
}

/**
 * The change to the site's settings a schedule needs, if any: the computer's
 * time zone, for a site without one, so times mean what the editor meant.
 */
export function scheduleSettingsChanges(content: SiteContent, schedule: Schedule): FileChange[] {
  const zone = computerTimeZone();
  if (content.settings.timeZone || !zone || !(schedule.showFrom || schedule.hideAfter)) return [];
  return [siteSettingsFileChange({ ...content.settings, timeZone: zone })];
}

/** A scheduled time as people read it, in the site's language: "29 Nov 2026, 09:00". */
export function formatScheduleTime(time: string, language: string): string {
  const ms = wallClock(time);
  if (ms === undefined) return time;
  const options = { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" } as const;
  try {
    return new Intl.DateTimeFormat(language, options).format(new Date(ms));
  } catch {
    return new Intl.DateTimeFormat("en", options).format(new Date(ms));
  }
}

interface ScheduleInfo {
  timing?: ScheduledBuildTiming;
  visibility?: RepositoryVisibility;
}

const infoCache = new WeakMap<object, Promise<ScheduleInfo>>();

/** When scheduled changes go live on this site, and who can read the repository, once the backend has said. */
export function useScheduleInfo(): ScheduleInfo {
  const { scheduledBuilds, repositoryVisibility } = useAdmin();
  return useScheduleInfoOf(scheduledBuilds, repositoryVisibility);
}

/** `useScheduleInfo()` for a backend's own. */
export function useScheduleInfoOf(
  scheduledBuilds: Pick<ScheduledBuilds, "timing"> | undefined,
  repositoryVisibility: (() => Promise<RepositoryVisibility>) | undefined,
): ScheduleInfo {
  const [info, setInfo] = useState<ScheduleInfo>({});
  useEffect(() => {
    if (!scheduledBuilds && !repositoryVisibility) return;
    const key = (scheduledBuilds ?? repositoryVisibility) as object;
    let found = infoCache.get(key);
    if (!found) {
      found = Promise.all([
        scheduledBuilds?.timing().catch(() => undefined),
        repositoryVisibility?.().catch(() => undefined),
      ]).then(([timing, visibility]) => ({
        ...(timing && { timing }),
        ...(visibility && { visibility }),
      }));
      infoCache.set(key, found);
    }
    let cancelled = false;
    void found.then((next) => {
      if (!cancelled) setInfo(next);
    });
    return () => {
      cancelled = true;
    };
  }, [scheduledBuilds, repositoryVisibility]);
  return info;
}

const TIMING: Record<ScheduledBuildTiming, StringKey> = {
  exact: "schedule.timing.exact",
  hourly: "schedule.timing.hourly",
  nightly: "schedule.timing.nightly",
  none: "schedule.timing.none",
};

/** When scheduled changes go live, and, where the repository can be read by others, that scheduled content can be too. */
export function ScheduleNotes() {
  const t = useStrings();
  const { account, scheduleSyncProblem } = useAdmin();
  const { timing, visibility } = useScheduleInfo();
  const host = account?.hostName ?? "";
  return (
    <>
      {timing && (
        <p className="gfa-hint">
          {t(scheduleSyncProblem === "not-allowed" ? "schedule.timing.notAllowed" : TIMING[timing], { host })}
        </p>
      )}
      {(visibility === "public" || visibility === "internal") && (
        <p className="gfa-notice gfa-notice-warning" role="note">
          {t(visibility === "public" ? "schedule.public" : "schedule.internal", { host })}
        </p>
      )}
    </>
  );
}

/** Two date and time fields, for when something is shown and hidden again, in the site's time zone. */
export function ScheduleFields({
  value,
  onChange,
  content,
  showErrors = true,
}: {
  value: Schedule;
  onChange: (value: Schedule) => void;
  content: SiteContent;
  showErrors?: boolean;
}) {
  const t = useStrings();
  const problem = showErrors ? scheduleProblem(value) : undefined;
  const zone = scheduleTimeZone(content);
  const set = (key: keyof Schedule, time: string) => {
    const { [key]: _old, ...rest } = value;
    onChange(time ? { ...rest, [key]: time } : rest);
  };
  const zoneHint = !zone
    ? t("schedule.zoneNone")
    : t(content.settings.timeZone ? "schedule.zone" : "schedule.zoneNew", { zone: zone.replace(/_/g, " ") });
  return (
    <fieldset className="gfa-schedule">
      <legend className="gfa-label">{t("schedule.title")}</legend>
      <div className="gfa-schedule-times">
        <Field label={t("schedule.showFrom")} hint={t("schedule.showFromHint")}>
          {(props) => (
            <input
              {...props}
              type="datetime-local"
              className="gfa-input"
              value={value.showFrom ?? ""}
              onChange={(event) => set("showFrom", event.target.value)}
            />
          )}
        </Field>
        <Field
          label={t("schedule.hideAfter")}
          hint={t("schedule.hideAfterHint")}
          error={problem ? t(problem === "order" ? "schedule.order" : "schedule.invalid") : undefined}
        >
          {(props) => (
            <input
              {...props}
              type="datetime-local"
              className="gfa-input"
              value={value.hideAfter ?? ""}
              onChange={(event) => set("hideAfter", event.target.value)}
            />
          )}
        </Field>
      </div>
      <p className="gfa-hint">{zoneHint}</p>
      {(value.showFrom || value.hideAfter) && <ScheduleNotes />}
    </fieldset>
  );
}

/** Whether a page or item is on the site now, for lists: nothing for one that's shown with nothing to come. */
export function ScheduleStatus({ schedule, content }: { schedule: Schedule; content: SiteContent }) {
  const t = useStrings();
  const { language, timeZone } = content.settings;
  const state = scheduleState(schedule, new Date(), timeZone);
  const time = (value: string) => formatScheduleTime(value, language);
  if (state === "waiting" && schedule.showFrom) {
    return (
      <span className="gfa-schedule-status">{t("schedule.status.waiting", { time: time(schedule.showFrom) })}</span>
    );
  }
  if (state === "hidden" && schedule.hideAfter) {
    return (
      <span className="gfa-schedule-status">{t("schedule.status.hidden", { time: time(schedule.hideAfter) })}</span>
    );
  }
  if (schedule.hideAfter) {
    return (
      <span className="gfa-schedule-status">{t("schedule.status.hides", { time: time(schedule.hideAfter) })}</span>
    );
  }
  return null;
}

/** What the site's schedules show and hide next, soonest first, with when it goes live. */
export function ComingUp({ content }: { content: SiteContent }) {
  const t = useStrings();
  const upcoming = upcomingChanges(content);
  if (upcoming.length === 0) return null;
  const { language, timeZone } = content.settings;
  return (
    <section className="gfa-coming-up" aria-labelledby="gfa-coming-up-title">
      <h2 id="gfa-coming-up-title" className="gfa-section-title">
        {t("comingUp.title")}
      </h2>
      <ul>
        {upcoming.map((change) => {
          const href = change.entry
            ? entryEditorHref(change.entry.collection, change.entry.slug)
            : change.path
              ? pageEditorHref(change.path)
              : undefined;
          const collection = change.entry && content.collections.find((item) => item.id === change.entry?.collection);
          return (
            <li key={`${change.file} ${change.kind}`}>
              <time dateTime={change.at.toISOString()}>{formatScheduleTime(change.time, language)}</time>
              <span className="gfa-coming-up-kind">
                {t(change.kind === "show" ? "comingUp.show" : "comingUp.hide")}
              </span>
              {href ? <a href={href}>{change.title}</a> : change.title}
              {collection && <span className="gfa-hint">{collection.settings.name}</span>}
            </li>
          );
        })}
      </ul>
      <p className="gfa-hint">{t("comingUp.zone", { zone: (timeZone ?? "UTC").replace(/_/g, " ") })}</p>
      <ScheduleNotes />
    </section>
  );
}
