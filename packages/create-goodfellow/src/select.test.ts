import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { menuLines, rowsFor, select } from "./select.js";

const CHOICES = [
  { value: "starter", label: "Starter", note: "A simple site" },
  { value: "parish", label: "Parish example" },
  { value: "next", label: "Starter for Next.js", note: "For developers" },
];

/** A terminal for the menu: keys typed into `input`, and what it wrote. */
function terminal(columns = 80) {
  const modes: boolean[] = [];
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode(mode: boolean) {
      modes.push(mode);
      input.isRaw = mode;
      return input;
    },
  });
  let written = "";
  const output = {
    columns,
    write(text: string) {
      written += text;
      return true;
    },
  };
  return {
    input,
    output,
    modes,
    written: () => written,
    type: (...keys: string[]) => {
      for (const key of keys) input.write(key);
    },
  };
}

const DOWN = "\x1b[B";
const UP = "\x1b[A";

describe("select", () => {
  it("starts on the first choice and chooses it with Enter", async () => {
    const t = terminal();
    const answer = select("Start from:", CHOICES, t.input, t.output);
    t.type("\r");
    expect(await answer).toBe("starter");
  });

  it("moves with the arrow keys, going round at either end", async () => {
    const t = terminal();
    const down = select("Start from:", CHOICES, t.input, t.output);
    t.type(DOWN, DOWN, "\r");
    expect(await down).toBe("next");

    const round = select("Start from:", CHOICES, t.input, t.output);
    t.type(UP, "\r");
    expect(await round).toBe("next");

    const back = select("Start from:", CHOICES, t.input, t.output);
    t.type(DOWN, DOWN, DOWN, "\r");
    expect(await back).toBe("starter");
  });

  it("moves with j and k, Tab, Home and End, and numbers", async () => {
    const t = terminal();
    const keys = select("Start from:", CHOICES, t.input, t.output);
    t.type("j", "j", "k", "\r");
    expect(await keys).toBe("parish");

    const tab = select("Start from:", CHOICES, t.input, t.output);
    t.type("\t", "\t", "\x1b[Z", "\r");
    expect(await tab).toBe("parish");

    const ends = select("Start from:", CHOICES, t.input, t.output);
    t.type("\x1b[F", "\r");
    expect(await ends).toBe("next");

    const number = select("Start from:", CHOICES, t.input, t.output);
    t.type("3", "9", "2", "\r");
    expect(await number).toBe("parish");
  });

  it("can choose a choice whose value is undefined", async () => {
    const t = terminal();
    const answer = select(
      "Where?",
      [
        { value: "github", label: "GitHub" },
        { value: undefined, label: "Not decided yet" },
      ],
      t.input,
      t.output,
    );
    t.type(DOWN, "\r");
    expect(await answer).toBeUndefined();
  });

  it("replaces the menu with the answer, and puts the terminal back as it was", async () => {
    const t = terminal();
    const answer = select("Start from:", CHOICES, t.input, t.output);
    t.type(DOWN, "\r");
    await answer;
    expect(t.modes).toEqual([true, false]);
    expect(t.input.listenerCount("keypress")).toBe(0);
    const written = t.written();
    expect(written.startsWith("\x1b[?25l")).toBe(true);
    // The menu is 7 rows: the question, three choices, two notes and the hint.
    expect(written.endsWith("\x1b[7A\r\x1b[JStart from: Parish example\n\x1b[?25h")).toBe(true);
    expect(written).toContain("› Parish example");
  });

  it("stops on Ctrl+C with an AbortError, clearing the menu", async () => {
    const t = terminal();
    const answer = select("Start from:", CHOICES, t.input, t.output);
    t.type("\x03");
    await expect(answer).rejects.toMatchObject({ code: "ABORT_ERR" });
    expect(t.modes).toEqual([true, false]);
    expect(t.written().endsWith("\x1b[7A\r\x1b[J\x1b[?25h")).toBe(true);
  });

  it("goes back over lines that wrapped in a narrow terminal", async () => {
    const t = terminal(10);
    const answer = select("Start from:", CHOICES, t.input, t.output);
    t.type(DOWN);
    t.type("\r");
    await answer;
    const rows = rowsFor(menuLines("Start from:", CHOICES, 0), 10);
    expect(rows).toBeGreaterThan(7);
    expect(t.written()).toContain(`\x1b[${rows}A\r\x1b[J`);
  });
});

describe("menuLines", () => {
  it("marks the chosen line, with notes under their choices", () => {
    expect(menuLines("Start from:", CHOICES, 2)).toEqual([
      "Start from:",
      "  Starter",
      "    A simple site",
      "  Parish example",
      "› Starter for Next.js",
      "    For developers",
      "  ↑ and ↓ to move, Enter to choose",
    ]);
  });

  it("colors only when asked", () => {
    expect(menuLines("Q", CHOICES, 0, true)[1]).toBe("\x1b[36m› Starter\x1b[39m");
  });
});

describe("rowsFor", () => {
  it("counts wrapped lines, leaving out colors", () => {
    expect(rowsFor(["", "abc", "\x1b[36mabcdefghij\x1b[39m", "abcdefghijk"], 10)).toBe(5);
  });
});
