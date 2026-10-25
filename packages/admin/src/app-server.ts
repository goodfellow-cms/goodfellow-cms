import {
  APP_API_HEADER,
  type AppSession,
  ConflictError,
  type DeployStatus,
  decodeBase64,
  encodeBase64Bytes,
  type FileChange,
  type FileVersion,
  type GitBackend,
  PluginTaskError,
  type RevisionFiles,
  SignInError,
  type TaskSecretsPlace,
} from "@goodfellow-cms/core";

/** Thrown when the site's server refuses something, such as an editor changing settings only owners may change. */
export class AppServerError extends Error {
  override name = "AppServerError";

  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(
      code === "owners-only"
        ? "Only the site's owners can change this."
        : code === "git" || code === "git-sign-in"
          ? "The site's server couldn't reach where the site is stored."
          : `The site's server answered ${status} (${code}).`,
    );
  }
}

/** A full-stack site's API for the admin panel, at `api`, such as `/api/goodfellow`. */
export function appServer(api: string) {
  const base = api.replace(/\/+$/, "");

  async function request(
    endpoint: string,
    {
      query,
      body,
      missingIsFine = false,
    }: { query?: Record<string, string>; body?: unknown; missingIsFine?: boolean } = {},
  ): Promise<Response> {
    // With a trailing slash, as Next.js sites with `trailingSlash` serve their routes.
    const search = query ? `?${new URLSearchParams(query)}` : "";
    const response = await fetch(`${base}/${endpoint}/${search}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        [APP_API_HEADER]: "1",
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      credentials: "same-origin",
      cache: "no-store",
    });
    if (response.ok || (response.status === 404 && missingIsFine)) return response;
    if (response.status === 409) throw new ConflictError();
    const answer = (await response.json().catch(() => ({}))) as { error?: string; problem?: string };
    // A plugin's task that couldn't run, with why, which the admin panel puts in its own words.
    if (answer.error === "task") {
      const problem = ["missing", "not-allowed", "timeout"].includes(answer.problem ?? "") ? answer.problem : "failed";
      throw new PluginTaskError(problem as PluginTaskError["problem"], "The site's server couldn't run the task.");
    }
    // The site's own sign-in has ended, or no longer lets them edit.
    if (response.status === 401) throw new SignInError("invalid", "Signing in to the site has ended.");
    throw new AppServerError(response.status, answer.error ?? "error");
  }

  return {
    /**
     * Submits changes for a developer to review, which on a full-stack site
     * is how plugins are installed, updated and removed, since its builds and
     * server hold its secrets. Gives the review's address.
     */
    async review(
      changes: FileChange[],
      details: { title: string; description?: string; from: string },
    ): Promise<{ url: string }> {
      const body = {
        changes: changes.map((change) => ("bytes" in change ? { path: change.path } : change)),
        ...details,
      };
      return (await (await request("review", { body })).json()) as { url: string };
    },

    /** Who's signed in, and what they may do, or where to sign in. */
    async session(): Promise<AppSession> {
      return (await (await request("session")).json()) as AppSession;
    },

    /** The site's files through the server, as an editor signed in to it reads and publishes them. */
    backend(session: Extract<AppSession, { signedIn: true }>, onSignOut: () => void): GitBackend {
      let pinned: string | undefined;
      const revision = async () => {
        pinned = ((await (await request("revision")).json()) as { revision: string }).revision;
        return pinned;
      };
      const at = async () => pinned ?? (await revision());
      // Reads of the files at a revision: the one loaded, or an earlier one.
      const files = (which: () => Promise<string>): RevisionFiles => ({
        async read(path) {
          const response = await request("file", { query: { path, revision: await which() }, missingIsFine: true });
          return response.status === 404 ? undefined : ((await response.json()) as { content: string }).content;
        },
        async readBytes(path) {
          const response = await request("file", {
            query: { path, revision: await which(), as: "bytes" },
            missingIsFine: true,
          });
          return response.status === 404
            ? undefined
            : decodeBase64(((await response.json()) as { base64: string }).base64);
        },
        async list(dir) {
          return (
            (await (await request("files", { query: { dir, revision: await which() } })).json()) as {
              files: string[];
            }
          ).files;
        },
        async readFiles(paths) {
          const answer = (await (await request("files", { body: { paths, revision: await which() } })).json()) as {
            files: Record<string, string>;
          };
          return new Map(Object.entries(answer.files));
        },
      });
      return {
        user: session.user,
        ...(session.contentOnly && { contentOnly: true }),
        revision,
        ...files(at),
        filesAt: (earlier) => files(() => Promise.resolve(earlier)),
        async write(changes, { message, expectedRevision }) {
          const saved = (await (
            await request("write", {
              body: {
                // JSON can't carry bytes, so uploads go as base64.
                changes: changes.map((change) =>
                  "bytes" in change ? { path: change.path, base64: encodeBase64Bytes(change.bytes) } : change,
                ),
                message,
                expectedRevision,
              },
            })
          ).json()) as { revision: string };
          pinned = saved.revision;
          return saved;
        },
        async changedPaths(from, to) {
          return ((await (await request("changed", { query: { from, to } })).json()) as { paths: string[] }).paths;
        },
        async deployStatus(revision) {
          return (await (await request("deploy", { query: { revision } })).json()) as DeployStatus;
        },
        async history(path, { page = 1, perPage = 20 } = {}) {
          const query = { path, revision: await at(), page: String(page), perPage: String(perPage) };
          return ((await (await request("history", { query })).json()) as { versions: FileVersion[] }).versions;
        },
        async readAt(path, revision) {
          const response = await request("version", { query: { path, revision }, missingIsFine: true });
          return response.status === 404 ? undefined : ((await response.json()) as { content: string }).content;
        },
        // Plugins' tasks, run in the site's CI as on a static site; their answers are sealed to this browser's key.
        tasks: {
          async supported() {
            const response = await request("task", { missingIsFine: true }).catch(() => undefined);
            return response?.ok === true && ((await response.json()) as { supported?: boolean }).supported === true;
          },
          async secretsPlace() {
            const response = await request("task", { missingIsFine: true }).catch(() => undefined);
            if (!response?.ok) return undefined;
            return ((await response.json()) as { place?: TaskSecretsPlace }).place;
          },
          async run(task) {
            return ((await (await request("task", { body: task })).json()) as { result: string }).result;
          },
        },
        signOut: onSignOut,
      };
    },
  };
}
