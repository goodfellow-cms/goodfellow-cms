// What signing in and out looks like from the site's pages, shared by the header's Sign-in and account links and the
// members page, so both go to sign-in and sign out the same way.
import { cx } from "@goodfellow-cms/react";

/** Sign-in's address, coming back to `next`: a path of this site, with its query and `#…`, which sign-in checks. */
export function signInAddress(next: string): string {
  return `/sign-in/?${new URLSearchParams({ next })}`;
}

/** Where the browser is now, as sign-in's `next` takes it. */
export function currentPage(): string {
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

/** The form that signs out (app/sign-out/), which only the site's own pages may send. */
export function SignOutForm({ label, className }: { label: string; className?: string }) {
  return (
    <form method="post" action="/sign-out/">
      <button type="submit" className={cx("underline", className)}>
        {label}
      </button>
    </form>
  );
}
