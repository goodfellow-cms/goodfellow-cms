/** The setup page's form controls, shared by its two steps. */
import { withBase } from "@goodfellow-cms/core";
import { useSite } from "@goodfellow-cms/react";
import { type ReactNode, useEffect, useState } from "react";

export const button =
  "inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50";
export const input = "w-full rounded-lg border border-border bg-background px-3 py-2";
export const link = "underline underline-offset-2";

export function Choice<T extends string>({
  name,
  value,
  current,
  label,
  description,
  badge,
  onChange,
}: {
  name: string;
  value: T;
  current: T | undefined;
  label: string;
  description?: string;
  badge?: string;
  onChange: (value: T) => void;
}) {
  const id = `${name}-${value}`;
  return (
    <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-muted">
      <input
        type="radio"
        name={name}
        value={value}
        checked={current === value}
        onChange={() => onChange(value)}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        className="mt-1 accent-primary"
      />
      <span>
        <span id={`${id}-label`} className="font-medium">
          {label}
        </span>
        {badge && (
          <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">{badge}</span>
        )}
        {description && (
          <span id={`${id}-description`} className="block text-sm text-muted-foreground">
            {description}
          </span>
        )}
      </span>
    </label>
  );
}

export function Question({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 font-heading text-lg font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

export function Note({ tone = "info", children }: { tone?: "info" | "warning"; children: ReactNode }) {
  return (
    <p
      role={tone === "warning" ? "alert" : undefined}
      className={
        tone === "warning"
          ? "rounded-lg border-2 border-primary bg-muted p-3 text-sm font-medium"
          : "rounded-lg bg-muted p-3 text-sm"
      }
    >
      {children}
    </p>
  );
}

export interface Starter {
  versions: Record<string, string>;
  files: Record<string, string | { base64: string }>;
  lockfile?: string;
}

export async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't load ${url} (${response.status}).`);
  return response.json();
}

/** Says when this copy of the docs packs its starters without lockfiles, as copies built on a computer do. */
export function LockfileWarning() {
  const { base } = useSite();
  const [hasLockfiles, setHasLockfiles] = useState(true);
  useEffect(() => {
    fetchJson(withBase("/starters/starter.json", base))
      .then((starter) => setHasLockfiles(Boolean((starter as Starter).lockfile)))
      .catch(() => setHasLockfiles(false));
  }, [base]);
  if (hasLockfiles) return null;
  return (
    <Note tone="warning">
      This copy of the documentation has no package-lock.json files, so sites it creates won't build until one is added.
      The published documentation includes them.
    </Note>
  );
}
