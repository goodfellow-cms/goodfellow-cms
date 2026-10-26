import {
  BITBUCKET_PIPELINES,
  type CodeRepository,
  type FileVersion,
  GitApiError,
  type HistoryOptions,
  SignInError,
  type SiteUpdates,
} from "@goodfellow-cms/core";
import { type ApiOptions, bitbucketJson } from "./api.js";
import { bitbucketUpdates } from "./updates.js";
import { BITBUCKET_WEB } from "./web.js";

/** What the code repository's updates read from it, as a backend for it reads. */
export interface CodeFiles {
  revision(): Promise<string>;
  readAt(path: string, revision: string): Promise<string | undefined>;
  history(path: string, options?: HistoryOptions): Promise<FileVersion[]>;
}

function noAccess(error: unknown): boolean {
  return (
    (error instanceof SignInError && error.problem === "no-access") ||
    (error instanceof GitApiError && (error.status === 403 || error.status === 404))
  );
}

/**
 * The updates of a site whose content is kept in a repository of its own,
 * which run where its code is: the Updates screen reads the code
 * repository's `package.json` and its history, and its `bitbucket-pipelines.yml`
 * for an update pipeline, with the same sign-in. A repository access token
 * reaches only the repository it was made for, so the code repository is then
 * `no-access`.
 */
export function bitbucketCodeUpdates(
  read: ApiOptions,
  manage: () => ApiOptions | undefined,
  repo: string,
  open: (branch: string) => CodeFiles,
): SiteUpdates {
  let branch: Promise<string> | undefined;
  const liveBranch = () => {
    branch ??= bitbucketJson<{ mainbranch?: { name?: string } }>(read, `/repositories/${repo}`).then(
      (found) => found.mainbranch?.name ?? "main",
    );
    branch.catch(() => {
      branch = undefined;
    });
    return branch;
  };
  async function files() {
    return open(await liveBranch());
  }
  /** A file as it is now, since updates change the code. */
  async function readNow(path: string) {
    const code = await files();
    return code.readAt(path, await code.revision());
  }
  async function updates(): Promise<SiteUpdates> {
    return bitbucketUpdates(read, manage, repo, await liveBranch(), () => readNow(BITBUCKET_PIPELINES));
  }
  const code: CodeRepository = {
    repo,
    webUrl: `${BITBUCKET_WEB}/${repo}`,
    read: readNow,
    history: async (path, options) => (await files()).history(path, options),
    readAt: async (path, revision) => (await files()).readAt(path, revision),
  };
  return {
    code,
    async setup() {
      try {
        return await (await updates()).setup();
      } catch (error) {
        if (noAccess(error)) return "no-access";
        throw error;
      }
    },
    async enable() {
      await (await updates()).enable?.();
    },
    async lastRun() {
      try {
        return await (await updates()).lastRun();
      } catch (error) {
        if (noAccess(error)) return undefined;
        throw error;
      }
    },
    async start(target) {
      await (await updates()).start(target);
    },
    async rebuild() {
      await (await updates()).rebuild?.();
    },
  };
}
