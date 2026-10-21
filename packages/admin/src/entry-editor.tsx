import type { AiFieldHint } from "@goodfellow-cms/ai";
import {
  type Collection,
  type CollectionField,
  type Entry,
  entryTitle,
  eventValueProblem,
  findEntry,
  isEmptyValue,
  type Schedule,
  type SiteContent,
  type SiteSettings,
  scheduleOf,
  scheduleProblem,
} from "@goodfellow-cms/core";
import { applyEntry, type SiteContextValue, SiteProvider, siteMetadata } from "@goodfellow-cms/react";
import {
  AutoField,
  type Config,
  createUsePuck,
  type Data,
  type Field,
  FieldLabel,
  type Fields,
  legacySideBarPlugin,
  migrate,
  Render,
  resolveAllData,
} from "@puckeditor/core";
import { useEffect, useMemo, useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { entryFileChange, storedEntryFields } from "./changes.js";
import { CollectionLayout, inSentence } from "./collection-screen.js";
import { EventField } from "./event-field.js";
import { MarkdownField } from "./markdown-field.js";
import { MediaChooser } from "./media-library.js";
import { PuckEditor, SiteFrame } from "./puck-editor.js";
import { ScheduleFields, scheduleSettingsChanges } from "./schedule.js";
import { useStrings } from "./strings.js";
import { AppLink } from "./use-link.js";
import { VersionsLink } from "./versions-screen.js";

const usePuck = createUsePuck();
const entryPlugins = [legacySideBarPlugin()];
const entryUi = { leftSideBarVisible: false, plugin: { current: "ai" } };
/** The item editor's fields sidebar, wider than other editors', with its own remembered width. */
const ENTRY_SIDEBAR = { key: "goodfellow-entry-sidebar-width", width: 520 };

function Hint({ text }: { text?: string }) {
  return text ? <p className="gfa-puck-hint">{text}</p> : null;
}

/** The Puck field for one of a collection's fields, shown in the editor's sidebar. */
/** What the AI assistant is told a field holds, since it can't tell from a custom field. */
function aiHint(field: CollectionField, markdown: boolean): AiFieldHint {
  const description = field.hint;
  if (markdown) {
    return {
      type: "string",
      description: [description, "Formatted text, written in Markdown"].filter(Boolean).join(". "),
    };
  }
  switch (field.type) {
    case "number":
      return { type: "number", description };
    case "date":
      return { type: "date", description };
    case "select":
      return { type: "choice", options: field.options ?? [], description };
    case "tags":
      return { type: "choices", options: field.options ?? [], description };
    case "link":
      return {
        type: "string",
        description: [description, "A web address or a page address such as /about"].filter(Boolean).join(". "),
      };
    case "image":
      return {
        type: "string",
        description: [description, "An image address. Leave empty unless one is given"].filter(Boolean).join(". "),
      };
    default:
      return { type: "string", description };
  }
}

function puckField(field: CollectionField, collection: Collection, settings: SiteSettings): Field {
  const markdown = collection.settings.markdown?.body === field.name;
  const control = fieldControl(field, markdown, settings);
  // The assistant leaves events' dates and times alone: they're structured, and editors know them best.
  return field.type === "event" ? control : { ...control, metadata: { ai: aiHint(field, markdown) } };
}

function fieldControl(field: CollectionField, markdown: boolean, settings: SiteSettings): Field {
  const label = field.required ? `${field.label} *` : field.label;
  if (markdown) {
    return {
      type: "custom",
      label,
      render: ({ value, onChange, id }) => (
        <MarkdownField
          id={id}
          label={label}
          hint={field.hint}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
        />
      ),
    };
  }
  switch (field.type) {
    case "richtext":
      return { type: "richtext", label };
    case "select":
      return {
        type: "custom",
        label,
        render: ({ value, onChange, id }) => (
          <FieldLabel label={label}>
            <AutoField
              id={id}
              field={{ type: "select", options: [{ label: "", value: "" }, ...(field.options ?? [])] }}
              value={value ?? ""}
              onChange={onChange}
            />
            <Hint text={field.hint} />
          </FieldLabel>
        ),
      };
    case "number":
      return {
        type: "custom",
        label,
        render: ({ value, onChange, id }) => (
          <FieldLabel label={label}>
            <AutoField
              id={id}
              field={{ type: "number" }}
              value={value}
              onChange={(next) => onChange(typeof next === "number" && Number.isFinite(next) ? next : undefined)}
            />
            <Hint text={field.hint} />
          </FieldLabel>
        ),
      };
    case "tags":
      return {
        type: "custom",
        label,
        render: ({ value, onChange, id }) => {
          const chosen = Array.isArray(value) ? value : [];
          return (
            // Checkboxes with labels of their own, so not one label around them all.
            <FieldLabel label={label} el="div">
              <fieldset id={id} className="gfa-tags-field" aria-label={label}>
                {(field.options ?? []).map((option) => (
                  <label key={option.value} className="gfa-checkbox">
                    <input
                      type="checkbox"
                      checked={chosen.includes(option.value)}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...chosen, option.value]
                          : chosen.filter((tag) => tag !== option.value);
                        // In the order the collection lists them, so files don't change when only the order would.
                        const ordered = (field.options ?? [])
                          .map((candidate) => candidate.value)
                          .filter((tag) => next.includes(tag));
                        onChange(ordered.length > 0 ? ordered : undefined);
                      }}
                    />
                    {option.label}
                  </label>
                ))}
              </fieldset>
              <Hint text={field.hint} />
            </FieldLabel>
          );
        },
      };
    case "event":
      return {
        type: "custom",
        label,
        render: ({ value, onChange, id }) => (
          <EventField
            id={id}
            label={label}
            hint={field.hint}
            value={value}
            onChange={onChange}
            language={settings.language}
            timeZone={settings.timeZone}
          />
        ),
      };
    case "date":
      return {
        type: "custom",
        label,
        render: ({ value, onChange, id }) => (
          <FieldLabel label={label}>
            <input
              id={id}
              type="date"
              className="gfa-puck-input"
              value={typeof value === "string" ? value : ""}
              onChange={(event) => onChange(event.target.value)}
            />
            <Hint text={field.hint} />
          </FieldLabel>
        ),
      };
    default:
      return {
        type: "custom",
        label,
        render: ({ value, onChange, id }) => (
          <FieldLabel label={label}>
            <AutoField
              id={id}
              field={{ type: field.type === "textarea" ? "textarea" : "text" }}
              value={typeof value === "string" ? value : ""}
              onChange={onChange}
            />
            {(field.type === "image" || field.type === "link") && (
              <MediaChooser
                value={typeof value === "string" ? value : ""}
                kind={field.type === "image" ? "image" : "file"}
                onChange={onChange}
              />
            )}
            <Hint text={field.hint} />
          </FieldLabel>
        ),
      };
  }
}

