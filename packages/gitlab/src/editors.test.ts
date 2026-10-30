import { writeChanges } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { gitlab } from "./index.js";
import { type FakeGitLabOptions, fakeGitLab } from "./testing.js";

const FILES = { "content/site.json": '{"version":1,"title":"St. Joseph"}' };

async function signIn(token = "maintainer", options: Partial<FakeGitLabOptions> = {}) {
  const fake = fakeGitLab({
    ...options,
    project: "parish/site",
    files: FILES,
    tokens: {
      maintainer: { username: "maria", name: "Maria", accessLevel: 40 },
      developer: { username: "joseph", name: "Joseph", accessLevel: 30 },
    },
    accounts: ["anne"],
  });
  const backend = await gitlab({ project: "parish/site", fetch: fake.fetch }).signInWithToken(token, false);
  if (!backend.editors) throw new Error("No editors");
  return { fake, backend, editors: backend.editors };
}

describe("GitLab editors", () => {
  it("lists members, and lets Maintainers change them", async () => {
    const { editors } = await signIn();
    const list = await editors.list();
    expect(list.manage).toBe("yes");
    expect(editors.invitesByEmail).toBe(true);
    expect(list.editors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ login: "maria", role: "owner", self: true }),
        expect.objectContaining({ login: "joseph", role: "editor" }),
      ]),
    );
    // GitLab protects the main branch, so only Maintainers can publish until that's changed.
    expect(list.editorsCanPublish).toBe(false);
  });

  it("adds people by username and invites them by email, then changes and removes them", async () => {
    const { fake, editors } = await signIn();
    await editors.invite("anne", "editor");
    await editors.invite("pat@example.org", "owner");
    let list = await editors.list();
    const anne = list.editors.find((editor) => editor.login === "anne");
    const pat = list.editors.find((editor) => editor.email === "pat@example.org");
    expect(anne).toMatchObject({ role: "editor" });
    expect(pat).toMatchObject({ role: "owner", invited: true });
    if (!anne || !pat) throw new Error("Missing");

    await editors.setRole(anne, "owner");
    await editors.setRole(pat, "editor");
    expect(fake.invitations.get("pat@example.org")).toBe(30);
    await editors.remove(pat);
    await editors.remove(anne);
    list = await editors.list();
    expect(list.editors.map((editor) => editor.login ?? editor.email).sort()).toEqual(["joseph", "maria"]);
  });

  it("explains invitations that can't be sent", async () => {
    const { editors } = await signIn();
    await expect(editors.invite("nobody", "editor")).rejects.toMatchObject({ problem: "not-found" });
    await expect(editors.invite("not an@address", "editor")).rejects.toMatchObject({ problem: "invalid" });
    await expect(editors.invite("joseph", "editor")).rejects.toMatchObject({ problem: "already" });
    await editors.invite("pat@example.org", "editor");
    await expect(editors.invite("pat@example.org", "editor")).rejects.toMatchObject({ problem: "already" });
  });

  it("lets Developers publish once the main branch allows them", async () => {
    const { fake, editors } = await signIn();
    const developer = await gitlab({ project: "parish/site", fetch: fake.fetch }).signInWithToken("developer", false);
    const publish = async () =>
      writeChanges(developer, [{ path: "content/site.json", content: '{"version":1,"title":"St. Joe"}' }], {
        message: "Update site settings",
        expectedRevision: await developer.revision(),
      });
    await expect(publish()).rejects.toMatchObject({ problem: "cant-publish" });
    await expect(developer.editors?.letEditorsPublish?.()).rejects.toMatchObject({ problem: "not-allowed" });

    await editors.letEditorsPublish?.();
    expect((await editors.list()).editorsCanPublish).toBe(true);
    expect(fake.protectedBranches.get("main")).toEqual({ push: 30, merge: 30, forcePush: false });
    // In one change, so the branch is never left unprotected.
    expect(fake.protectionChanges).toEqual(["PATCH main"]);
    await expect(publish()).resolves.toBeDefined();
  });

  it("removes and protects the branch again where GitLab can't change a protection, checking it after", async () => {
    const { fake, editors } = await signIn("maintainer", { noProtectionChanges: true });
    await editors.letEditorsPublish?.();
    expect(fake.protectedBranches.get("main")).toEqual({ push: 30, merge: 30, forcePush: false });
    expect(fake.protectionChanges).toEqual(["DELETE main", "POST main"]);
    // Nothing to change the second time.
    await editors.letEditorsPublish?.();
    expect(fake.protectionChanges).toHaveLength(2);
  });

  it("says Developers can't change who edits the site", async () => {
    const { editors } = await signIn("developer");
    const list = await editors.list();
    expect(list.manage).toBe("no");
    await expect(editors.invite("anne", "editor")).rejects.toMatchObject({ problem: "not-allowed" });
  });
});
