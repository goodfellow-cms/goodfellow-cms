import { describe, expect, it } from "vitest";
import { browserEnvironment, browserSaid, sandboxFailed } from "./screenshots.js";

describe("screenshots", () => {
  it("passes on what the browser said when it closed, without Playwright's own lines", () => {
    const message = [
      "page.screenshot: Target page, context or browser has been closed",
      "Browser logs:",
      "",
      "<launching> C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe --headless --disable-gpu",
      "<launched> pid=4120",
      "[pid=4120][err] [4120:1027/093001.101:ERROR:gpu_process_host.cc(991)] GPU process exited unexpectedly",
      "[pid=4120][err] [4120:1027/093001.205:FATAL:gpu_data_manager_impl_private.cc(415)] GPU process isn't usable. Goodbye.",
      "Call log:",
      `${String.fromCharCode(27)}[2m  - taking page screenshot${String.fromCharCode(27)}[22m`,
    ].join("\n");
    expect(browserSaid(message)).toBe(
      "[4120:1027/093001.101:ERROR:gpu_process_host.cc(991)] GPU process exited unexpectedly / [4120:1027/093001.205:FATAL:gpu_data_manager_impl_private.cc(415)] GPU process isn't usable. Goodbye.",
    );
    expect(browserSaid("page.goto: net::ERR_ABORTED")).toBe("");
  });
});

describe("sandboxFailed", () => {
  it("knows Chrome's sandbox failures, and not every message that names a sandbox", () => {
    expect(
      sandboxFailed("[0101/000000.000:FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox! Update your kernel"),
    ).toBe(true);
    expect(
      sandboxFailed(
        "Failed to move to new namespace: PID namespaces supported, but failed: errno = Operation not permitted",
      ),
    ).toBe(true);
    expect(sandboxFailed("browserType.launch: Executable doesn't exist at /opt/chrome --no-sandbox")).toBe(false);
  });
});

describe("browserEnvironment", () => {
  it("leaves the connector's sign-ins and other credentials out of the browser's environment", () => {
    expect(
      browserEnvironment({
        PATH: "/usr/bin",
        HOME: "/home/olive",
        DISPLAY: ":0",
        GOODFELLOW_GITHUB_TOKEN: "ghp_x",
        GOODFELLOW_SITE: "https://parish.example",
        GITLAB_TOKEN: "x",
        AWS_SECRET_ACCESS_KEY: "x",
        ANTHROPIC_API_KEY: "x",
        NPM_AUTH: "x",
        EMPTY: undefined,
      }),
    ).toEqual({ PATH: "/usr/bin", HOME: "/home/olive", DISPLAY: ":0" });
  });
});
