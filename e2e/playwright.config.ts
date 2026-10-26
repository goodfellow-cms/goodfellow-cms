import { defineConfig, devices } from "@playwright/test";
import { BROKER_ADDRESSES, builtSites, NEXT_SERVER } from "./scripts/site.mjs";

const PORT = 4400;

export default defineConfig({
  testDir: "tests",
  // Every test edits the same site on disk, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    // Lets environments with a preinstalled browser use it instead of `playwright install`.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  projects: [
    { name: "chromium", use: {} },
    // The admin address's guards, in every browser engine, since each loads pages its own way.
    ...(["firefox", "webkit"] as const).map((name) => ({
      name,
      testMatch: "admin-domain.spec.ts",
      use: {
        ...devices[name === "firefox" ? "Desktop Firefox" : "Desktop Safari"],
        viewport: { width: 1440, height: 900 },
        launchOptions: {},
      },
    })),
  ],
  webServer: [
    {
      command: `node scripts/start-site.mjs ${PORT}`,
      url: `http://localhost:${PORT}/admin`,
      reuseExistingServer: false,
      timeout: 60_000,
      // The secret the test plugin Keeper's task signs with (`media-storage.spec.ts`), as a site's CI would have.
      env: { KEEPER_KEY: "secret" },
    },
    // The Next.js template under `next dev`.
    {
      command: "node scripts/start-next-site.mjs 4403",
      url: "http://localhost:4403/about/",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    // A production build of the Next.js template served from /site/, like a GitHub Pages project site.
    {
      command: "node scripts/start-next-built-site.mjs 4404",
      url: "http://localhost:4404/site/",
      reuseExistingServer: false,
      timeout: 240_000,
    },
    // The Next.js template as a full-stack site, with a server and a sign-in of its own, on a fake GitHub.
    {
      command: `node scripts/start-next-server-site.mjs ${NEXT_SERVER.port}`,
      url: `http://localhost:${NEXT_SERVER.port}/sign-in/`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
    // The documentation site, built and served from a subfolder, with its search index.
    {
      command: "node scripts/start-docs-site.mjs 4406",
      url: "http://localhost:4406/goodfellow-cms/",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    // Production builds of the starter with each git backend, as a demo, and with its content in a repository
    // of its own, served like a static host.
    // The token broker, which shows the broker site's admin panel in its frame.
    {
      command: "node scripts/start-broker.mjs",
      url: `${BROKER_ADDRESSES.broker}/`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    ...(["github", "gitlab", "bitbucket", "demo", "content", "admin", "broker"] as const).map((name) => ({
      command: `node scripts/start-built-site.mjs ${name}`,
      url: `http://localhost:${builtSites[name].port}/admin/`,
      reuseExistingServer: false,
      timeout: 120_000,
    })),
  ],
});
