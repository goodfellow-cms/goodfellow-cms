/**
 * A full-stack site's content as its repository has it now, for its server to
 * render pages from, so a publish shows once the pages it changed are rendered
 * again, without a rebuild (see `goodfellowPages({ source })` in
 * `@goodfellow-cms/next`).
 */

import { type ContentSource, prefetchedSource } from "./content/load.js";
import type { ServerGit } from "./git.js";
import { builtSource } from "./site-copy.js";

export interface RepositorySourceOptions {
  /**
   * The server's environment, read as builds read it (`builtSource()`): a copy
   * of the site's address and search engine setting, and how pages' addresses end.
   */
  env?: Readonly<Record<string, string | undefined>>;
  /** How many revisions' files to keep in memory, newest last. Defaults to 2. */
  keep?: number;
}

/**
 * A function giving the site's files at the newest revision of its live
 * branch: it asks the host for the revision each time, which is one request,
 * and reads every content file once per revision, in as few requests as the
 * host allows (`prefetchedSource()`), keeping the last few revisions' files.
 */
export function repositorySource(git: ServerGit, options: RepositorySourceOptions = {}): () => Promise<ContentSource> {
  const keep = Math.max(1, options.keep ?? 2);
  const kept = new Map<string, Promise<ContentSource>>();
  return async () => {
    const revision = await git.revision();
    let files = kept.get(revision);
    if (!files) {
      files = git.at(revision).then((backend) => prefetchedSource(backend));
      kept.set(revision, files);
      // A read that failed is tried again next time, rather than kept.
      files.catch(() => kept.delete(revision));
      for (const old of [...kept.keys()].slice(0, Math.max(0, kept.size - keep))) kept.delete(old);
    }
    const source = await files;
    return options.env ? builtSource(source, options.env) : source;
  };
}
