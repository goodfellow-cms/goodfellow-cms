import { CommentsError } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { github } from "./index.js";
import { type FakeGitHubUser, fakeGitHub } from "./testing.js";

const TOKENS: Record<string, FakeGitHubUser> = {
  // A fine-grained token for the site's repository alone, as the sign-in service's tokens are.
  "sign-in": { login: "maria", admin: true, repositories: ["maria/site"] },
  // A classic token with `public_repo`, which reaches every public repository.
  comments: { login: "maria" },
  stranger: { login: "anne" },
};

async function signIn(fakeOptions: Partial<Parameters<typeof fakeGitHub>[0]> = {}) {
  const fake = fakeGitHub({ repo: "maria/site", tokens: TOKENS, orgs: ["parish"], ...fakeOptions });
  const backend = await github({ repo: "maria/site", fetch: fake.fetch }).signInWithToken("sign-in", false);
  if (!backend.comments) throw new Error("No comments");
  return { fake, comments: backend.comments, signOut: () => backend.signOut() };
}

describe("GitHub comments", () => {
  it("asks for a comments token where the site's sign-in can't make the repository", async () => {
    const { comments } = await signIn();
    expect(comments.access.active).toBe(false);
    expect(comments.access.tokenLink.url).toBe(
      "https://github.com/settings/tokens/new?scopes=public_repo&description=Goodfellow+comments+for+maria%2Fsite",
    );
    await expect(comments.create("site-comments", "Comments")).rejects.toMatchObject({ problem: "no-access" });
    await expect(comments.access.applyToken("not-a-token")).rejects.toBeInstanceOf(CommentsError);
    expect(comments.access.active).toBe(false);
  });

  it("makes a public repository with Discussions beside the site's, and finds its Announcements", async () => {
    const { fake, comments } = await signIn();
    await comments.access.applyToken("comments");
    const made = await comments.create("site-comments", "Comments on the parish's site");
    const repo = fake.created.get("maria/site-comments");
    expect(repo).toMatchObject({ private: false, discussions: true, description: "Comments on the parish's site" });
    const announcements = repo?.categories.find((category) => category.name === "Announcements");
    expect(made).toEqual({
      repo: "maria/site-comments",
      repoId: `R_${repo?.id}`,
      category: "Announcements",
      categoryId: announcements?.id,
      webUrl: "https://github.com/maria/site-comments",
      installUrl: expect.stringMatching(
        /^https:\/\/github\.com\/apps\/giscus\/installations\/new\/permissions\?target_id=\d+$/,
      ),
    });
    await expect(comments.create("site-comments", "")).rejects.toMatchObject({ problem: "name-taken" });
    await expect(comments.create("../oops", "")).rejects.toMatchObject({ problem: "name-invalid" });
  });

  it("makes it in the site's organization where the site is an organization's", async () => {
    const fake = fakeGitHub({ repo: "parish/site", tokens: TOKENS, orgs: ["parish"] });
    const backend = await github({ repo: "parish/site", fetch: fake.fetch }).signInWithToken("comments", false);
    await backend.comments?.create("site-comments", "");
    expect(fake.created.has("parish/site-comments")).toBe(true);
  });

  it("connects an existing public repository, turning Discussions on, and refuses private ones", async () => {
    const { fake, comments } = await signIn();
    await comments.access.applyToken("comments");
    fake.addRepo("maria/talk");
    expect(await comments.find("https://github.com/maria/talk/")).toMatchObject({
      repo: "maria/talk",
      category: "Announcements",
    });
    expect(fake.created.get("maria/talk")?.discussions).toBe(true);
    fake.addRepo("maria/secret", { private: true, discussions: true });
    await expect(comments.find("maria/secret")).rejects.toMatchObject({ problem: "not-public" });
    await expect(comments.find("maria/nothing")).rejects.toMatchObject({ problem: "not-found" });
    fake.addRepo("maria/theirs", { collaborators: { anne: "admin" } });
    await expect(comments.find("maria/theirs")).rejects.toMatchObject({ problem: "no-discussions" });
  });

  it("says where to open Discussions when GitHub hasn't made their categories yet", async () => {
    const { fake, comments } = await signIn({ noDiscussionCategories: true });
    await comments.access.applyToken("comments");
    fake.addRepo("maria/talk", { discussions: true });
    await expect(comments.find("maria/talk")).rejects.toMatchObject({
      problem: "no-category",
      link: "https://github.com/maria/talk/discussions",
    });
  });

  it("lists pages' comments, and hides, shows, deletes and locks them", async () => {
    const { fake, comments, signOut } = await signIn();
    await comments.access.applyToken("comments");
    fake.addRepo("maria/talk", { discussions: true });
    const place = await comments.find("maria/talk");
    const thread = fake.addDiscussion("maria/talk", {
      title: "news/parish-fair",
      comments: [
        { login: "joseph", text: "See you there!", replies: [{ login: "anne", text: "Me too." }] },
        { login: "spammer", text: "Cheap watches" },
      ],
    });
    fake.addDiscussion("maria/talk", {
      title: "elsewhere",
      category: "General",
      comments: [{ login: "x", text: "y" }],
    });
    const { threads, next } = await comments.threads(place);
    expect(next).toBeUndefined();
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ id: thread.id, title: "news/parish-fair", locked: false });
    const [first, spam] = threads[0]?.comments ?? [];
    expect(first).toMatchObject({ author: { login: "joseph" }, text: "See you there!", hidden: false });
    expect(first?.replies[0]).toMatchObject({ author: { login: "anne" }, text: "Me too." });

    await comments.hide(spam?.id ?? "", "spam");
    let shown = (await comments.threads(place)).threads[0]?.comments[1];
    expect(shown).toMatchObject({ hidden: true, hiddenReason: "spam" });
    await comments.show(spam?.id ?? "");
    shown = (await comments.threads(place)).threads[0]?.comments[1];
    expect(shown?.hidden).toBe(false);
    await comments.remove(first?.replies[0]?.id ?? "");
    await comments.remove(spam?.id ?? "");
    await comments.lock(thread.id);
    const after = (await comments.threads(place)).threads[0];
    expect(after?.locked).toBe(true);
    expect(after?.comments.map((comment) => comment.text)).toEqual(["See you there!"]);
    expect(after?.comments[0]?.replies).toEqual([]);
    await comments.unlock(thread.id);
    expect((await comments.threads(place)).threads[0]?.locked).toBe(false);

    signOut();
    expect(comments.access.active).toBe(false);
  });

  it("refuses moderation to someone who can't write to the comments' repository", async () => {
    const fake = fakeGitHub({ repo: "maria/site", tokens: TOKENS });
    fake.addRepo("maria/talk", { discussions: true, collaborators: { maria: "admin" } });
    const thread = fake.addDiscussion("maria/talk", { title: "about", comments: [{ login: "x", text: "Hello" }] });
    const backend = await github({ repo: "maria/site", fetch: fake.fetch }).signInWithToken("stranger", false);
    await expect(backend.comments?.lock(thread.id)).rejects.toMatchObject({ problem: "no-access" });
  });
});
