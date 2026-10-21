import {
  addressPatternProblem,
  allPages,
  type Collection,
  type CollectionField,
  type CollectionFile,
  collectionFileSchema,
  entryAddress,
  entryTitle,
  FIELD_TYPES,
  type FieldType,
  isReservedPagePath,
  serializeContent,
  TITLE_FIELD,
} from "@goodfellow-cms/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { collectionSettingsChanges, deleteCollectionChanges, slugify, uniqueName } from "./changes.js";
import { CollectionLayout } from "./collection-screen.js";
import { type Failure, PublishFailure } from "./publish-failure.js";
import { navigate, useUnsavedChanges } from "./router.js";
import { type StringKey, useStrings } from "./strings.js";
import { Button, Dialog, ErrorMessage, Field, PublishedNotice, TextField } from "./ui.js";

/** A field being edited. New fields get their name when published, from their label. */
interface DraftField {
  key: string;
  name?: string;
  label: string;
  type: FieldType;
  required: boolean;
  hint: string;
  options: Array<{ value?: string; label: string }>;
}

interface Draft {
  name: string;
  entryName: string;
  withPages: boolean;
  path: string;
  sortField: string;
  sortOrder: "asc" | "desc";
  /** The formatted-text field that is the body of entries' Markdown files, or "" for JSON files. */
  markdownBody: string;
  /** For a calendar, the date and time field of its events, and the fields shown beside them, or "" for none. */
  calendarWhen: string;
  calendarPlace: string;
  calendarSummary: string;
  fields: DraftField[];
}

let nextKey = 0;
const newKey = () => `field-${nextKey++}`;

function toDraft(settings: CollectionFile): Draft {
  return {
    name: settings.name,
    entryName: settings.entryName,
    withPages: settings.path !== undefined,
    path: settings.path ?? `/${slugify(settings.name) || "items"}/{slug}`,
    sortField: settings.sort?.field ?? TITLE_FIELD,
    sortOrder: settings.sort?.order ?? "asc",
    markdownBody: settings.markdown?.body ?? "",
    calendarWhen: settings.calendar?.when ?? "",
    calendarPlace: settings.calendar?.place ?? "",
    calendarSummary: settings.calendar?.summary ?? "",
    fields: settings.fields.map((field) => ({
      key: newKey(),
      name: field.name,
      label: field.label,
      type: field.type,
      required: field.required ?? false,
      hint: field.hint ?? "",
      options: field.options ?? [],
    })),
  };
}

/** A name for a new field, made from its label: "Event date" → `event-date`. Names start with a letter. */
function fieldNameFor(label: string, taken: string[]): string {
  const slug = slugify(label);
  return uniqueName(/^[a-z]/.test(slug) ? slug : `field-${slug}`.replace(/-$/, ""), taken, "field");
}

/** Gives every new field and choice its name, so the draft can be checked and saved. */
function named(draft: Draft): DraftField[] {
  const taken = draft.fields.flatMap((field) => (field.name ? [field.name] : []));
  return draft.fields.map((field) => {
    const name = field.name ?? fieldNameFor(field.label, taken);
    if (!field.name) taken.push(name);
    const values = field.options.flatMap((option) => (option.value ? [option.value] : []));
    const options = field.options.map((option) => {
      if (option.value) return option;
      const value = uniqueName(slugify(option.label), values, "choice");
      values.push(value);
      return { ...option, value };
    });
    return { ...field, name, options };
  });
}

/** The settings the draft would save, before checking. */
function fromDraft(settings: CollectionFile, draft: Draft): CollectionFile {
  const fields: CollectionField[] = named(draft).map((field) => ({
    name: field.name ?? "",
    label: field.label.trim(),
    type: field.type,
    ...(field.required && { required: true }),
    ...(field.hint.trim() && { hint: field.hint.trim() }),
    ...(hasChoices(field.type) && {
      options: field.options
        .filter((option) => option.label.trim())
        .map((option) => ({ value: option.value ?? "", label: option.label.trim() })),
    }),
  }));
  const sortField = fields.some((field) => field.name === draft.sortField) ? draft.sortField : TITLE_FIELD;
  const isDefaultSort = sortField === TITLE_FIELD && draft.sortOrder === "asc";
  const { path: _path, sort: _sort, markdown: _markdown, calendar: _calendar, ...rest } = settings;
  const body = fields.find((field) => field.name === draft.markdownBody && field.type === "richtext");
  // A calendar's fields that were removed, or whose type no longer fits, are left out.
  const fieldOf = (name: string, types: FieldType[]) =>
    fields.find((field) => field.name === name && types.includes(field.type))?.name;
  const when = fieldOf(draft.calendarWhen, CALENDAR_TYPES.when);
  const place = fieldOf(draft.calendarPlace, CALENDAR_TYPES.place);
  const summary = fieldOf(draft.calendarSummary, CALENDAR_TYPES.summary);
  return {
    ...rest,
    name: draft.name.trim(),
    entryName: draft.entryName.trim(),
    ...(draft.withPages && { path: draft.path.trim() }),
    fields,
    ...(!isDefaultSort && { sort: { field: sortField, order: draft.sortOrder } }),
    ...(body && { markdown: { body: body.name } }),
    ...(when && { calendar: { when, ...(place && { place }), ...(summary && { summary }) } }),
  };
}

