/**
 * The item editor's Puck config, in the site's frame: a field for each of the
 * collection's fields and the item's schedule, and the item's page as its
 * collection's design shows it, as the canvas.
 */
import type { AiFieldHint } from "@goodfellow-cms/ai";
import {
  type Collection,
  type CollectionField,
  type Entry,
  expandSyncedBlocks,
  type GroupField,
  pageLinks,
  type Schedule,
  type SiteContent,
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
  migrate,
  Render,
  resolveAllData,
} from "@puckeditor/core";
import { useEffect, useMemo, useState } from "react";
import { storedEntryFields } from "../changes.js";
import { SCHEDULE_PROP } from "../entry-values.js";
import { EventField } from "../event-field.js";
import { ImagesField, ItemPicker, linkableItems } from "../item-fields.js";
import { MarkdownField } from "../markdown-field.js";
import { MediaChooser } from "../media-library.js";
import { ScheduleFields } from "../schedule.js";
import { useStrings } from "../strings.js";
import { SiteFrame } from "./site-frame.js";

const usePuck = createUsePuck();

function Hint({ text }: { text?: string }) {
  return text ? <p className="gfa-puck-hint">{text}</p> : null;
}

/** What the AI assistant is told a field holds, since it can't tell from a custom field. */
function aiHint(
  field: CollectionField,
  markdown: boolean,
  collections: readonly Collection[],
): AiFieldHint | undefined {
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
    case "yesno":
      return { type: "boolean", description };
    case "item": {
      // The items it can link to, by their names, as choices.
      const options = linkableItems(collections.find((candidate) => candidate.id === field.collection))
        .slice(0, MAX_AI_ITEMS)
        .map((item) => ({ value: item.slug, label: item.title }));
      if (options.length === 0) return undefined;
      return { type: field.multiple ? "choices" : "choice", options, description };
    }
    // Images, files and groups are left to editors: the assistant can't know the site's files.
    case "images":
    case "file":
    case "group":
      return undefined;
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

/** The most items the assistant is offered to link to, so a large collection doesn't fill its request. */
const MAX_AI_ITEMS = 200;

/** The Puck field for one of a collection's fields, shown in the editor's sidebar. */
function puckField(field: CollectionField, collection: Collection, content: SiteContent): Field {
  const markdown = collection.settings.markdown?.body === field.name;
  const control = fieldControl(field, markdown, content);
  // The assistant leaves events' dates and times alone: they're structured, and editors know them best.
  const ai = field.type === "event" ? undefined : aiHint(field, markdown, content.collections);
  return ai ? { ...control, metadata: { ai } } : control;
}

/** A text field for an address, with the media chooser below it. */
function addressControl(
  label: string,
  hint: string | undefined,
  kind: "image" | "file",
): Pick<Extract<Field, { type: "custom" }>, "render"> {
  return {
    render: ({ value, onChange, id }) => (
      <FieldLabel label={label}>
        <AutoField
          id={id}
          field={{ type: "text" }}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
        />
        <MediaChooser value={typeof value === "string" ? value : ""} kind={kind} onChange={onChange} />
        <Hint text={hint} />
      </FieldLabel>
    ),
  };
}

/** A checkbox for a yes or no field, which stores nothing when it's off. */
function YesNo({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: unknown;
  onChange: (value: true | undefined) => void;
}) {
  return (
    <div className="gfa-puck-field">
      <label className="gfa-checkbox">
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked ? true : undefined)}
        />
        {label}
      </label>
      <Hint text={hint} />
    </div>
  );
}

