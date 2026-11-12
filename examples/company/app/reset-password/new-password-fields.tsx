"use client";

/** The fewest characters a password may have, as lib/auth.ts says. */
export const MIN_PASSWORD_LENGTH = 12;

/** What's wrong with a new password and its second copy, or nothing. */
export function passwordProblem(password: string, again: string): string | undefined {
  if (password.length < MIN_PASSWORD_LENGTH) return `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== again) return "The two passwords aren't the same.";
  return undefined;
}

/** A new password, typed twice. */
export function NewPasswordFields() {
  return (
    <>
      <label className="grid gap-1">
        New password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          className="rounded border px-3 py-2"
        />
      </label>
      <label className="grid gap-1">
        The same password again
        <input
          name="again"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          className="rounded border px-3 py-2"
        />
      </label>
    </>
  );
}
