import { SignInError, type SiteContent } from "@goodfellow-cms/core";
import { describe, expect, it, vi } from "vitest";
import type { LoadState } from "./admin-context.js";
import { draftAndLive } from "./drafts.js";

const ready: LoadState = { status: "ready", content: {} as SiteContent, revision: "abc", media: [] };
const changes = async () => [{ path: "content/pages/about.json", content: "{}" }];

describe("draftAndLive", () => {
  it("gives the draft's changes and the live site", async () => {
    const onSignInError = vi.fn();
    expect(await draftAndLive(changes, async () => ready, onSignInError)).toEqual({
      changes: await changes(),
      live: ready,
    });
    expect(onSignInError).not.toHaveBeenCalled();
  });

  it("signs in again where reading the live site, its sources included, finds the sign-in ran out", async () => {
    const expired = new SignInError("invalid", "Sign in again.");
    const onSignInError = vi.fn();
    // As `load()` gives it: the error its reading threw, as its state.
    const read = await draftAndLive(changes, async () => ({ status: "error", error: expired }), onSignInError);
    expect(read).toEqual({ error: expired });
    expect(onSignInError).toHaveBeenCalledWith(expired);
  });

  it("signs in again where reading the draft finds the sign-in ran out", async () => {
    const expired = new SignInError("invalid", "Sign in again.");
    const onSignInError = vi.fn();
    const read = await draftAndLive(
      () => Promise.reject(expired),
      async () => ready,
      onSignInError,
    );
    expect(read).toEqual({ error: expired });
    expect(onSignInError).toHaveBeenCalledWith(expired);
  });

  it("signs in again where the live site finds the sign-in ran out after the draft failed otherwise", async () => {
    const expired = new SignInError("invalid", "Sign in again.");
    const onSignInError = vi.fn();
    // The draft's read fails first, with a problem of its own; the live site's then finds the sign-in ran out.
    const read = await draftAndLive(
      () => Promise.reject(new Error("The draft couldn't be read.")),
      () => new Promise((resolve) => setTimeout(() => resolve({ status: "error", error: expired }), 10)),
      onSignInError,
    );
    expect(read).toEqual({ error: expired });
    expect(onSignInError).toHaveBeenCalledWith(expired);
  });

  it("leaves other failures, and other sign-in problems, to the screen", async () => {
    const onSignInError = vi.fn();
    const failure = new Error("The site's server didn't answer.");
    expect(await draftAndLive(changes, async () => ({ status: "error", error: failure }), onSignInError)).toEqual({
      error: failure,
    });
    const other = new SignInError("not-owner", "Only owners can.");
    expect(
      await draftAndLive(
        () => Promise.reject(other),
        async () => ready,
        onSignInError,
      ),
    ).toEqual({ error: other });
    expect(await draftAndLive(changes, async () => ({ status: "loading" }), onSignInError)).toEqual({ error: false });
    expect(onSignInError).not.toHaveBeenCalled();
  });
});
