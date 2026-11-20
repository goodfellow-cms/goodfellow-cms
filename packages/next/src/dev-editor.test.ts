import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pluginFrameFile } from "./dev-editor.js";

describe("pluginFrameFile", () => {
  const dir = join("/site", "node_modules/.goodfellow/next-plugins");

  it("finds a plugin's frame, its index without a file", () => {
    expect(pluginFrameFile("greeter/", dir)).toEqual({ id: "greeter", file: join(dir, "greeter", "index.html") });
    expect(pluginFrameFile("greeter/app%20one.js", dir)).toEqual({
      id: "greeter",
      file: join(dir, "greeter", "app one.js"),
    });
  });

  it("names nothing for a stray %, or a file outside the plugin's folder, rather than throwing", () => {
    expect(pluginFrameFile("greeter/%", dir)).toBeUndefined();
    expect(pluginFrameFile("%E0%A4%A", dir)).toBeUndefined();
    expect(pluginFrameFile("greeter/..%2f..%2fsecret", dir)).toBeUndefined();
    expect(pluginFrameFile("greeter/../other/index.html", dir)).toBeUndefined();
    expect(pluginFrameFile("", dir)).toBeUndefined();
  });
});
