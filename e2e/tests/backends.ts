import type { Page } from "@playwright/test";
import { builtSites, starterFiles } from "../scripts/site.mjs";

export const GITHUB_SITE = `http://localhost:${builtSites.github.port}`;
export const GITLAB_SITE = `http://localhost:${builtSites.gitlab.port}`;
export const BITBUCKET_SITE = `http://localhost:${builtSites.bitbucket.port}`;
export const files = starterFiles as () => Record<string, string>;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, accept, x-github-api-version",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
};

/** Sends the browser's requests to a host (such as https://api.github.com) to a fake API instead. */
export async function routeToFake(page: Page, origin: string, handle: (request: Request) => Promise<Response>) {
  await page.route(
    (url) => url.href.startsWith(origin),
    async (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS") {
        // Allow whatever headers the browser asks to send, such as the Anthropic SDK's.
        const asked = request.headers()["access-control-request-headers"];
        await route.fulfill({
          status: 204,
          headers: { ...CORS, ...(asked && { "access-control-allow-headers": asked }) },
        });
        return;
      }
      const body = request.postDataBuffer();
      const response = await handle(
        new Request(request.url(), {
          method: request.method(),
          headers: request.headers(),
          body: body && request.method() !== "GET" ? new Uint8Array(body) : undefined,
        }),
      );
      await route.fulfill({
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...CORS },
        body: Buffer.from(await response.arrayBuffer()),
      });
    },
  );
}
