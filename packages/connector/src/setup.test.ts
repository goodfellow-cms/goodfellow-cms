import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "./permissions.js";
import { connectorManifest, databaseId, setupPage, withDatabaseId } from "./setup.js";

describe("setting up the connector", () => {
  it("creates an app that comes back to the connector and asks for only what it uses", () => {
    const manifest = connectorManifest({
      name: "Goodfellow for Claude",
      connector: "https://claude.example.workers.dev/",
      redirect: "http://127.0.0.1:5000/created",
      public: true,
    });
    expect(manifest.callback_urls).toEqual(["https://claude.example.workers.dev/connect/github/callback"]);
    expect(manifest.request_oauth_on_install).toBe(true);
    expect(manifest.default_permissions).toEqual(PERMISSIONS);
    expect(manifest.hook_attributes.active).toBe(false);
    expect(setupPage({ action: "https://github.com/settings/apps/new?state=x", manifest })).toContain(
      "&quot;Goodfellow for Claude&quot;",
    );
  });

  it("finds the database and keeps wrangler.jsonc's layout", () => {
    const list = `Some text\n[{"uuid":"1234-abcd","name":"goodfellow-connector"},{"uuid":"x","name":"other"}]`;
    expect(databaseId(list)).toBe("1234-abcd");
    expect(databaseId("[]")).toBeUndefined();
    const config = `{\n  // A comment.\n  "database_id": "00000000-0000-0000-0000-000000000000"\n}\n`;
    expect(withDatabaseId(config, "1234-abcd")).toBe(`{\n  // A comment.\n  "database_id": "1234-abcd"\n}\n`);
  });
});
