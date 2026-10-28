import {
  addDays,
  addMonths,
  calendarFilePath,
  calendarMonths,
  datePart,
  datesInMonth,
  formatDate,
  formatMonth,
  formatTime,
  monthOf,
  todayIn,
  variantPath,
  WEEKDAYS,
  weekdayName,
  weekdayOf,
} from "@goodfellow-cms/core";
import { Disclosure, NativeLink, SiteText, TEXT, useNativeSite, useWide } from "@goodfellow-cms/expo";
import { View } from "react-native";
import type { AddToCalendarProps } from "./calendar.js";
import {
  type CalendarItem,
  type CalendarProps,
  calendarShows,
  entryCalendarItem,
  googleCalendarLink,
  lastDate,
  outlookLink,
  timeText,
} from "./calendar-data.js";

function Link({ href, children }: { href: string; children: string }) {
  const { colors } = useNativeSite().theme;
  return (
    <NativeLink href={href}>
      <SiteText style={{ color: colors.primary, fontSize: TEXT.sm }}>{children}</SiteText>
    </NativeLink>
  );
}

/** Links that add an event to visitors' calendars. */
function AddLinks({ item, label, otherLabel }: { item: CalendarItem; label: string; otherLabel: string }) {
  const site = useNativeSite();
  const { settings } = site;
  if (!label) return null;
  return (
    <Disclosure summary={<SiteText style={{ color: site.theme.colors.primary, fontSize: TEXT.sm }}>{label}</SiteText>}>
      <View style={{ gap: 6, paddingLeft: 12, borderLeftWidth: 2, borderColor: site.theme.colors.border }}>
        <Link href={googleCalendarLink(item, settings, settings.url)}>Google Calendar</Link>
        <Link href={outlookLink(item, settings)}>Outlook.com</Link>
        {item.file && otherLabel ? <Link href={site.address(item.file)}>{otherLabel}</Link> : null}
      </View>
    </Disclosure>
  );
}

/** Links that keep a visitor's calendar up to date with a collection's. */
function SubscribeLinks({ collection, label, otherLabel }: { collection: string; label: string; otherLabel: string }) {
  const site = useNativeSite();
  if (!label) return null;
  const address = site.address(calendarFilePath(collection));
  const webcal = address.replace(/^https?:/, "webcal:");
  return (
    <Disclosure
      summary={<SiteText style={{ color: site.theme.colors.primary, fontSize: TEXT.sm }}>{label}</SiteText>}
      style={{ marginTop: 24 }}
    >
      <View style={{ gap: 6, paddingLeft: 12, borderLeftWidth: 2, borderColor: site.theme.colors.border }}>
        <Link href={`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`}>
          Google Calendar
        </Link>
        <Link href={webcal}>{otherLabel}</Link>
      </View>
    </Disclosure>
  );
}

function ItemTitle({ item }: { item: CalendarItem }) {
  return item.href ? (
    <NativeLink href={item.href}>
      <SiteText style={{ fontWeight: "500" }}>{item.title}</SiteText>
    </NativeLink>
  ) : (
    <SiteText style={{ fontWeight: "500" }}>{item.title}</SiteText>
  );
}

