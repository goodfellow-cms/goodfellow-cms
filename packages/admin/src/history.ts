import { useCallback, useEffect, useState } from "react";

/** Undo and redo for a form's values: earlier values, the current ones, and those undone. */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** The one field the last change touched, while further changes to it still count as the same step. */
  group?: { path: string; at: number };
}

/** Changes to the same field this close together are one step, so undo takes back a word or more, not a letter. */
export const GROUP_MS = 1000;
/** How many steps undo can go back. */
export const HISTORY_LIMIT = 100;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

function isPlainValue(value: unknown): boolean {
  return value === null || typeof value !== "object";
}

const SAME = Symbol("same");
const SEVERAL = Symbol("several");

function difference(before: unknown, after: unknown, path: string): string | typeof SAME | typeof SEVERAL {
  if (Object.is(before, after)) return SAME;
  // Including a field that's empty on one side, such as the first letter typed into it.
  if (isPlainValue(before) || isPlainValue(after)) return isPlainValue(before) && isPlainValue(after) ? path : SEVERAL;
  if (Array.isArray(before) !== Array.isArray(after)) return SEVERAL;
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  if (Array.isArray(before) && before.length !== (after as unknown[]).length) return SEVERAL;
  let found: string | typeof SAME = SAME;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const inner = difference(a[key], b[key], path ? `${path}.${key}` : key);
    if (inner === SAME) continue;
    if (inner === SEVERAL || found !== SAME) return SEVERAL;
    found = inner;
  }
  return found;
}

/**
 * The path of the single plain value (text, number, true, or false) that differs
 * between two values, such as `settings.theme.colors.primary`. Undefined when
 * nothing differs, or more than that does: several fields, or items added or removed.
 */
export function changedField(before: unknown, after: unknown): string | undefined {
  const result = difference(before, after, "");
  return typeof result === "string" ? result : undefined;
}

/** Records a change, joining it to the last step when it's more typing in the same field. */
export function record<T>(history: History<T>, next: T, now: number): History<T> {
  // A copy with the same values, such as a field reporting what it already had, isn't a step.
  if (Object.is(next, history.present) || difference(history.present, next, "") === SAME) return history;
  const path = changedField(history.present, next);
  const group = path === undefined ? undefined : { path, at: now };
  const last = history.group;
  if (group && last && last.path === path && now - last.at < GROUP_MS && history.past.length > 0) {
    return { ...history, present: next, future: [], group };
  }
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
    ...(group && { group }),
  };
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redo<T>(history: History<T>): History<T> {
  const [next, ...future] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future };
}

/** Whether a key press belongs to a text field, which has its own undo. */
function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !["button", "checkbox", "color", "radio", "range"].includes(target.type);
}

/**
 * Values with undo and redo, also on Ctrl+Z and Ctrl+Shift+Z (⌘ on a Mac) or Ctrl+Y
 * outside text fields, which keep their own undo.
 */
export function useHistory<T>(initial: T) {
  const [history, setHistory] = useState(() => createHistory(initial));

  const update = useCallback((change: (present: T) => T) => {
    setHistory((current) => record(current, change(current.present), Date.now()));
  }, []);
  const undoChange = useCallback(() => setHistory(undo), []);
  const redoChange = useCallback(() => setHistory(redo), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || inTextField(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undoChange();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redoChange();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [undoChange, redoChange]);

  return {
    present: history.present,
    update,
    undo: undoChange,
    redo: redoChange,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
