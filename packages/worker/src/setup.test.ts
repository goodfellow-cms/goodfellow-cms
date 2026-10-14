import { describe, expect, it } from "vitest";
import {
  appManifest,
  appPermissions,
  appSecrets,
  convertManifest,
  deployedAddress,
  hasAppSecrets,
  manifestAction,
  newSessionKey,
  readVar,
  setupPage,
  withVars,
} from "./setup.js";
import { PERMISSIONS } from "./worker.js";

const WRANGLER = `// Goodfellow's sign-in worker.
{
  "name": "sign-in",
  "vars": {
    "EDIT_APP_SLUG": "goodfellow-cms",
    "OWNER_APP_SLUG": "goodfellow-cms-owner",
    "SETUP_ORIGINS": "https://goodfellow-cms.github.io"
  }
  // Secrets, set with \`npx wrangler secret put NAME\`.
}
`;

describe("appPermissions", () => {
  it("gives each app everything its tokens ask for", () => {
    expect(appPermissions("edit")).toEqual(PERMISSIONS.edit);
    const owner = appPermissions("owner");
    for (const purpose of [PERMISSIONS.owner, PERMISSIONS.setup]) {
      for (const [name, level] of Object.entries(purpose)) {
        expect(owner[name] === "write" || owner[name] === level, name).toBe(true);
      }
    }
    expect(owner).toEqual({
      administration: "write",
      pages: "write",
      actions: "write",
      contents: "write",
      workflows: "write",
      metadata: "read",
    });
  });
});

describe("appManifest", () => {
  it("describes an app that signs people in through the worker, and in while installing", () => {
    const manifest = appManifest({
      kind: "edit",
      name: "Goodfellow CMS",
      worker: "https://sign-in.someone.workers.dev/",
      redirect: "http://127.0.0.1:4000/created/edit",
      public: true,
    });
    expect(manifest).toMatchObject({
      name: "Goodfellow CMS",
      callback_urls: ["https://sign-in.someone.workers.dev/github/callback"],
      redirect_url: "http://127.0.0.1:4000/created/edit",
      hook_attributes: { url: "https://sign-in.someone.workers.dev", active: false },
      request_oauth_on_install: true,
      public: true,
      default_permissions: PERMISSIONS.edit,
      default_events: [],
    });
  });

  it("posts to the person's own settings or an organization's", () => {
    expect(manifestAction("abc")).toBe("https://github.com/settings/apps/new?state=abc");
    expect(manifestAction("abc", "St Example")).toBe(
      "https://github.com/organizations/St%20Example/settings/apps/new?state=abc",
    );
  });
});

describe("convertManifest", () => {
  const app = { id: 7, slug: "goodfellow-cms", client_id: "Iv1.a", client_secret: "secret", pem: "-----BEGIN RSA…" };

  it("asks GitHub for the created app's details and turns them into the worker's secrets", async () => {
    const requests: string[] = [];
    const created = await convertManifest("the-code", async (input, init) => {
      requests.push(`${init?.method} ${String(input)}`);
      return Response.json(app, { status: 201 });
    });
    expect(requests).toEqual(["POST https://api.github.com/app-manifests/the-code/conversions"]);
    expect(appSecrets("owner", created)).toEqual({
      OWNER_APP_ID: "7",
      OWNER_CLIENT_ID: "Iv1.a",
      OWNER_CLIENT_SECRET: "secret",
      OWNER_PRIVATE_KEY: "-----BEGIN RSA…",
    });
  });

  it("explains a code that doesn't work, without GitHub's answer", async () => {
    await expect(
      convertManifest("old", async () => Response.json({ message: "Not Found" }, { status: 404 })),
    ).rejects.toThrow("GitHub didn't give the app's details (404). Try creating the app again.");
    await expect(convertManifest("odd", async () => Response.json({ id: 7 }, { status: 201 }))).rejects.toThrow(
      "didn't include the app's keys",
    );
  });
});

describe("hasAppSecrets", () => {
  it("needs all four of an app's secrets", () => {
    const secrets = ["EDIT_APP_ID", "EDIT_CLIENT_ID", "EDIT_CLIENT_SECRET", "EDIT_PRIVATE_KEY", "OWNER_APP_ID"];
    expect(hasAppSecrets("edit", secrets)).toBe(true);
    expect(hasAppSecrets("owner", secrets)).toBe(false);
  });
});

describe("newSessionKey", () => {
  it("makes 32 random bytes", () => {
    const key = newSessionKey();
    expect(atob(key)).toHaveLength(32);
    expect(newSessionKey()).not.toBe(key);
  });
});

describe("wrangler.jsonc", () => {
  it("reads and changes settings, keeping comments and layout", () => {
    expect(readVar(WRANGLER, "SETUP_ORIGINS")).toBe("https://goodfellow-cms.github.io");
    expect(readVar(WRANGLER, "MISSING")).toBeUndefined();
    const changed = withVars(WRANGLER, { EDIT_APP_SLUG: "parish-sign-in", SETUP_ORIGINS: "" });
    expect(changed).toBe(
      WRANGLER.replace('"goodfellow-cms"', '"parish-sign-in"').replace('"https://goodfellow-cms.github.io"', '""'),
    );
    expect(withVars(changed, { SETUP_ORIGINS: 'a"b' })).toContain('"SETUP_ORIGINS": "a\\"b"');
    expect(readVar(withVars(changed, { SETUP_ORIGINS: 'a"b' }), "SETUP_ORIGINS")).toBe('a"b');
    expect(() => withVars(WRANGLER, { MISSING: "x" })).toThrow("wrangler.jsonc has no MISSING setting.");
  });
});

describe("deployedAddress", () => {
  it("finds the workers.dev address in Wrangler's output", () => {
    const output = [
      JSON.stringify({ type: "wrangler-session", version: 1 }),
      "not JSON",
      JSON.stringify({ type: "deploy", targets: ["sign-in.example.org/*", "https://sign-in.someone.workers.dev"] }),
      "",
    ].join("\n");
    expect(deployedAddress(output)).toBe("https://sign-in.someone.workers.dev");
    expect(deployedAddress(JSON.stringify({ type: "deploy", targets: ["https://sign-in.example.org"] }))).toBe(
      "https://sign-in.example.org",
    );
    expect(deployedAddress(JSON.stringify({ type: "deploy", targets: [] }))).toBeUndefined();
    expect(deployedAddress("")).toBeUndefined();
  });
});

describe("setupPage", () => {
  it("posts the next app's manifest to GitHub, escaped", () => {
    const manifest = appManifest({
      kind: "owner",
      name: 'Owners "<b>"',
      worker: "https://sign-in.someone.workers.dev",
      redirect: "http://127.0.0.1:4000/created/owner",
      public: false,
    });
    const page = setupPage({
      created: { edit: { id: 1, slug: "parish-sign-in", client_id: "", client_secret: "s", pem: "k" } },
      next: { kind: "owner", action: manifestAction("a&b"), manifest },
    });
    expect(page).toContain("Created the editors' app, <strong>parish-sign-in</strong>.");
    expect(page).toContain('action="https://github.com/settings/apps/new?state=a%26b"');
    expect(page).not.toContain("<b>");
    const value = page.match(/name="manifest" value="([^"]*)"/)?.[1] ?? "";
    const decoded = value
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
    expect(JSON.parse(decoded)).toEqual(manifest);
  });

  it("says when both apps are created", () => {
    expect(setupPage({ created: {}, problem: "<oops>" })).toContain("&lt;oops&gt;");
    expect(setupPage({ created: {} })).toContain("Both apps are created.");
  });
});
