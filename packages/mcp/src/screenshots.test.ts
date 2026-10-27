import { describe, expect, it } from "vitest";
import { browserSaid } from "./screenshots.js";

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
