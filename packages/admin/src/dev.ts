import {
  ConflictError,
  type ContentStore,
  decodeBase64,
  encodeBase64Bytes,
  PluginTaskError,
  type PluginTasks,
  type TaskSecretsPlace,
} from "@goodfellow-cms/core";

/**
 * A content store that reads and writes the site's files through
 * `goodfellow dev`. For local development only: it is never part of a built site.
 */
export function localStore(apiBase = "/__goodfellow/api"): ContentStore & { tasks: PluginTasks } {
  /** Calls the development API. A 404 means "no such file" only where `missingIsFine` says so. */
  async function request(path: string, init: RequestInit = {}, missingIsFine = false): Promise<Response> {
    // With a trailing slash, as in `revision/` and `files/?dir=…`, so a Next.js site with `trailingSlash` has
    // nothing to redirect: browsers keep its 308 redirects, and later send them to whatever runs on this port.
    const [endpoint, query] = path.split("?", 2);
    const response = await fetch(`${apiBase}/${endpoint}/${query === undefined ? "" : `?${query}`}`, {
      ...init,
      headers: { "x-goodfellow-request": "1", ...init.headers },
    });
    if (response.status === 409) throw new ConflictError();
    if (response.status === 404 && !missingIsFine) {
      // Another server on this address, such as one that isn't `goodfellow dev` or `next dev`.
      throw new Error(
        `The development server's API isn't at ${new URL(apiBase, location.href).href} (it answered 404). Open the admin panel at the address \`goodfellow dev\` printed when it started.`,
      );
    }
    if (!response.ok && response.status !== 404) {
      const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      throw new Error(body.message ?? `The development server answered ${response.status} (${body.error ?? "error"}).`);
    }
    return response;
  }

  return {
    async read(path) {
      const response = await request(`file?path=${encodeURIComponent(path)}`, {}, true);
      if (response.status === 404) return undefined;
      return ((await response.json()) as { content: string }).content;
    },
    async readBytes(path) {
      const response = await request(`file?path=${encodeURIComponent(path)}&as=bytes`, {}, true);
      if (response.status === 404) return undefined;
      return decodeBase64(((await response.json()) as { base64: string }).base64);
    },
    async list(dir) {
      const response = await request(`files?dir=${encodeURIComponent(dir)}`);
      return ((await response.json()) as { files: string[] }).files;
    },
    async revision() {
      return ((await (await request("revision")).json()) as { revision: string }).revision;
    },
    async write(changes, { message, expectedRevision }) {
      const response = await request("write", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // JSON can't carry bytes, so uploads go as base64.
        body: JSON.stringify({
          changes: changes.map((change) =>
            "bytes" in change ? { path: change.path, base64: encodeBase64Bytes(change.bytes) } : change,
          ),
          message,
          expectedRevision,
        }),
      });
      return (await response.json()) as { revision: string };
    },
    // Plugins' tasks run on this computer, with the development server's environment as their secrets.
    tasks: {
      async supported() {
        const response = await request("task", {}, true).catch(() => undefined);
        return response?.ok === true && ((await response.json()) as { supported?: boolean }).supported === true;
      },
      async secretsPlace() {
        const response = await request("task", {}, true).catch(() => undefined);
        if (!response?.ok) return undefined;
        return ((await response.json()) as { place?: TaskSecretsPlace }).place;
      },
      async run(task) {
        const response = await request("task", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(task),
        }).catch((error: Error) => {
          throw new PluginTaskError("failed", error.message);
        });
        return ((await response.json()) as { result: string }).result;
      },
    },
  };
}
