import {
  type Collection,
  type Entry,
  entryLanguage,
  entryTitle,
  eventValueProblem,
  findEntry,
  isEmptyValue,
  type Schedule,
  scheduleProblem,
  withSchedule,
} from "@goodfellow-cms/core";
import type { Data } from "@puckeditor/core";
import { useMemo } from "react";
import { useSiteContent } from "./admin-context.js";
import { entryFileChange } from "./changes.js";
import { CollectionLayout, inSentence } from "./collection-screen.js";
import { formValues, SCHEDULE_PROP } from "./entry-values.js";
import { PuckEditor } from "./puck-editor.js";
import { scheduleSettingsChanges } from "./schedule.js";
import { useStrings } from "./strings.js";
import { EntryEditorTranslations } from "./translations.js";
import { AppLink } from "./use-link.js";
import { VersionsLink } from "./versions-screen.js";

function EntryEditor({ collection, entry }: { collection: Collection; entry: Entry }) {
  const t = useStrings();
  const { content } = useSiteContent();
  const { fields } = collection.settings;
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
      language={entryLanguage(content.settings, entry)}
      title={entryTitle(entry)}
      data={data}
      collection={collection}
      entry={entry.slug}
      actions={
        <>
          <EntryEditorTranslations collection={collection} entry={entry} />
          <VersionsLink file={entry.file} />
        </>
      }
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
            entryFileChange(collection, entry.slug, values, withSchedule(entry.content, schedule as Schedule)),
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
