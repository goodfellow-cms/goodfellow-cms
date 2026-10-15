import { emitKeypressEvents } from "node:readline";
import { stripVTControlCharacters } from "node:util";

export interface Choice<T> {
  value: T;
  label: string;
  note?: string;
}

/** The parts of a terminal's input that a menu uses: `process.stdin` is one. */
export interface MenuInput extends NodeJS.EventEmitter {
  isRaw?: boolean;
  setRawMode?(mode: boolean): unknown;
  resume(): unknown;
  pause(): unknown;
}

/** The parts of a terminal's output that a menu uses: `process.stdout` is one. */
export interface MenuOutput {
  columns?: number;
  write(text: string): unknown;
  hasColors?(): boolean;
}

interface Key {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  shift?: boolean;
}

const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

/** How many rows `lines` take up in a terminal `columns` wide, counting lines that wrap. */
export function rowsFor(lines: string[], columns: number | undefined): number {
  const width = columns && columns > 0 ? columns : 80;
  return lines.reduce((rows, line) => rows + Math.max(1, Math.ceil(stripVTControlCharacters(line).length / width)), 0);
}

function painter(color: boolean) {
  const paint = (open: number, close: number) => (text: string) =>
    color ? `\x1b[${open}m${text}\x1b[${close}m` : text;
  return { bold: paint(1, 22), dim: paint(2, 22), cyan: paint(36, 39) };
}

/** The menu's lines, with the choice at `index` marked. */
export function menuLines<T>(question: string, choices: Choice<T>[], index: number, color = false): string[] {
  const { bold, dim, cyan } = painter(color);
  return [
    bold(question),
    ...choices.flatMap((choice, i) => {
      const label = i === index ? cyan(`› ${choice.label}`) : `  ${choice.label}`;
      return [label, ...(choice.note ? [dim(`    ${choice.note}`)] : [])];
    }),
    dim("  ↑ and ↓ to move, Enter to choose"),
  ];
}

class AbortError extends Error {
  code = "ABORT_ERR";
  constructor() {
    super("Stopped.");
  }
}

/**
 * Asks `question` with a menu of `choices` that the arrow keys move through, as
 * `create-next-app` does. Enter chooses, and the menu is replaced by the answer.
 * Ctrl+C rejects with an error whose `code` is `"ABORT_ERR"`. The input must be
 * a terminal, and nothing else may be reading it meanwhile.
 */
export function select<T>(
  question: string,
  choices: Choice<T>[],
  input: MenuInput = process.stdin,
  output: MenuOutput = process.stdout,
): Promise<T> {
  const color = output.hasColors?.() ?? false;
  const { cyan } = painter(color);
  let index = 0;
  let rows = 0;

  const draw = () => {
    const lines = menuLines(question, choices, index, color);
    // Back to the menu's first row, and clear it and everything below.
    output.write(`${rows > 0 ? `\x1b[${rows}A\r\x1b[J` : ""}${lines.join("\n")}\n`);
    rows = rowsFor(lines, output.columns);
  };

  return new Promise<T>((resolve, reject) => {
    const wasRaw = input.isRaw ?? false;
    const finish = (answer: string | undefined) => {
      input.off("keypress", onKey);
      input.setRawMode?.(wasRaw);
      input.pause();
      output.write(`\x1b[${rows}A\r\x1b[J${answer === undefined ? "" : `${question} ${cyan(answer)}\n`}${SHOW_CURSOR}`);
    };
    const onKey = (text: string | undefined, key: Key | undefined) => {
      const name = key?.name;
      if (key?.ctrl && name === "c") {
        finish(undefined);
        reject(new AbortError());
        return;
      }
      if (name === "return" || name === "enter") {
        const choice = choices[index] as Choice<T>;
        finish(choice.label);
        resolve(choice.value);
        return;
      }
      const last = choices.length - 1;
      if (name === "up" || name === "k" || (name === "tab" && key?.shift)) index = index === 0 ? last : index - 1;
      else if (name === "down" || name === "j" || name === "tab") index = index === last ? 0 : index + 1;
      else if (name === "home") index = 0;
      else if (name === "end") index = last;
      else if (text && /^[1-9]$/.test(text) && Number(text) <= choices.length) index = Number(text) - 1;
      else return;
      draw();
    };

    emitKeypressEvents(input as NodeJS.ReadableStream);
    input.setRawMode?.(true);
    input.on("keypress", onKey);
    input.resume();
    output.write(HIDE_CURSOR);
    draw();
  });
}