/** The kinds of field a calendar's settings can name. */
const CALENDAR_TYPES: Record<"when" | "place" | "summary", FieldType[]> = {
  when: ["event"],
  place: ["text", "textarea"],
  summary: ["text", "textarea", "richtext"],
};

const typeLabels: Record<FieldType, StringKey> = {
  text: "fields.type.text",
  textarea: "fields.type.textarea",
  richtext: "fields.type.richtext",
  number: "fields.type.number",
  date: "fields.type.date",
  event: "fields.type.event",
  link: "fields.type.link",
  image: "fields.type.image",
  select: "fields.type.select",
  tags: "fields.type.tags",
};

/** Field types whose values are choices the collection's settings list. */
function hasChoices(type: FieldType): boolean {
  return type === "select" || type === "tags";
}

function move<T>(list: T[], index: number, by: -1 | 1): T[] {
  const target = index + by;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target] as T, next[index] as T];
  return next;
}

function FieldEditor({
  field,
  placeholder,
  index,
  count,
  error,
  onChange,
  onMove,
  onRemove,
}: {
  field: DraftField;
  placeholder: string;
  index: number;
  count: number;
  error?: string;
  onChange: (field: DraftField) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useStrings();
  const isTitle = field.name === TITLE_FIELD;
  return (
    <div className="gfa-menu-item gfa-field-editor">
      <div className="gfa-field-editor-row">
        <TextField
          label={t("fields.label")}
          value={field.label}
          error={error}
          onChange={(label) => onChange({ ...field, label })}
        />
        <Field label={t("fields.type")}>
          {(props) => (
            <select
              {...props}
              className="gfa-input"
              value={field.type}
              disabled={Boolean(field.name)}
              onChange={(event) => onChange({ ...field, type: event.target.value as FieldType })}
            >
              {FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(typeLabels[type])}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="gfa-link-row-actions">
          <Button
            variant="ghost"
            aria-label={t("menus.moveUp")}
            title={t("menus.moveUp")}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            ↑
          </Button>
          <Button
            variant="ghost"
            aria-label={t("menus.moveDown")}
            title={t("menus.moveDown")}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            ↓
          </Button>
          {!isTitle && (
            <Button variant="ghost" onClick={onRemove}>
              {t("fields.remove")}
            </Button>
          )}
        </div>
      </div>
      <TextField label={t("fields.hint")} value={field.hint} onChange={(hint) => onChange({ ...field, hint })} />
      {hasChoices(field.type) && (
        <fieldset className="gfa-choices">
          <legend className="gfa-label">{t("fields.options")}</legend>
          {field.options.map((option, optionIndex) => (
            <div key={option.value ?? `new-${optionIndex}`} className="gfa-inline-form">
              <TextField
                label={t("fields.option", { number: String(optionIndex + 1) })}
                value={option.label}
                onChange={(label) =>
                  onChange({
                    ...field,
                    options: field.options.map((existing, i) =>
                      i === optionIndex ? { ...existing, label } : existing,
                    ),
                  })
                }
              />
              <Button
                variant="ghost"
                onClick={() => onChange({ ...field, options: field.options.filter((_, i) => i !== optionIndex) })}
              >
                {t("menus.remove")}
              </Button>
            </div>
          ))}
          <Button onClick={() => onChange({ ...field, options: [...field.options, { label: "" }] })}>
            {t("fields.addOption")}
          </Button>
        </fieldset>
      )}
      {!isTitle && (
        <label className="gfa-checkbox">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(event) => onChange({ ...field, required: event.target.checked })}
          />
          {t("fields.required")}
        </label>
      )}
      <p className="gfa-hint">{t("fields.placeholder", { placeholder })}</p>
    </div>
  );
}

/** Whether entries are Markdown files, and which formatted-text field is their body. */
function MarkdownSetting({
  draft,
  names,
  onChange,
}: {
  draft: Draft;
  names: DraftField[];
  onChange: (body: string) => void;
}) {
  const t = useStrings();
  const bodies = names.filter((field) => field.type === "richtext" && field.name);
  const current = bodies.find((field) => field.name === draft.markdownBody);
  return (
    <>
      <label className="gfa-checkbox">
        <input
          type="checkbox"
          checked={current !== undefined}
          disabled={bodies.length === 0}
          onChange={(event) => onChange(event.target.checked ? (bodies[0]?.name ?? "") : "")}
        />
        {t("collectionSettings.markdown")}
      </label>
      <p className="gfa-hint">
        {t(bodies.length === 0 ? "collectionSettings.markdownNeedsText" : "collectionSettings.markdownHint")}
      </p>
      {current && bodies.length > 1 && (
        <Field label={t("collectionSettings.markdownBody")}>
          {(props) => (
            <select
              {...props}
              className="gfa-input"
              value={current.name}
              onChange={(event) => onChange(event.target.value)}
            >
              {bodies.map((field) => (
                <option key={field.key} value={field.name}>
                  {field.label || field.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
    </>
  );
}

/** Whether the collection is a calendar of events, and which fields say when and where they are. */
function CalendarSetting({
  draft,
  names,
  onChange,
}: {
  draft: Draft;
  names: DraftField[];
  onChange: (changes: Partial<Pick<Draft, "calendarWhen" | "calendarPlace" | "calendarSummary">>) => void;
}) {
  const t = useStrings();
  const ofTypes = (types: FieldType[]) => names.filter((field) => field.name && types.includes(field.type));
  const dates = ofTypes(CALENDAR_TYPES.when);
  const current = dates.find((field) => field.name === draft.calendarWhen);
  const select = (
    label: StringKey,
    value: string,
    choices: DraftField[],
    change: (name: string) => void,
    withNone: boolean,
  ) => (
    <Field label={t(label)}>
      {(props) => (
        <select {...props} className="gfa-input" value={value} onChange={(event) => change(event.target.value)}>
          {withNone && <option value="">{t("collectionSettings.calendarNone")}</option>}
          {choices.map((field) => (
            <option key={field.key} value={field.name}>
              {field.label || field.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
  return (
    <>
      <label className="gfa-checkbox">
        <input
          type="checkbox"
          checked={current !== undefined}
          disabled={dates.length === 0}
          onChange={(event) => onChange({ calendarWhen: event.target.checked ? (dates[0]?.name ?? "") : "" })}
        />
        {t("collectionSettings.calendar")}
      </label>
      <p className="gfa-hint">
        {t(dates.length === 0 ? "collectionSettings.calendarNeedsDate" : "collectionSettings.calendarHint")}
      </p>
      {current && (
        <div className="gfa-inline-form">
          {dates.length > 1 &&
            select(
              "collectionSettings.calendarWhen",
              current.name ?? "",
              dates,
              (calendarWhen) => onChange({ calendarWhen }),
              false,
            )}
          {select(
            "collectionSettings.calendarPlace",
            draft.calendarPlace,
            ofTypes(CALENDAR_TYPES.place),
            (calendarPlace) => onChange({ calendarPlace }),
            true,
          )}
          {select(
            "collectionSettings.calendarSummary",
            draft.calendarSummary,
            ofTypes(CALENDAR_TYPES.summary),
            (calendarSummary) => onChange({ calendarSummary }),
            true,
          )}
        </div>
      )}
    </>
  );
}

function DeleteCollectionDialog({ collection, onClose }: { collection: Collection; onClose: () => void }) {
  const t = useStrings();
  const { publish } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const name = collection.settings.name;

  const onDelete = async () => {
    setBusy(true);
    const result = await publish(deleteCollectionChanges(collection), t("collectionSettings.deleteMessage", { name }));
    setBusy(false);
    if (result.ok) {
      onClose();
      navigate("#/collections", () => true);
    } else {
      setFailure(result);
    }
  };

  return (
    <Dialog title={t("collectionSettings.deleteTitle", { name })} onClose={onClose}>
      <p>{t("collectionSettings.deleteBody", { name, count: String(collection.entries.length) })}</p>
      <PublishFailure failure={failure} />
      <div className="gfa-dialog-actions">
        <Button onClick={onClose}>{t("action.cancel")}</Button>
        <Button variant="danger" disabled={busy} onClick={() => void onDelete()}>
          {busy ? t("publish.publishing") : t("collectionSettings.delete")}
        </Button>
      </div>
    </Dialog>
  );
}

/** Finds an entry whose page would take an address something else already has, with a new address pattern. */
function addressClash(collection: Collection, path: string, addresses: Set<string>): string | undefined {
  const used = new Set(addresses);
  for (const entry of collection.entries) {
    const address = entryAddress(path, entry.slug);
    if (used.has(address) || isReservedPagePath(address)) return entryTitle(entry);
    used.add(address);
  }
  return undefined;
}

/** A collection's name, page addresses, order and fields. */
export function CollectionSettingsScreen({ collection }: { collection: Collection }) {
  const t = useStrings();
  const { config, publish, reload } = useAdmin();
  const { content } = useSiteContent();
  const [draft, setDraft] = useState(() => toDraft(collection.settings));
  const [showErrors, setShowErrors] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState<
    | { type: "idle" | "publishing" | "done" | "invalid" }
    | { type: "failed"; reason: "conflict" | "error"; error: unknown }
  >({ type: "idle" });

  const next = useMemo(() => fromDraft(collection.settings, draft), [collection.settings, draft]);
  const errors = useMemo(() => {
    const result: Record<string, string> = {};
    const parsed = collectionFileSchema.safeParse(next);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) result[issue.path.join(".")] ??= issue.message;
    }
    if (!next.name) result.name = t("field.required");
    if (!next.entryName) result.entryName = t("field.required");
    next.fields.forEach((field, index) => {
      if (!field.label) result[`fields.${index}.label`] = t("field.required");
      if (hasChoices(field.type) && !field.options?.length)
        result[`fields.${index}.options`] = t("fields.optionsRequired");
    });
    if (next.path !== undefined) {
      if (addressPatternProblem(next.path)) result.path = t("address.invalid");
      else {
        const others = new Set(
          allPages(content)
            .filter((page) => page.entry?.collection !== collection.id)
            .map((page) => page.path),
        );
        const clash = addressClash(collection, next.path, others);
        if (clash) result.path = t("collectionSettings.addressClash", { title: clash });
      }
    }
    return result;
  }, [next, content, collection, t]);

  const valid = Object.keys(errors).length === 0;
  const dirty = serializeContent(next) !== serializeContent(collection.settings);
  // "Published." goes after a few seconds, or as soon as anything changes.
  const hidePublished = useCallback(
    () => setStatus((current) => (current.type === "done" ? { type: "idle" } : current)),
    [],
  );
  useEffect(() => {
    if (dirty) hidePublished();
  }, [dirty, hidePublished]);
  useUnsavedChanges(dirty);
  const shown = showErrors ? errors : {};
  const removed = collection.settings.fields.some(
    (field) => !draft.fields.some((candidate) => candidate.name === field.name),
  );
  const names = named(draft);

  const onPublish = async () => {
    setShowErrors(true);
    if (!valid) {
      setStatus({ type: "invalid" });
      return;
    }
    setStatus({ type: "publishing" });
    const settings = collectionFileSchema.parse(next);
    const result = await publish(
      collectionSettingsChanges(collection, settings, { content, blocks: config.blocks }),
      t("collectionSettings.message", { name: next.name }),
    );
    if (result.ok) {
      // New fields and choices now have their names, which can't change any more.
      setDraft(toDraft(settings));
      setStatus({ type: "done" });
    } else if (result.reason === "checks") {
      setStatus({ type: "idle" });
    } else {
      setStatus({ type: "failed", reason: result.reason, error: result.error });
    }
  };

  const setField = (index: number, field: DraftField) =>
    setDraft({ ...draft, fields: draft.fields.map((existing, i) => (i === index ? field : existing)) });

  return (
    <CollectionLayout collection={collection} tab="settings">
      <div className="gfa-screen">
        <div className="gfa-screen-header">
          <h1>{t("collection.tab.settings")}</h1>
          <div className="gfa-header-actions">
            <Button
              variant="primary"
              disabled={status.type === "publishing" || !dirty}
              onClick={() => void onPublish()}
            >
              {status.type === "publishing" ? t("publish.publishing") : t("publish.button")}
            </Button>
            {status.type === "done" && <PublishedNotice onHide={hidePublished} />}
          </div>
        </div>
        {status.type === "invalid" && !valid && <ErrorMessage message={t("publish.invalid")} />}
        {status.type === "failed" && (
          <ErrorMessage
            message={t(status.reason === "conflict" ? "publish.conflict" : "publish.error")}
            error={status.error}
            action={
              status.reason === "conflict" ? (
                <Button onClick={() => void reload()}>{t("action.reload")}</Button>
              ) : undefined
            }
          />
        )}

        <div className="gfa-form">
          <h2 className="gfa-section-title">{t("collectionSettings.general")}</h2>
          <TextField
            label={t("newCollection.name")}
            hint={t("newCollection.nameHint")}
            value={draft.name}
            error={shown.name}
            onChange={(name) => setDraft({ ...draft, name })}
          />
          <TextField
            label={t("newCollection.entryName")}
            hint={t("newCollection.entryNameHint")}
            value={draft.entryName}
            error={shown.entryName}
            onChange={(entryName) => setDraft({ ...draft, entryName })}
          />
          <label className="gfa-checkbox">
            <input
              type="checkbox"
              checked={draft.withPages}
              onChange={(event) => setDraft({ ...draft, withPages: event.target.checked })}
            />
            {t("newCollection.pages")}
          </label>
          {draft.withPages && (
            <>
              <TextField
                label={t("collectionSettings.path")}
                hint={t("collectionSettings.pathHint")}
                value={draft.path}
                error={shown.path}
                onChange={(path) => setDraft({ ...draft, path })}
              />
              {collection.settings.path !== undefined && draft.path.trim() !== collection.settings.path && (
                <p className="gfa-hint">{t("collectionSettings.pathWarning")}</p>
              )}
            </>
          )}
          <div className="gfa-inline-form">
            <Field label={t("collectionSettings.sortField")}>
              {(props) => (
                <select
                  {...props}
                  className="gfa-input"
                  value={draft.sortField}
                  onChange={(event) => setDraft({ ...draft, sortField: event.target.value })}
                >
                  {names.map((field) => (
                    <option key={field.key} value={field.name}>
                      {field.label || field.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t("collectionSettings.sortOrder")}>
              {(props) => (
                <select
                  {...props}
                  className="gfa-input"
                  value={draft.sortOrder}
                  onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value as "asc" | "desc" })}
                >
                  <option value="asc">{t("collectionSettings.ascending")}</option>
                  <option value="desc">{t("collectionSettings.descending")}</option>
                </select>
              )}
            </Field>
          </div>

          <MarkdownSetting
            draft={draft}
            names={names}
            onChange={(markdownBody) => setDraft({ ...draft, markdownBody })}
          />
          {draft.markdownBody !== (collection.settings.markdown?.body ?? "") && collection.entries.length > 0 && (
            <p className="gfa-hint">{t("collectionSettings.markdownConverts")}</p>
          )}

          <CalendarSetting draft={draft} names={names} onChange={(changes) => setDraft({ ...draft, ...changes })} />

          <h2 className="gfa-section-title">{t("fields.title")}</h2>
          <p className="gfa-hint">{t("fields.intro")}</p>
          <div className="gfa-menu">
            {draft.fields.map((field, index) => (
              <FieldEditor
                key={field.key}
                field={field}
                placeholder={`{${names[index]?.name ?? ""}}`}
                index={index}
                count={draft.fields.length}
                error={shown[`fields.${index}.label`] ?? shown[`fields.${index}.options`]}
                onChange={(changed) => setField(index, changed)}
                onMove={(by) => setDraft({ ...draft, fields: move(draft.fields, index, by) })}
                onRemove={() => setDraft({ ...draft, fields: draft.fields.filter((_, i) => i !== index) })}
              />
            ))}
          </div>
          {removed && <p className="gfa-hint">{t("fields.removed")}</p>}
          <div>
            <Button
              onClick={() =>
                setDraft({
                  ...draft,
                  fields: [
                    ...draft.fields,
                    {
                      key: newKey(),
                      label: t("fields.newLabel"),
                      type: "text",
                      required: false,
                      hint: "",
                      options: [],
                    },
                  ],
                })
              }
            >
              {t("fields.add")}
            </Button>
          </div>

          <h2 className="gfa-section-title">{t("collectionSettings.delete")}</h2>
          <div>
            <Button variant="danger" onClick={() => setDeleting(true)}>
              {t("collectionSettings.delete")}
            </Button>
          </div>
        </div>
        {deleting && <DeleteCollectionDialog collection={collection} onClose={() => setDeleting(false)} />}
      </div>
    </CollectionLayout>
  );
}
