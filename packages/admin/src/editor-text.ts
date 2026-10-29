import { createContext, useContext } from "react";

/**
 * What the editor's frames show in the admin panel's language besides its own
 * text: Puck's (its `dictionary`), and blocks' labels by their English
 * wording. A module of its own, so frames never bundle a language's loader.
 */
export interface EditorText {
  puck: Record<string, string>;
  labels: Record<string, string>;
}

export const EditorTextContext = createContext<EditorText>({ puck: {}, labels: {} });

/** Puck's text and blocks' labels in the admin panel's language, which the page gives its frames. */
export function useEditorText(): EditorText {
  return useContext(EditorTextContext);
}
