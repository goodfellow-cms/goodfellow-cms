/**
 * The AI assistant's changes (`EditorChange`) applied to a page's data, as
 * Puck applies them in the editor's frame, for editor plugins, which take the
 * whole page back (`PluginEditorHandle.set`).
 */
import type { ComponentData, Data } from "@puckeditor/core";
import type { EditorChange } from "./frame/protocol.js";

function isBlock(value: unknown): value is ComponentData {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ComponentData).type === "string" &&
    typeof (value as ComponentData).props === "object"
  );
}

/** `blocks` with the block whose id is `id` replaced, wherever it is, slots included; `undefined` if it isn't there. */
function replaced(blocks: ComponentData[], id: string, block: ComponentData): ComponentData[] | undefined {
  for (const [index, current] of blocks.entries()) {
    if (current.props.id === id) {
      // Puck keeps a replaced block's id, so the AI's answer can't change it.
      return blocks.with(index, { ...block, props: { ...block.props, id } });
    }
    for (const [name, value] of Object.entries(current.props)) {
      if (!Array.isArray(value) || !value.every(isBlock)) continue;
      const inside = replaced(value, id, block);
      if (inside) return blocks.with(index, { ...current, props: { ...current.props, [name]: inside } });
    }
  }
  return undefined;
}

/** `data` with the AI assistant's change made, as Puck makes it. Throws when the block being changed isn't there. */
export function applyEditorChange(data: Data, change: EditorChange): Data {
  switch (change.type) {
    case "root":
      return { ...data, root: { ...data.root, props: change.props } };
    case "translate":
      return {
        ...data,
        root: { ...data.root, props: { ...data.root.props, ...change.props } },
        content: change.content,
      };
    case "replace": {
      const content = replaced(data.content, change.id, change.block);
      if (!content) throw new Error("The block being changed is no longer on the page.");
      return { ...data, content };
    }
    case "append":
      return { ...data, content: [...data.content, ...change.blocks] };
    case "detach":
      if (!findBlock(data, change.id)) throw new Error("The block being changed is no longer on the page.");
      return withBlocksInPlace(data, change.id, change.blocks);
  }
}

/** Data with the block whose id is `id` replaced by `blocks`, wherever it is: in the page, a slot or a drop zone. */
export function withBlocksInPlace(data: Data, id: string, blocks: ComponentData[]): Data {
  const replace = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.flatMap((item) => (isBlock(item) && item.props.id === id ? blocks : [replace(item)]));
    }
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
  };
  return replace(data) as Data;
}

/** The block whose id is `id`, wherever it is in `data`, slots included, or `null`. */
export function findBlock(data: Data, id: string | null): ComponentData | null {
  if (!id) return null;
  const search = (blocks: ComponentData[]): ComponentData | null => {
    for (const block of blocks) {
      if (block.props.id === id) return block;
      for (const value of Object.values(block.props)) {
        if (!Array.isArray(value) || !value.every(isBlock)) continue;
        const found = search(value);
        if (found) return found;
      }
    }
    return null;
  };
  return search(data.content);
}
