"use client";

import { createContext, useContext } from "react";

export const Punctuation = createContext("!");

/** A hook another Client Component imports, which must stay a hook rather than become an island. */
export function useShout(text: string): string {
  return `${text}${useContext(Punctuation)}`;
}