interface PreviewProps {
  collection: Collection;
  entry: Entry;
  content: SiteContent;
  templateConfig: Config;
  layoutConfig: Config;
}

/** The entry's page as it will look, with the values being edited filled into the collection's template. */
function EntryPreview({ collection, entry, content, templateConfig, layoutConfig }: PreviewProps) {
  const t = useStrings();
  const values = usePuck((state) => state.appState.data.root.props) as Record<string, unknown> | undefined;
  const current = useMemo<Entry>(
    () => ({ ...entry, content: { version: 1, fields: storedEntryFields(values ?? {}) } }),
    [entry, values],
  );
  const site = useMemo<SiteContextValue>(
    () => ({
      settings: content.settings,
      menus: content.menus,
      path: entry.path ?? "/",
      collections: content.collections,
      collection,
      entry: current,
    }),
    [content, entry.path, collection, current],
  );
  const metadata = useMemo(() => siteMetadata(site), [site]);
  const applied = useMemo(
    () =>
      applyEntry(
        migrate(collection.settings.template as Data),
        templateConfig,
        collection,
        current,
        content.settings.language,
        content.settings.timeZone,
      ),
    [collection, templateConfig, current, content.settings.language, content.settings.timeZone],
  );

  // Blocks such as Entry field fill themselves in with resolveData, as they do when the site is built.
  const [resolved, setResolved] = useState<Data>(applied);
  useEffect(() => {
    let cancelled = false;
    void resolveAllData(applied, templateConfig, metadata).then((data) => {
      if (!cancelled) setResolved(data as Data);
    });
    return () => {
      cancelled = true;
    };
  }, [applied, templateConfig, metadata]);

  if (!collection.settings.path) {
    return (
      <p style={{ maxWidth: "36rem", margin: "4rem auto", padding: "0 1rem", textAlign: "center" }}>
        {t("editEntry.noPage", { name: collection.settings.name })}
      </p>
    );
  }

  const className = (resolved.root.props as Record<string, unknown> | undefined)?.className;
  return (
    <SiteProvider value={site}>
      <SiteFrame
        layoutConfig={layoutConfig}
        header={content.header.data as Data}
        footer={content.footer.data as Data}
        site={site}
        className={typeof className === "string" ? className : undefined}
      >
        <Render config={templateConfig} data={resolved} metadata={metadata} />
      </SiteFrame>
    </SiteProvider>
  );
}

