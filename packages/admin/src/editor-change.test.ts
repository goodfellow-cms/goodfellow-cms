import type { Data } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import { applyEditorChange, findBlock } from "./editor-change.js";

const data = {
  root: { props: { title: "Visit", description: "" } },
  content: [
    {
      type: "Section",
      props: {
        id: "s1",
        content: [{ type: "Heading", props: { id: "h1", text: "Welcome" } }],
      },
    },
  ],
} as unknown as Data;

describe("the AI assistant's changes outside Puck", () => {
  it("replaces a block wherever it is, keeping its id", () => {
    const next = applyEditorChange(data, {
      type: "replace",
      id: "h1",
      block: { type: "Heading", props: { id: "other", text: "Hello" } },
    });
    expect(findBlock(next, "h1")?.props).toEqual({ id: "h1", text: "Hello" });
    // What was there is left as it was.
    expect(findBlock(data, "h1")?.props.text).toBe("Welcome");
    expect(() =>
      applyEditorChange(data, { type: "replace", id: "gone", block: { type: "Heading", props: { id: "x" } } }),
    ).toThrow(/no longer on the page/);
  });

  it("sets the page's settings, translates and adds blocks at the end", () => {
    expect(applyEditorChange(data, { type: "root", props: { title: "Come" } }).root.props).toEqual({ title: "Come" });
    const translated = applyEditorChange(data, {
      type: "translate",
      props: { title: "Visitar" },
      content: [{ type: "Heading", props: { id: "h2", text: "Bienvenidos" } }],
    });
    expect(translated.root.props).toEqual({ title: "Visitar", description: "" });
    expect(translated.content.map((block) => block.props.id)).toEqual(["h2"]);
    const added = applyEditorChange(data, { type: "append", blocks: [{ type: "Heading", props: { id: "h3" } }] });
    expect(added.content.map((block) => block.props.id)).toEqual(["s1", "h3"]);
  });

  it("finds the selected block, or none", () => {
    expect(findBlock(data, "s1")?.type).toBe("Section");
    expect(findBlock(data, null)).toBeNull();
    expect(findBlock(data, "nowhere")).toBeNull();
  });
});
