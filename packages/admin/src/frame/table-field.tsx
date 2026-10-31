/**
 * The grid of cells a table's field is edited in (`tableField()` in
 * `@goodfellow-cms/react`), which Puck's editor shows in place of the field's
 * own render, since blocks can't bring their own editing code. Each cell is
 * a small box of formatted text: bold, italics, links and line breaks, with
 * what's pasted kept to those (`tableCellHtml()`).
 */
import { escapeCellText, isSafeUrl, tableCellHtml } from "@goodfellow-cms/core";
import { isTableField, type TableCells, tableCells } from "@goodfellow-cms/react";
import type { Config, CustomField, Field, Fields } from "@puckeditor/core";
import { type FormEvent, useLayoutEffect, useRef, useState } from "react";
import { useStrings } from "../strings.js";

const MAX_ROWS = 100;
const MAX_COLUMNS = 12;

/** One cell, as formatted text. What it holds comes from the cell's value, except while it's being typed in. */
function RichCell({
  value,
  label,
  readOnly,
  onChange,
  onFocus,
}: {
  value: string;
  label: string;
  readOnly?: boolean;
  onChange: (html: string) => void;
  onFocus: (cell: HTMLDivElement) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const cell = ref.current;
    if (!cell || document.activeElement === cell) return;
    const html = tableCellHtml(value);
    if (cell.innerHTML !== html) cell.innerHTML = html;
  }, [value]);
  const changed = () => {
    if (ref.current) onChange(tableCellHtml(ref.current.innerHTML));
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: formatted text is typed in an element that's editable, not an input
    <div
      ref={ref}
      role="textbox"
      tabIndex={0}
      aria-label={label}
      aria-multiline="true"
      aria-readonly={readOnly || undefined}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      className="gfa-input gfa-table-field-cell gfa-table-field-rich"
      onInput={changed}
      onFocus={() => ref.current && onFocus(ref.current)}
      onKeyDown={(event) => {
        // A cell is one paragraph, so Enter starts a new line in it.
        if (event.key === "Enter") {
          event.preventDefault();
          document.execCommand("insertLineBreak");
        } else if ((event.ctrlKey || event.metaKey) && (event.key === "b" || event.key === "i")) {
          event.preventDefault();
          document.execCommand(event.key === "b" ? "bold" : "italic");
        }
      }}
      onPaste={(event) => {
        event.preventDefault();
        const html = event.clipboardData.getData("text/html");
        const text = event.clipboardData.getData("text/plain");
        document.execCommand("insertHTML", false, html ? tableCellHtml(html) : escapeCellText(text));
      }}
    />
  );
}

/** Bold, italics and links for the cell last typed in. */
function CellToolbar({ cell, readOnly }: { cell: HTMLDivElement | undefined; readOnly?: boolean }) {
  const t = useStrings();
  const [linking, setLinking] = useState<{ range: Range | undefined; address: string }>();
  const disabled = readOnly || !cell;
  const command = (name: string, argument?: string) => {
    cell?.focus();
    document.execCommand(name, false, argument);
  };
  const startLink = () => {
    const selection = document.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined;
    setLinking({ range: range && cell?.contains(range.commonAncestorContainer) ? range : undefined, address: "" });
  };
  const applyLink = (event: FormEvent) => {
    event.preventDefault();
    const address = linking?.address.trim() ?? "";
    if (cell && linking?.range && address && isSafeUrl(address)) {
      cell.focus();
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(linking.range);
      document.execCommand("createLink", false, address);
    }
    setLinking(undefined);
  };
  // Buttons keep the cell's selection: pressing one doesn't take the focus.
  const keep = (event: { preventDefault(): void }) => event.preventDefault();
  return (
    <div className="gfa-table-field-toolbar">
      <button
        type="button"
        className="gfa-table-field-tool"
        disabled={disabled}
        onMouseDown={keep}
        onClick={() => command("bold")}
      >
        <strong>{t("table.bold")}</strong>
      </button>
      <button
        type="button"
        className="gfa-table-field-tool"
        disabled={disabled}
        onMouseDown={keep}
        onClick={() => command("italic")}
      >
        <em>{t("table.italic")}</em>
      </button>
      <button type="button" className="gfa-table-field-tool" disabled={disabled} onMouseDown={keep} onClick={startLink}>
        {t("table.link")}
      </button>
      <button
        type="button"
        className="gfa-table-field-tool"
        disabled={disabled}
        onMouseDown={keep}
        onClick={() => command("unlink")}
      >
        {t("table.unlink")}
      </button>
      {linking && (
        <form className="gfa-table-field-link" onSubmit={applyLink}>
          <input
            className="gfa-input"
            aria-label={t("table.linkAddress")}
            placeholder="/about"
            value={linking.address}
            // biome-ignore lint/a11y/noAutofocus: the address is what's asked for once Link is pressed
            autoFocus
            onChange={(event) => setLinking({ ...linking, address: event.target.value })}
          />
          <button type="submit" className="gfa-button gfa-button-secondary" disabled={!linking.range}>
            {t("table.linkApply")}
          </button>
          <button type="button" className="gfa-button gfa-button-secondary" onClick={() => setLinking(undefined)}>
            {t("action.cancel")}
          </button>
          {!linking.range && <p className="gfa-hint">{t("table.linkSelect")}</p>}
        </form>
      )}
    </div>
  );
}

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
  const [active, setActive] = useState<HTMLDivElement>();
  const rows = tableCells(value);
  const width = rows[0]?.length ?? 1;
  const set = (row: number, column: number, text: string) =>
    onChange(rows.map((cells, r) => (r === row ? cells.map((cell, c) => (c === column ? text : cell)) : cells)));
  return (
    <div className="gfa-table-field">
      {label && <div className="gfa-table-field-label">{label}</div>}
      <CellToolbar cell={active?.isConnected ? active : undefined} readOnly={readOnly} />
      <div className="gfa-table-field-grid" style={{ gridTemplateColumns: `repeat(${width}, minmax(6rem, 1fr)) auto` }}>
        {rows.map((cells, row) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no ids, and their order is what they are
          <div key={row} className="gfa-table-field-row">
            {cells.map((cell, column) => (
              <RichCell
                // biome-ignore lint/suspicious/noArrayIndexKey: cells have no ids, and their order is what they are
                key={column}
                value={cell}
                readOnly={readOnly}
                label={t("table.cell", { row: String(row + 1), column: String(column + 1) })}
                onChange={(html) => set(row, column, html)}
                onFocus={setActive}
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
