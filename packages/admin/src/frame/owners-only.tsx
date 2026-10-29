/**
 * Block settings only owners may change (`metadata: { owners: true }`, such as
 * Custom HTML used exactly as written), shown to editors on full-stack sites
 * as they are, without a way to change them. Their server refuses such a
 * change anyway (`ownersOnlyChanges()`); this only says so up front.
 */
import { isOwnersOnlyField } from "@goodfellow-cms/core";
import type { Config, CustomField, Field, Fields } from "@puckeditor/core";
import { useStrings } from "../strings.js";

function valueLabel(field: Field, value: unknown): string {
  const options = "options" in field && Array.isArray(field.options) ? field.options : [];
  const option = options.find((choice) => JSON.stringify(choice.value) === JSON.stringify(value));
  if (option) return String(option.label);
  return value === undefined || value === null ? "" : String(value);
}

function LockedField({ field, value }: { field: Field; value: unknown }) {
  const t = useStrings();
  return (
    <div className="gfa-locked-field">
      {field.label && <div className="gfa-locked-field-label">{field.label}</div>}
      <div className="gfa-locked-field-value">{valueLabel(field, value)}</div>
      <p className="gfa-locked-field-note">{t("owners.only")}</p>
    </div>
  );
}

function locked(fields: Fields): Fields {
  return Object.fromEntries(
    Object.entries(fields).map(([name, field]) => {
      if (!isOwnersOnlyField(field)) return [name, field];
      const shown: CustomField<unknown> = {
        type: "custom",
        ...(field.label !== undefined && { label: field.label }),
        ...(field.metadata !== undefined && { metadata: field.metadata }),
        render: ({ value }) => <LockedField field={field} value={value} />,
      };
      return [name, shown];
    }),
  ) as Fields;
}

/** The config with owners-only settings shown but not changeable, for editors who aren't owners. */
export function withOwnersOnlyLocked(config: Config): Config {
  const components = Object.fromEntries(
    Object.entries(config.components).map(([name, component]) => {
      const fields = component.fields ?? {};
      if (!Object.values(fields).some(isOwnersOnlyField)) return [name, component];
      return [name, { ...component, fields: locked(fields) }];
    }),
  );
  return { ...config, components } as Config;
}
