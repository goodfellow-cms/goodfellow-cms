import { definePluginAdmin, type PluginAdminApi } from "@goodfellow-cms/core";

const STORAGE = "https://storage.example/media";
const FILE = "content/media-storage.json";

interface Signed {
  method: string;
  address: string;
  signature: string;
}

/** Signs the requests in the site's CI, with the secret the browser never sees, then makes them. */
async function send(api: PluginAdminApi, requests: { method: string; address: string; body?: Blob; type?: string }[]) {
  const signed = (await api.task("sign", {
    requests: requests.map(({ method, address }) => ({ method, address })),
  })) as Signed[];
  for (const [index, request] of requests.entries()) {
    const response = await fetch(`${STORAGE}/${request.address.slice("/media/".length)}`, {
      method: request.method,
      headers: {
        "x-keeper-signature": signed[index]?.signature ?? "",
        ...(request.type && { "content-type": request.type }),
      },
      ...(request.body && { body: request.body }),
    });
    if (!response.ok) throw new Error(`The storage said ${response.status}.`);
  }
}

export default definePluginAdmin({
  screens: {
    async settings(element, api) {
      const root = element as HTMLElement;
      const doc = root.ownerDocument;
      const status = doc.createElement("p");
      status.setAttribute("role", "status");
      const button = doc.createElement("button");
      button.type = "button";
      button.textContent = "Keep the site's media here";
      button.addEventListener("click", () => {
        void (async () => {
          const before = (await api.read([FILE]))[FILE];
          const files = before ? (JSON.parse(before) as { files?: object }).files : {};
          const { published } = await api.publish(
            [
              {
                path: FILE,
                text: `${JSON.stringify({ version: 1, plugin: api.plugin.name, url: STORAGE, files }, null, 2)}\n`,
              },
            ],
            "Keep media in Keeper",
          );
          status.textContent = published ? "Keeping media" : "Not saved";
        })();
      });
      root.append(button, status);
    },
  },
  media: {
    async ready() {
      return { ready: true };
    },
    async upload(files, api) {
      await send(
        api,
        files.map((file) => ({ method: "PUT", address: file.address, body: file.data as Blob, type: file.type })),
      );
    },
    async remove(addresses, api) {
      await send(
        api,
        addresses.map((address) => ({ method: "DELETE", address })),
      );
    },
  },
});
