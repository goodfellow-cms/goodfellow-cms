/**
 * The grid of cells a table's field is edited in (`tableField()` in
 * `@goodfellow-cms/react`), which Puck's editor shows in place of the field's
 * own render, since blocks can't bring their own editing code.
 */
import { isTableField, type TableCells, tableCells } from "@goodfellow-cms/react";
import type { Config, CustomField, Field, Fields } from "@puckeditor/core";
import { useStrings } from "../strings.js";

const MAX_ROWS = 100;
const MAX_COLUMNS = 12;

function TableCellsField({
  value,
  onChange,
  readOnly,
  label,
}: {
  value: unknown;
  onChange: (value: TableCells) => void;
  readOnly?: boolean;
  label?: string;
}) {
  const t = useStrings();
  const rows = tableCells(value);
  const width = rows[0]?.length ?? 1;
  const set = (row: number, column: number, text: string) =>
    onChange(rows.map((cells, r) => (r === row ? cells.map((cell, c) => (c === column ? text : cell)) : cells)));
  return (
    <div className="gfa-table-field">
      {label && <div className="gfa-table-field-label">{label}</div>}
      <div className="gfa-table-field-grid" style={{ gridTemplateColumns: `repeat(${width}, minmax(6rem, 1fr)) auto` }}>
        {rows.map((cells, row) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no ids, and their order is what they are
          <div key={row} className="gfa-table-field-row">
            {cells.map((cell, column) => (
              <input
                // biome-ignore lint/suspicious/noArrayIndexKey: cells have no ids, and their order is what they are
                key={column}
                className="gfa-input gfa-table-field-cell"
                value={cell}
                readOnly={readOnly}
                aria-label={t("table.cell", { row: String(row + 1), column: String(column + 1) })}
                onChange={(event) => set(row, column, event.target.value)}
              />
            ))}
            <button
              type="button"
              className="gfa-table-field-remove"
              disabled={readOnly || rows.length <= 1}
              title={t("table.removeRow")}
              aria-label={t("table.removeRowNumber", { row: String(row + 1) })}
              onClick={() => onChange(rows.filter((_, r) => r !== row))}
            >
              ×
            </button>
          </div>
        ))}
        <div className="gfa-table-field-row">
          {Array.from({ length: width }, (_, column) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: columns have no ids, and their order is what they are
              key={column}
              type="button"
              className="gfa-table-field-remove"
              disabled={readOnly || width <= 1}
              title={t("table.removeColumn")}
              aria-label={t("table.removeColumnNumber", { column: String(column + 1) })}
              onClick={() => onChange(rows.map((cells) => cells.filter((_, c) => c !== column)))}
            >
              ×
            </button>
          ))}
        </div>
      </div>
      <div className="gfa-table-field-actions">
        <button
          type="button"
          className="gfa-button gfa-button-secondary"
          disabled={readOnly || rows.length >= MAX_ROWS}
          onClick={() => onChange([...rows, Array<string>(width).fill("")])}
        >
          {t("table.addRow")}
        </button>
        <button
          type="button"
          className="gfa-button gfa-button-secondary"
          disabled={readOnly || width >= MAX_COLUMNS}
          onClick={() => onChange(rows.map((cells) => [...cells, ""]))}
        >
          {t("table.addColumn")}
        </button>
      </div>
    </div>
  );
}

// biome-ignore lint/suspicious/noExplicitAny: Puck fields hold any value
type AnyField = Field<any>;

function withTableField(field: AnyField): AnyField {
  if (field.type === "custom" && isTableField(field)) {
    const render: CustomField<TableCells>["render"] = ({ value, onChange, readOnly, field: own }) => (
      <TableCellsField value={value} onChange={onChange} readOnly={readOnly} label={own.label} />
    );
    return { ...field, render };
  }
  if (field.type === "array") return { ...field, arrayFields: withTableFieldsIn(field.arrayFields as Fields) };
  if (field.type === "object") return { ...field, objectFields: withTableFieldsIn(field.objectFields as Fields) };
  return field;
}

function withTableFieldsIn(fields: Fields | undefined): Fields {
  return Object.fromEntries(
    Object.entries(fields ?? {}).map(([name, field]) => [name, withTableField(field as AnyField)]),
  ) as Fields;
}

/** The config with every table's field edited as a grid of cells. */
export function withTableFields(config: Config): Config {
  const components = Object.fromEntries(
    Object.entries(config.components).map(([name, component]) => [
      name,
      component.fields ? { ...component, fields: withTableFieldsIn(component.fields as Fields) } : component,
    ]),
  );
  return { ...config, components } as Config;
}
