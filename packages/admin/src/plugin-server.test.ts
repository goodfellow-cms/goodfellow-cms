import { describe, expect, it } from "vitest";
import { pluginServerAddress } from "./plugin-server.js";

const base = "/api/goodfellow/plugins";
const page = "https://site.example/admin/";
const address = (path: string) => pluginServerAddress(base, "greeter", path, page);

describe("pluginServerAddress", () => {
  it("gives addresses under the plugin's own", () => {
    expect(address("hello?name=Ann")).toBe("https://site.example/api/goodfellow/plugins/greeter/hello?name=Ann");
    expect(address("/rooms/1")).toBe("https://site.example/api/goodfellow/plugins/greeter/rooms/1");
    expect(address("//evil.example/x")).toBe("https://site.example/api/goodfellow/plugins/greeter/evil.example/x");
    expect(pluginServerAddress("https://site.example/api/goodfellow/plugins/", "greeter", "a", page)).toBe(
      "https://site.example/api/goodfellow/plugins/greeter/a",
    );
  });

  it("refuses paths that leave them, however they're spelled", () => {
    for (const path of [
      "../file?path=content/site.json",
      "a/../../file",
      "%2e%2e/%2e%2e/file?path=content/site.json",
      "%2E%2E/write",
      ".%2e/write",
      "a%2f..%2f..%2fwrite",
      "..\\..\\write",
      "./../write",
      "https://evil.example/x",
      "javascript:alert(1)",
    ]) {
      expect(address(path), path).toBeUndefined();
    }
  });
});
