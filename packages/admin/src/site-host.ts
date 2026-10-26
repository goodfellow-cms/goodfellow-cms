import { outsideHost } from "@goodfellow-cms/core";
import { useEffect, useState } from "react";
import { useAdmin } from "./admin-context.js";

/**
 * The host outside GitHub, GitLab and Bitbucket that builds the site, as its setup files
 * say, such as Cloudflare Pages: `undefined` while they're read, `null` for none.
 * They're outside the folders the site's files are read from, so they're read
 * as version history reads files, at the loaded revision.
 */
export function useOutsideHost(): "cloudflare-pages" | "vercel" | null | undefined {
  const { readFile, versions, state } = useAdmin();
  const revision = state.status === "ready" ? state.revision : undefined;
  const [host, setHost] = useState<"cloudflare-pages" | "vercel" | null>();
  useEffect(() => {
    let cancelled = false;
    const read = versions && revision ? (path: string) => versions.readAt(path, revision) : readFile;
    void outsideHost(read).then(
      (found) => !cancelled && setHost(found ?? null),
      () => !cancelled && setHost(null),
    );
    return () => {
      cancelled = true;
    };
  }, [readFile, versions, revision]);
  return host;
}
