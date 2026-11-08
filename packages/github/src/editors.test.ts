import { EditorsError } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { github, githubTokenLinks } from "./index.js";
import { type FakeGitHubUser, fakeGitHub } from "./testing.js";

const TOKENS: Record<string, FakeGitHubUser> = {
  "sign-in": { login: "maria", name: "Maria", admin: true },
  owner: { login: "maria", admin: true, administration: true },
  editor: { login: "joseph" },
};

async function signIn(token = "sign-in") {
  const fake = fakeGitHub({ repo: "parish/site", tokens: TOKENS, accounts: ["anne"] });
  const backend = await github({ repo: "parish/site", fetch: fake.fetch }).signInWithToken(token, false);
  if (!backend.editors || !backend.ownerAccess) throw new Error("No editors");
  return { fake, backend, editors: backend.editors, owner: backend.ownerAccess };
}

describe("GitHub editors", () => {
  it("lists collaborators, and needs an owner token to change them", async () => {
    const { editors, owner } = await signIn();
    const list = await editors.list();
    expect(list.manage).toBe("token");
    expect(list.editors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ login: "maria", role: "owner", self: true }),
        expect.objectContaining({ login: "joseph", role: "editor" }),
      ]),
    );
    await expect(editors.invite("anne", "editor")).rejects.toMatchObject({ problem: "not-allowed" });
    expect(owner.tokenLink.url).toContain("administration=write");
    expect(owner.tokenLink.url).toContain("pages=write");
    expect(owner.tokenLink.url).toBe(githubTokenLinks("parish/site").owner);
  });

  it("invites, changes, and removes editors with an owner token", async () => {
    const { fake, editors, owner } = await signIn();
    await owner.applyToken("owner");
    expect(owner.active).toBe(true);
    await editors.invite("@anne", "editor");
    let list = await editors.list();
    expect(list.manage).toBe("yes");
    const anne = list.editors.find((editor) => editor.login === "anne");
    expect(anne).toMatchObject({ role: "editor", invited: true });
    if (!anne) throw new Error("No invitation");

    await editors.setRole(anne, "owner");
    expect(fake.invitations[0]?.permission).toBe("admin");
    fake.accept("anne");
    list = await editors.list();
    expect(list.editors.find((editor) => editor.login === "anne")).toMatchObject({ role: "owner" });
    expect(list.editors.find((editor) => editor.login === "anne")?.invited).toBeUndefined();

    const joseph = list.editors.find((editor) => editor.login === "joseph");
    if (!joseph) throw new Error("No editor");
    await editors.remove(joseph);
    expect(fake.collaborators.has("joseph")).toBe(false);
    owner.forget();
    expect(owner.active).toBe(false);
  });

  it("explains invitations that can't be sent", async () => {
    const { editors, owner } = await signIn();
    await owner.applyToken("owner");
    await expect(editors.invite("not a name", "editor")).rejects.toMatchObject({ problem: "invalid" });
    await expect(editors.invite("nobody-here", "editor")).rejects.toMatchObject({ problem: "not-found" });
  });

  it("refuses owner tokens that can't manage the site", async () => {
    const { owner } = await signIn();
    await expect(owner.applyToken("sign-in")).rejects.toBeInstanceOf(EditorsError);
    await expect(owner.applyToken("editor")).rejects.toMatchObject({ problem: "not-allowed" });
    await expect(owner.applyToken("wrong")).rejects.toMatchObject({ problem: "not-allowed" });
    expect(owner.active).toBe(false);
  });

  it("says editors who aren't owners can't change who edits the site", async () => {
    const { editors } = await signIn("editor");
    expect((await editors.list()).manage).toBe("no");
  });

  it("forgets the owner token on sign-out", async () => {
    const { backend, owner } = await signIn();
    await owner.applyToken("owner");
    backend.signOut();
    expect(owner.active).toBe(false);
  });
});
