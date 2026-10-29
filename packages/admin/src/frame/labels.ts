import type { ComponentConfig, Config, Field, Fields } from "@puckeditor/core";

type AnyField = Field & {
  label?: string;
  placeholder?: string;
  options?: { label: string; value: unknown }[];
  arrayFields?: Fields;
  objectFields?: Fields;
};

type AnyComponent = ComponentConfig & { label?: string };

/** A label in the admin panel's language, or as it is where the table has none. */
function translated(labels: Readonly<Record<string, string>>, text: string | undefined): string | undefined {
  return text === undefined ? text : (labels[text] ?? text);
}

function withFieldLabels(field: AnyField, labels: Readonly<Record<string, string>>): AnyField {
  return {
    ...field,
    ...(field.label !== undefined && { label: translated(labels, field.label) }),
    ...(typeof field.placeholder === "string" && { placeholder: translated(labels, field.placeholder) }),
    ...(Array.isArray(field.options) && {
      options: field.options.map((option) => ({ ...option, label: translated(labels, option.label) ?? option.label })),
    }),
    ...(field.arrayFields && { arrayFields: withFieldsLabels(field.arrayFields, labels) }),
    ...(field.objectFields && { objectFields: withFieldsLabels(field.objectFields, labels) }),
  } as AnyField;
}

function withFieldsLabels(fields: Fields, labels: Readonly<Record<string, string>>): Fields {
  return Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [name, withFieldLabels(field as AnyField, labels)]),
  ) as Fields;
}

function withComponentLabels<T extends AnyComponent | Config["root"]>(
  component: T,
  labels: Readonly<Record<string, string>>,
): T {
  if (!component) return component;
  const { resolveFields, label } = component as AnyComponent;
  return {
    ...component,
    ...(label !== undefined && { label: translated(labels, label) }),
    ...(component.fields && { fields: withFieldsLabels(component.fields as Fields, labels) }),
    ...(resolveFields && {
      resolveFields: async (...args: Parameters<NonNullable<AnyComponent["resolveFields"]>>) =>
        withFieldsLabels(await resolveFields(...args), labels),
    }),
  };
}

/**
 * The config with blocks' names, groups and settings' labels, choices and
 * placeholders in the admin panel's language, looked up by their English
 * wording, so a site's own blocks that word theirs the same way are
 * translated too. Only what the editor shows changes: props, choices' values
 * and what blocks render stay as they are.
 */
export function withLabels(config: Config, labels: Readonly<Record<string, string>>): Config {
  if (Object.keys(labels).length === 0) return config;
  const components = Object.fromEntries(
    Object.entries(config.components).map(([name, component]) => [name, withComponentLabels(component, labels)]),
  );
  const categories =
    config.categories &&
    Object.fromEntries(
      Object.entries(config.categories).map(([name, category]) => [
        name,
        { ...category, ...(category.title !== undefined && { title: translated(labels, category.title) }) },
      ]),
    );
  return {
    ...config,
    components,
    ...(categories && { categories }),
    ...(config.root && { root: withComponentLabels(config.root, labels) }),
  } as Config;
}