/**
 * Where the item's schedule is among the values Puck edits. Fields' names are
 * lowercase letters, numbers and hyphens, so none can have this one.
 */
const SCHEDULE_PROP = "_schedule";

/** The values Puck edits: the entry's stored values, with every field present so Puck shows it, and its schedule. */
function formValues(collection: Collection, entry: Entry): Record<string, unknown> {
  const values: Record<string, unknown> = { ...entry.content.fields };
  for (const field of collection.settings.fields) {
    if (values[field.name] === undefined && field.type !== "number") values[field.name] = "";
  }
  values[SCHEDULE_PROP] = scheduleOf(entry.content);
  return values;
}

/** The item's schedule, last in its fields, which the AI assistant leaves alone. */
function scheduleField(content: SiteContent): Field<Schedule> {
  return {
    type: "custom",
    render: ({ value, onChange }) => <ScheduleFields value={value ?? {}} onChange={onChange} content={content} />,
  };
}

function EntryEditor({ collection, entry }: { collection: Collection; entry: Entry }) {
  const t = useStrings();
  const { config: siteConfig, templateConfig, layoutConfig } = useAdmin();
  const { content } = useSiteContent();
  const { fields } = collection.settings;

  const config = useMemo<Config>(
    () => ({
      components: {},
      root: {
        fields: Object.fromEntries([
          ...fields.map((field) => [field.name, puckField(field, collection, content.settings)]),
          [SCHEDULE_PROP, scheduleField(content)],
        ]) as Fields,
        render: () => (
          <EntryPreview
            collection={collection}
            entry={entry}
            content={content}
            templateConfig={templateConfig}
            layoutConfig={layoutConfig}
          />
        ),
      },
    }),
    [fields, collection, entry, content, templateConfig, layoutConfig],
  );
  const data = useMemo<Data>(
    () => ({ root: { props: formValues(collection, entry) }, content: [] }),
    [collection, entry],
  );
  const entryName = inSentence(collection.settings.entryName);

  return (
    <PuckEditor
      key={entry.file}
      kind="entry"
      path={entry.path ?? "/"}
      title={entryTitle(entry)}
      data={data}
      collection={collection}
      config={config}
      // Items have no blocks, so the left side only has the AI assistant, closed at the start, and
      // nothing at all without it. Their fields are on the right, which starts wider.
      ui={siteConfig.ai === false ? { leftSideBarVisible: false } : entryUi}
      plugins={siteConfig.ai === false ? entryPlugins : undefined}
      rightSideBar={ENTRY_SIDEBAR}
      actions={<VersionsLink file={entry.file} />}
      validate={(next) => {
        const values: Record<string, unknown> = next.root.props ?? {};
        if (scheduleProblem((values[SCHEDULE_PROP] ?? {}) as Schedule)) return t("editEntry.invalidSchedule");
        const missing = fields.filter((field) => field.required && isEmptyValue(values[field.name]));
        if (missing.length > 0) {
          return t("editEntry.required", { fields: missing.map((field) => field.label).join(", ") });
        }
        const badEvents = fields.filter(
          (field) =>
            field.type === "event" && !isEmptyValue(values[field.name]) && eventValueProblem(values[field.name]),
        );
        return badEvents.length > 0
          ? t("editEntry.invalidEvent", { fields: badEvents.map((field) => field.label).join(", ") })
          : undefined;
      }}
      toChanges={(next) => {
        const { [SCHEDULE_PROP]: schedule = {}, ...values } = Object.fromEntries(
          Object.entries(next.root.props ?? {}).filter(([name]) => name !== "id"),
        );
        const title = typeof values.title === "string" && values.title.trim() ? values.title.trim() : entry.slug;
        return {
          changes: [
            entryFileChange(collection, entry.slug, values, schedule as Schedule),
            ...scheduleSettingsChanges(content, schedule as Schedule),
          ],
          message: t("editEntry.message", { entry: entryName, title }),
        };
      }}
    />
  );
}

export function EntryEditorScreen({ collectionId, slug }: { collectionId: string; slug: string }) {
  const t = useStrings();
  const { content } = useSiteContent();
  const found = findEntry(content, collectionId, slug);
  const collection = content.collections.find((candidate) => candidate.id === collectionId);

  if (!found) {
    return (
      <div className="gfa-screen">
        <p>{t("editEntry.notFound")}</p>
        <AppLink href={collection ? `#/collections/${collection.id}` : "#/collections"}>
          {collection ? t("editEntry.back", { name: collection.settings.name }) : t("collection.back")}
        </AppLink>
      </div>
    );
  }

  return (
    <CollectionLayout collection={found.collection} tab="entries">
      <EntryEditor collection={found.collection} entry={found.entry} />
    </CollectionLayout>
  );
}
