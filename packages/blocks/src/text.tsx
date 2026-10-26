import { classNameField, type TableCells, tableCells, tableField, useParts, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig, Slot } from "@puckeditor/core";
import { options, yesNo } from "./options.js";
import {
  DETAILS_PARTS,
  PREFORMATTED_PARTS,
  PULLQUOTE_PARTS,
  SEPARATOR_PARTS,
  TABLE_PARTS,
  VERSE_PARTS,
} from "./parts.js";

type SeparatorStyle = "default" | "wide" | "dots";

export interface SeparatorProps {
  style: SeparatorStyle;
  className: string;
}

const separatorClasses: Record<SeparatorStyle, string> = {
  default: "mx-auto my-8 w-24 border-0 border-t-2 border-border",
  wide: "my-8 w-full border-0 border-t border-border",
  dots: "mx-auto my-8 h-2 w-20 border-0 bg-[radial-gradient(circle,currentColor_0.15rem,transparent_0.2rem)] bg-[length:1.75rem_0.5rem] bg-center bg-repeat-x text-muted-foreground",
};

/** A line between parts of the page, as WordPress's Separator block draws it. */
export const Separator: ComponentConfig<SeparatorProps> = withParts(
  {
    label: "Separator",
    fields: {
      style: {
        type: "radio",
        label: "Style",
        options: options({ default: "Short line", wide: "Full width", dots: "Dots" }),
      },
      className: classNameField,
    },
    defaultProps: { style: "default", className: "" },
    render: ({ style = "default", className }) => {
      const part = useParts();
      return <hr className={part("gf-separator", separatorClasses[style], className)} />;
    },
  },
  SEPARATOR_PARTS,
);

type QuoteAlign = "left" | "center";

export interface PullquoteProps {
  quote: string;
  citation: string;
  align: QuoteAlign;
  className: string;
}

/** A quote shown large, set off from the text around it, with who said it. */
export const Pullquote: ComponentConfig<PullquoteProps> = withParts(
  {
    label: "Pullquote",
    fields: {
      quote: { type: "textarea", label: "Quote", contentEditable: true },
      citation: { type: "text", label: "Who said it", contentEditable: true },
      align: { type: "radio", label: "Alignment", options: options({ left: "Left", center: "Center" }) },
      className: classNameField,
    },
    defaultProps: { quote: "Write the quote here.", citation: "", align: "center", className: "" },
    render: ({ quote, citation, align, className }) => {
      const part = useParts();
      return (
        <figure
          className={part(
            "gf-pullquote",
            "my-8 border-y-4 border-primary py-8",
            align === "center" ? "text-center" : "text-left",
            className,
          )}
        >
          <blockquote
            className={part("gf-pullquote-quote", "font-heading text-2xl leading-snug whitespace-pre-line md:text-3xl")}
          >
            <p>{quote}</p>
          </blockquote>
          {citation && (
            <figcaption className={part("gf-pullquote-citation", "mt-4 text-sm text-muted-foreground uppercase")}>
              {citation}
            </figcaption>
          )}
        </figure>
      );
    },
  },
  PULLQUOTE_PARTS,
);

export interface PreformattedProps {
  text: string;
  className: string;
}

/** Text shown exactly as it's typed, spaces and line breaks included, in a fixed-width font. */
export const Preformatted: ComponentConfig<PreformattedProps> = withParts(
  {
    label: "Preformatted text",
    fields: {
      text: { type: "textarea", label: "Text" },
      className: classNameField,
    },
    defaultProps: { text: "", className: "" },
    render: ({ text, className }) => {
      const part = useParts();
      return (
        <pre
          className={part("gf-preformatted", "overflow-x-auto rounded-md bg-muted p-4 font-mono text-sm", className)}
        >
          {text}
        </pre>
      );
    },
  },
  PREFORMATTED_PARTS,
);

export interface VerseProps {
  text: string;
  className: string;
}