/** One of a repeating group's fields, as the group's rows show it. */
function groupFieldControl(field: GroupField): Field {
  switch (field.type) {
    case "textarea":
      return { type: "textarea", label: field.label };
    case "number":
      return { type: "number", label: field.label };
    case "date":
      return {
        type: "custom",
        label: field.label,
        render: ({ value, onChange, id }) => (
          <FieldLabel label={field.label}>
            <input
              id={id}
              type="date"
              className="gfa-puck-input"
              value={typeof value === "string" ? value : ""}
              onChange={(event) => onChange(event.target.value)}
            />
          </FieldLabel>
        ),
      };
    case "yesno":
      return {
        type: "custom",
        label: field.label,
        render: ({ value, onChange, id }) => <YesNo id={id} label={field.label} value={value} onChange={onChange} />,
      };
    case "image":
    case "link":
      return {
        type: "custom",
        label: field.label,
        ...addressControl(field.label, undefined, field.type === "image" ? "image" : "file"),
      };
    default:
      return { type: "text", label: field.label };
  }
}

function fieldControl(field: CollectionField, markdown: boolean, content: SiteContent): Field {
  const { settings } = content;
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
    case "yesno":
      return {
        type: "custom",
        label,
        render: ({ value, onChange, id }) => (
          <YesNo id={id} label={label} hint={field.hint} value={value} onChange={onChange} />
        ),
      };
    case "item":
      return {
        type: "custom",
        label,
        render: ({ value, onChange, id }) => (
          <FieldLabel label={label} el="div">
            <ItemPicker
              id={id}
              collection={content.collections.find((candidate) => candidate.id === field.collection)}
              multiple={field.multiple === true}
              value={value}
              onChange={onChange}
            />
            <Hint text={field.hint} />
          </FieldLabel>
        ),
      };
    case "images":
      return {
        type: "custom",
        label,
        render: ({ value, onChange }) => (
          <FieldLabel label={label} el="div">
            <ImagesField value={value} onChange={onChange} />
            <Hint text={field.hint} />
          </FieldLabel>
        ),
      };
    case "file":
      return { type: "custom", label, ...addressControl(label, field.hint, "file") };
    case "group": {
      const subFields = field.fields ?? [];
      const first = subFields[0]?.name;
      return {
        type: "array",
        label,
        arrayFields: Object.fromEntries(subFields.map((sub) => [sub.name, groupFieldControl(sub)])),
        getItemSummary: (row: Record<string, unknown>, index?: number) =>
          (first && typeof row?.[first] === "string" && row[first]) || `${(index ?? 0) + 1}`,
      } as Field;
    }
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
      pages: pageLinks(content),
      collection,
      entry: current,
    }),
    [content, entry.path, collection, current],
  );
  const metadata = useMemo(() => siteMetadata(site), [site]);
  const applied = useMemo(
    () =>
      applyEntry(
        expandSyncedBlocks(migrate(collection.settings.template as Data), content, content.settings.language),
        templateConfig,
        collection,
        current,
        content.settings.language,
        content.settings.timeZone,
        content.collections,
      ),
    [collection, templateConfig, current, content],
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
        header={expandSyncedBlocks(content.header.data as Data, content, content.settings.language)}
        footer={expandSyncedBlocks(content.footer.data as Data, content, content.settings.language)}
        site={site}
        className={typeof className === "string" ? className : undefined}
      >
        <Render config={templateConfig} data={resolved} metadata={metadata} />
      </SiteFrame>
    </SiteProvider>
  );
}

/** The item's schedule, last in its fields, which the AI assistant leaves alone. */
function scheduleField(content: SiteContent): Field<Schedule> {
  return {
    type: "custom",
    render: ({ value, onChange }) => <ScheduleFields value={value ?? {}} onChange={onChange} content={content} />,
  };
}

/** The item editor's Puck config: no blocks, only the item's values, with its page as the canvas. */
export function entryConfig(
  collection: Collection,
  entry: Entry,
  content: SiteContent,
  configs: { templateConfig: Config; layoutConfig: Config },
): Config {
  return {
    components: {},
    root: {
      fields: Object.fromEntries([
        ...collection.settings.fields.map((field) => [field.name, puckField(field, collection, content)]),
        [SCHEDULE_PROP, scheduleField(content)],
      ]) as Fields,
      render: () => (
        <div className="gf-canvas">
          <EntryPreview
            collection={collection}
            entry={entry}
            content={content}
            templateConfig={configs.templateConfig}
            layoutConfig={configs.layoutConfig}
          />
        </div>
      ),
    },
  };
}