function ListView({ items, props }: { items: CalendarItem[]; props: CalendarProps }) {
  const site = useNativeSite();
  const language = site.settings.language;
  const byDate = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const date = datePart(item.start);
    byDate.set(date, [...(byDate.get(date) ?? []), item]);
  }
  return (
    <View style={{ gap: 24 }}>
      {[...byDate].map(([date, dayItems]) => (
        <View key={date} style={{ gap: 8 }}>
          <SiteText heading={2} style={{ fontFamily: site.theme.fonts.heading, fontSize: TEXT.lg, fontWeight: "600" }}>
            {formatDate(date, language)}
          </SiteText>
          {dayItems.map((item, index) => (
            <View
              key={item.key}
              style={{
                gap: 4,
                paddingVertical: 12,
                ...(index > 0 && { borderTopWidth: 1, borderColor: site.theme.colors.border }),
              }}
            >
              {timeText(item, language) ? <SiteText muted>{timeText(item, language)}</SiteText> : null}
              <ItemTitle item={item} />
              {item.place ? (
                <SiteText muted style={{ fontSize: TEXT.sm }}>
                  {item.place}
                </SiteText>
              ) : null}
              {item.summary ? (
                <SiteText muted numberOfLines={3} style={{ fontSize: TEXT.sm }}>
                  {item.summary}
                </SiteText>
              ) : null}
              {item.event ? (
                <AddLinks item={item} label={props.addLabel} otherLabel={props.otherCalendarsLabel} />
              ) : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function MonthView({
  month,
  items,
  props,
  today,
}: {
  month: string;
  items: CalendarItem[];
  props: CalendarProps & { id?: string };
  today: string;
}) {
  const site = useNativeSite();
  const wide = useWide("sm");
  const { colors, radius } = site.theme;
  const language = site.settings.language;
  const order = props.weekStart === "monday" ? WEEKDAYS : (["su", "mo", "tu", "we", "th", "fr", "sa"] as const);
  const dates = datesInMonth(month);
  const leading = order.indexOf(weekdayOf(dates[0] ?? `${month}-01`));

  // Only the block the page's other pages are for links to them, as on the web.
  const linked = site.view !== undefined && site.view.block === props.id;
  const page = linked && site.view ? site.view.path : site.path;
  const { before, after } = calendarMonths(props as unknown as Record<string, unknown>);
  const current = monthOf(today);
  const previous = addMonths(month, -1);
  const next = addMonths(month, 1);
  const hasPage = (candidate: string) =>
    linked && candidate >= addMonths(current, -before) && candidate <= addMonths(current, after);
  const linkTo = (candidate: string) => (candidate === current ? page : variantPath(page, candidate));

  const byDate = new Map<string, CalendarItem[]>();
  for (const item of items) {
    for (let date = datePart(item.start); date <= datePart(item.end ?? item.start); date = addDays(date, 1)) {
      if (date.startsWith(month)) byDate.set(date, [...(byDate.get(date) ?? []), item]);
      if (date > lastDate(month)) break;
    }
  }

  const day = (date: string) => {
    const dayItems = byDate.get(date) ?? [];
    return (
      <View
        key={date}
        style={{
          flex: wide ? 1 : undefined,
          minHeight: wide ? 88 : undefined,
          gap: 4,
          padding: 8,
          backgroundColor: colors.background,
          ...(date === today && { borderWidth: 2, borderColor: colors.primary }),
        }}
      >
        <SiteText style={{ fontSize: TEXT.sm, fontWeight: "600" }}>
          {wide ? String(Number(date.slice(8))) : formatDate(date, language)}
        </SiteText>
        {dayItems.map((item) => (
          <View key={item.key} style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
            {!item.allDay && datePart(item.start) === date ? (
              <SiteText muted style={{ fontSize: TEXT.sm }}>
                {formatTime(item.start, language)}
              </SiteText>
            ) : null}
            <ItemTitle item={item} />
          </View>
        ))}
      </View>
    );
  };

  const cells = [...Array.from({ length: leading }, () => undefined), ...dates];
  while (cells.length % 7 !== 0) cells.push(undefined);
  const weeks = Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));

  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
        <View style={{ flex: 1, alignItems: "flex-start" }}>
          {hasPage(previous) ? <Link href={linkTo(previous)}>{`← ${formatMonth(previous, language)}`}</Link> : null}
        </View>
        <SiteText
          heading={2}
          style={{ fontFamily: site.theme.fonts.heading, fontSize: TEXT["2xl"], fontWeight: "700" }}
        >
          {formatMonth(month, language)}
        </SiteText>
        <View style={{ flex: 1, alignItems: "flex-end" }}>
          {hasPage(next) ? <Link href={linkTo(next)}>{`${formatMonth(next, language)} →`}</Link> : null}
        </View>
      </View>
      {wide ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius,
            overflow: "hidden",
            gap: 1,
            backgroundColor: colors.border,
          }}
        >
          <View style={{ flexDirection: "row", gap: 1, backgroundColor: colors.background }} accessible={false}>
            {order.map((name) => (
              <SiteText
                key={name}
                muted
                style={{ flex: 1, textAlign: "center", fontSize: TEXT.sm, paddingVertical: 4 }}
              >
                {weekdayName(name, language)}
              </SiteText>
            ))}
          </View>
          {weeks.map((week, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: weeks are only where the days fall
            <View key={index} style={{ flexDirection: "row", gap: 1 }}>
              {week.map((date, at) =>
                date ? (
                  day(date)
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: as above
                  <View key={`blank-${at}`} style={{ flex: 1, backgroundColor: colors.muted }} />
                ),
              )}
            </View>
          ))}
        </View>
      ) : (
        // On phones, only the days with something on, as on the web.
        <View style={{ gap: 1, backgroundColor: colors.border, borderRadius: radius, overflow: "hidden" }}>
          {dates.filter((date) => byDate.has(date)).map(day)}
        </View>
      )}
      {byDate.size === 0 && props.emptyText ? <SiteText muted>{props.emptyText}</SiteText> : null}
    </View>
  );
}

/** Upcoming events, as a list or a month at a time, from a calendar collection and another calendar the build read. */
export function Calendar(props: CalendarProps & { id?: string }) {
  const site = useNativeSite();
  const today = todayIn(site.settings.timeZone);
  const collection = site.collections.find((candidate) => candidate.id === props.collection);
  if (!collection?.settings.calendar && !props.feed) return null;
  const pageMonth = site.view && site.view.block === props.id ? site.view.month : undefined;
  const shown = calendarShows(props, collection, today, pageMonth);
  const items = !shown.month && props.limit > 0 ? shown.items.slice(0, props.limit) : shown.items;
  return (
    <View>
      {shown.month ? (
        <MonthView month={shown.month} items={items} props={props} today={today} />
      ) : items.length > 0 ? (
        <ListView items={items} props={props} />
      ) : props.emptyText ? (
        <SiteText muted>{props.emptyText}</SiteText>
      ) : null}
      {collection?.settings.calendar ? (
        <SubscribeLinks
          collection={collection.id}
          label={props.subscribeLabel}
          otherLabel={props.otherCalendarsLabel}
        />
      ) : null}
    </View>
  );
}

/** Links that add the item's event to visitors' calendars, on its page. */
export function AddToCalendar({ addLabel, otherCalendarsLabel }: AddToCalendarProps) {
  const { collection, entry } = useNativeSite();
  if (!collection || !entry) return null;
  const item = entryCalendarItem(collection, entry);
  return item ? <AddLinks item={item} label={addLabel} otherLabel={otherCalendarsLabel} /> : null;
}