/** Poetry or lyrics: the lines and spaces as they're typed, in the page's own font. */
export const Verse: ComponentConfig<VerseProps> = withParts(
  {
    label: "Verse",
    fields: {
      text: { type: "textarea", label: "Verse" },
      className: classNameField,
    },
    defaultProps: { text: "", className: "" },
    render: ({ text, className }) => {
      const part = useParts();
      return <pre className={part("gf-verse", "[font-family:inherit] whitespace-pre-wrap", className)}>{text}</pre>;
    },
  },
  VERSE_PARTS,
);

export interface DetailsProps {
  summary: string;
  open: boolean;
  content: Slot;
  className: string;
}

/** A summary that opens to show more, with no JavaScript: the browser's own `<details>`. */
export const Details: ComponentConfig<DetailsProps> = withParts(
  {
    label: "Details",
    fields: {
      summary: { type: "text", label: "Summary", contentEditable: true },
      open: { type: "radio", label: "Open at first", options: yesNo },
      content: { type: "slot" },
      className: classNameField,
    },
    defaultProps: { summary: "More details", open: false, content: [], className: "" },
    render: ({ summary, open, content: Content, className, puck }) => {
      const part = useParts();
      return (
        // Always open in the editor, so what's inside can be edited.
        <details open={open || puck?.isEditing || undefined} className={part("gf-details", "my-4", className)}>
          <summary className={part("gf-details-summary", "cursor-pointer font-semibold")}>{summary}</summary>
          <Content className={part("gf-details-content", "mt-3")} />
        </details>
      );
    },
  },
  DETAILS_PARTS,
);

export interface TableProps {
  cells: TableCells;
  /** Whether the first row is the columns' headings. */
  header: boolean;
  /** Whether the last row is a footer, such as totals. */
  footer: boolean;
  caption: string;
  striped: boolean;
  className: string;
}

/** A table of text, with an optional row of headings and a footer, as WordPress's Table block has. */
export const Table: ComponentConfig<TableProps> = withParts(
  {
    label: "Table",
    fields: {
      cells: tableField("Cells"),
      header: { type: "radio", label: "First row is headings", options: yesNo },
      footer: { type: "radio", label: "Last row is a footer", options: yesNo },
      caption: { type: "text", label: "Caption" },
      striped: { type: "radio", label: "Stripes", options: yesNo },
      className: classNameField,
    },
    defaultProps: {
      cells: [
        ["", ""],
        ["", ""],
      ],
      header: true,
      footer: false,
      caption: "",
      striped: false,
      className: "",
    },
    render: ({ cells, header, footer, caption, striped, className }) => {
      const part = useParts();
      const rows = tableCells(cells);
      const head = header && rows.length > 1 ? rows[0] : undefined;
      const foot = footer && rows.length > (head ? 2 : 1) ? rows[rows.length - 1] : undefined;
      const body = rows.slice(head ? 1 : 0, foot ? -1 : undefined);
      const cellClass = part("gf-table-cell", "border border-border px-3 py-2 align-top");
      const headingClass = part("gf-table-header-cell", "border border-border bg-muted px-3 py-2 font-semibold");
      const rowClass = part("gf-table-row", striped && "even:bg-muted/50");
      return (
        <figure className={part("gf-table", "my-6 overflow-x-auto", className)}>
          <table className={part("gf-table-grid", "w-full border-collapse text-left text-sm")}>
            {caption && (
              <caption className={part("gf-table-caption", "mt-2 caption-bottom text-sm text-muted-foreground")}>
                {caption}
              </caption>
            )}
            {head && (
              <thead>
                <tr className={part("gf-table-row")}>
                  {head.map((cell, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: cells have no ids, and their order is what they are
                    <th key={index} scope="col" className={headingClass}>
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((row, rowIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows have no ids, and their order is what they are
                <tr key={rowIndex} className={rowClass}>
                  {row.map((cell, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: cells have no ids, and their order is what they are
                    <td key={index} className={cellClass}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {foot && (
              <tfoot>
                <tr className={part("gf-table-row")}>
                  {foot.map((cell, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: cells have no ids, and their order is what they are
                    <td key={index} className={part("gf-table-cell", "border border-border px-3 py-2 font-semibold")}>
                      {cell}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </figure>
      );
    },
  },
  TABLE_PARTS,
);
