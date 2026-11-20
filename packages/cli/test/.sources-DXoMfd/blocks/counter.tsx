"use client";

import { SiteLink, useSite } from "@goodfellow-cms/react";
import { type ReactNode, useState } from "react";
import { useShout } from "./shout";

export function Counter({ label, children }: { label: string; children?: ReactNode }) {
  const [count, setCount] = useState(0);
  const { path } = useSite();
  return (
    <div className="counter">
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        {useShout(label)} {count} times on {path}
      </button>
      {children}
      <SiteLink href="/news">News</SiteLink>
    </div>
  );
}

export const NOT_A_COMPONENT = "plain value";
