/**
 * Site Settings' Comments screen: visitors' comments, kept as discussions in a
 * public GitHub repository of their own and shown on pages by Giscus, or kept
 * by Disqus, or by the owner's own Garrul. Owners make that repository or
 * pick one (`SiteComments.create()`, `find()`), or name Disqus's site or
 * Garrul's address, publish where comments are as `content/site.json`'s
 * `comments`, which the Comments block reads, and moderate what visitors
 * write on GitHub here (Disqus's are
 * moderated on Disqus, and Garrul's on Garrul). Only backends with `comments`
 * (GitHub) set up Giscus; elsewhere the screen says how it's done on GitHub
 * itself. Disqus and Garrul work on every site.
 */
import {
  CommentsError,
  type CommentsPlace,
  type CommentsRepository,
  type CommentThread,
  DISQUS_CREATE_URL,
  type DisqusPlace,
  disqusModerationUrl,
  disqusShortname,
  GARRUL_URL,
  type GarrulPlace,
  GISCUS_APP_URL,
  garrulAddress,
  garrulModerationUrl,
  HIDE_REASONS,
  type HideReason,
  isDisqus,
  isGarrul,
  type SiteComment,
  type SiteCommentsPlace,
} from "@goodfellow-cms/core";
import { useCallback, useEffect, useState } from "react";
import { siteRepoName } from "./add-broker.js";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { siteSettingsFileChange } from "./changes.js";
import { type Failure, PublishFailure } from "./publish-failure.js";
import { type StringKey, useStrings } from "./strings.js";
import { Button, Dialog, ErrorMessage, TextField } from "./ui.js";
import { formatDate } from "./versions-screen.js";

/** Where GitHub says how to block someone, which stops them commenting anywhere the account owns. */
const BLOCKING_HELP = "https://docs.github.com/communities/maintaining-your-safety-on-github";

export function CommentsScreen() {
  const t = useStrings();
  const { comments, demo, versions } = useAdmin();
  const { content } = useSiteContent();
  const place = content.settings.comments;
  // A repository set up on this screen, whose Giscus install link names its account.
  const [made, setMade] = useState<CommentsRepository>();

  let body: React.ReactNode;
  if (demo) body = <p>{t("comments.demo")}</p>;
  else if (place && (isDisqus(place) || isGarrul(place))) body = <NamedServicePlace place={place} />;
  else if (!versions || !comments) {
    body = (
      <>
        <p>{t(versions ? "comments.unavailable" : "comments.local")}</p>
        {!place && (
          <>
            <NamedServiceSetup service={DISQUS} />
            <NamedServiceSetup service={GARRUL} />
          </>
        )}
      </>
    );
  } else if (!place) {
    body = (
      <>
        <CommentsSetup onMade={setMade} />
        <NamedServiceSetup service={DISQUS} />
        <NamedServiceSetup service={GARRUL} />
      </>
    );
  } else {
    body = (
      <>
        <CommentsPlaceSection place={place} made={made} />
        <Moderation key={`${place.repo}/${place.categoryId}`} place={place} />
      </>
    );
  }

  return (
    <div className="gfa-screen">
      <div className="gfa-screen-header">
        <h1>{t("settings.tab.comments")}</h1>
      </div>
      <p>{t("comments.intro")}</p>
      {body}
    </div>
  );
}

/** Why GitHub refused, in words, with where on GitHub to fix it where there's a page for it. */
function CommentsProblem({ error }: { error: unknown }) {
  const t = useStrings();
  if (error instanceof CommentsError) {
    return (
      <ErrorMessage
        message={t(`comments.error.${error.problem}` as StringKey)}
        error={error}
        action={
          error.link && (
            <a href={error.link} target="_blank" rel="noreferrer">
              {t("comments.error.fix")}
            </a>
          )
        }
      />
    );
  }
  return <ErrorMessage message={t("comments.error.other")} error={error} />;
}

function needsToken(error: unknown): boolean {
  return error instanceof CommentsError && error.problem === "no-access";
}

/**
 * A GitHub token for comments, where the admin panel's sign-in can't reach
 * them: the sign-in service's reaches only the site's own repository.
 */
function CommentsTokenForm({ onReady }: { onReady: () => void }) {
  const t = useStrings();
  const { comments } = useAdmin();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  if (!comments) return null;
  const { access } = comments;

  const use = async () => {
    setBusy(true);
    setError(undefined);
    try {
      // With a token broker, the broker asks for it in its own part of the page, and keeps it.
      if (access.requestToken) await access.requestToken();
      else await access.applyToken(token);
      setToken("");
      onReady();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="gfa-form gfa-owner-token">
      <h2 className="gfa-section-title">{t("comments.token.title")}</h2>
      <p>{t("comments.token.intro")}</p>
      <ol>
        <li>
          <a href={access.tokenLink.url} target="_blank" rel="noreferrer">
            {t(access.tokenLink.label as StringKey)}
          </a>{" "}
          {t("comments.token.scope")}
        </li>
        <li>{t(access.requestToken ? "owner.token.pasteInBroker" : "comments.token.paste")}</li>
      </ol>
      {!access.requestToken && (
        <TextField
          label={t("comments.token.label")}
          type="password"
          autoComplete="off"
          value={token}
          onChange={setToken}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (token.trim()) void use();
          }}
        />
      )}
      {error !== undefined && <CommentsProblem error={error} />}
      <div>
        <Button variant="primary" disabled={busy || (!access.requestToken && !token.trim())} onClick={() => void use()}>
          {busy ? t("owner.token.checking") : t("owner.token.use")}
        </Button>
      </div>
    </section>
  );
}

/** Says a token of the owner's own is in use for comments in this tab, with a way to stop using it. */
function CommentsTokenActive({ onForget }: { onForget: () => void }) {
  const t = useStrings();
  const { comments } = useAdmin();
  if (!comments?.access.active) return null;
  return (
    <p className="gfa-notice">
      {t("comments.token.active")}{" "}
      <Button
        variant="ghost"
        onClick={() => {
          comments.access.forget();
          onForget();
        }}
      >
        {t("owner.token.forget")}
      </Button>
    </p>
  );
}

/** Makes a repository for comments, or picks one, and publishes where it is. */
function CommentsSetup({ onMade }: { onMade: (made: CommentsRepository) => void }) {
  const t = useStrings();
  const { comments, publish, site } = useAdmin();
  const { content } = useSiteContent();
  const [way, setWay] = useState<"new" | "existing">("new");
  const [name, setName] = useState(`${siteRepoName(site.backend?.options)}-comments`);
  const [existing, setExisting] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [failure, setFailure] = useState<Failure>(null);
  // Shown once GitHub has said the sign-in can't do it, and until a token is in use.
  const [asking, setAsking] = useState(false);
  const [, setTokens] = useState(0);
  if (!comments) return null;

  const setUp = async () => {
    setBusy(true);
    setError(undefined);
    setFailure(null);
    try {
      const found =
        way === "new"
          ? await comments.create(name, t("comments.setup.description", { site: content.settings.title }))
          : await comments.find(existing);
      const { repo, repoId, category, categoryId } = found;
      const result = await publish(
        [siteSettingsFileChange({ ...content.settings, comments: { repo, repoId, category, categoryId } })],
        t("comments.setup.message"),
        { checks: false },
      );
      if (result.ok) onMade(found);
      else setFailure(result);
    } catch (caught) {
      if (needsToken(caught)) setAsking(true);
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <CommentsTokenActive onForget={() => setTokens((count) => count + 1)} />
      {asking && !comments.access.active && (
        <CommentsTokenForm
          onReady={() => {
            setAsking(false);
            setError(undefined);
          }}
        />
      )}
      <form
        className="gfa-form"
        aria-labelledby="gfa-comments-setup"
        onSubmit={(event) => {
          event.preventDefault();
          void setUp();
        }}
      >
        <h2 className="gfa-section-title" id="gfa-comments-setup">
          {t("comments.setup.title")}
        </h2>
        <fieldset className="gfa-choice-group">
          <legend className="gfa-visually-hidden">{t("comments.setup.title")}</legend>
          <label className="gfa-checkbox">
            <input type="radio" name="comments-way" checked={way === "new"} onChange={() => setWay("new")} />
            {t("comments.setup.new")}
          </label>
          <label className="gfa-checkbox">
            <input type="radio" name="comments-way" checked={way === "existing"} onChange={() => setWay("existing")} />
            {t("comments.setup.existing")}
          </label>
        </fieldset>
        {way === "new" ? (
          <TextField
            label={t("comments.setup.name")}
            hint={t("comments.setup.nameHint")}
            value={name}
            onChange={setName}
          />
        ) : (
          <TextField
            label={t("comments.setup.existingName")}
            hint={t("comments.setup.existingHint")}
            placeholder="example/comments"
            value={existing}
            onChange={setExisting}
          />
        )}
        {error !== undefined && !(asking && !comments.access.active) && <CommentsProblem error={error} />}
        <PublishFailure failure={failure} />
        <div>
          <Button type="submit" variant="primary" disabled={busy || !(way === "new" ? name.trim() : existing.trim())}>
            {busy ? t("comments.setup.working") : t("comments.setup.button")}
          </Button>
        </div>
      </form>
    </>
  );
}

/** Where comments are kept, the step Giscus needs, and stopping. */
function CommentsPlaceSection({ place, made }: { place: CommentsPlace; made?: CommentsRepository }) {
  const t = useStrings();
  const webUrl = `https://github.com/${place.repo}`;

  return (
    <section className="gfa-form" aria-labelledby="gfa-comments-place">
      <h2 className="gfa-section-title" id="gfa-comments-place">
        {t("comments.place.title")}
      </h2>
      <p>
        {t("comments.place.kept", { category: place.category })}{" "}
        <a href={webUrl} target="_blank" rel="noreferrer">
          {place.repo}
        </a>
      </p>
      {made ? (
        <div className="gfa-notice gfa-notice-success" role="status">
          <p>
            <strong>{t("comments.install.title")}</strong>
          </p>
          <p>{t("comments.install.intro", { project: place.repo })}</p>
          <p>
            <a className="gfa-button gfa-button-primary" href={made.installUrl} target="_blank" rel="noreferrer">
              {t("comments.install.button")}
            </a>
          </p>
          <p>{t("comments.install.then")}</p>
        </div>
      ) : (
        <p className="gfa-hint">
          {t("comments.place.install")}{" "}
          <a href={GISCUS_APP_URL} target="_blank" rel="noreferrer">
            {t("comments.place.giscus")}
          </a>
        </p>
      )}
      <StopComments body={t("comments.stop.body", { project: place.repo })} />
    </section>
  );
}

/** Stops showing comments: publishes Site settings without them, leaving what visitors wrote where it is. */
function StopComments({ body }: { body: string }) {
  const t = useStrings();
  const { publish } = useAdmin();
  const { content } = useSiteContent();
  const [stopping, setStopping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);

  const stop = async () => {
    setBusy(true);
    setFailure(null);
    const { comments: _left, ...settings } = content.settings;
    const result = await publish([siteSettingsFileChange(settings)], t("comments.stop.message"), { checks: false });
    setBusy(false);
    if (result.ok) setStopping(false);
    else setFailure(result);
  };

  return (
    <>
      <div>
        <Button variant="danger" onClick={() => setStopping(true)}>
          {t("comments.stop.button")}
        </Button>
      </div>
      {stopping && (
        <Dialog title={t("comments.stop.title")} onClose={() => setStopping(false)}>
          <p>{body}</p>
          <PublishFailure failure={failure} />
          <div className="gfa-dialog-actions">
            <Button onClick={() => setStopping(false)}>{t("action.cancel")}</Button>
            <Button variant="danger" disabled={busy} onClick={() => void stop()}>
              {t("comments.stop.button")}
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

/** A comments service the screen names by what an owner pastes, and links to for moderating. */
interface NamedService {
  id: "disqus" | "garrul";
  /** What `content/site.json`'s `comments` is, from what was pasted, or nothing where it can't be read. */
  read(pasted: string): SiteCommentsPlace | undefined;
  /** Where to start with the service. */
  start: string;
  placeholder: string;
  keys: {
    title: StringKey;
    intro: StringKey;
    start: StringKey;
    then: StringKey;
    label: StringKey;
    invalid: StringKey;
    button: StringKey;
    message: StringKey;
  };
}

const DISQUS: NamedService = {
  id: "disqus",
  read: (pasted) => {
    const disqus = disqusShortname(pasted);
    return disqus ? { disqus } : undefined;
  },
  start: DISQUS_CREATE_URL,
  placeholder: "stjoseph",
  keys: {
    title: "comments.disqus.title",
    intro: "comments.disqus.intro",
    start: "comments.disqus.create",
    then: "comments.disqus.then",
    label: "comments.disqus.label",
    invalid: "comments.disqus.invalid",
    button: "comments.disqus.button",
    message: "comments.disqus.message",
  },
};

const GARRUL: NamedService = {
  id: "garrul",
  read: (pasted) => {
    const garrul = garrulAddress(pasted);
    return garrul ? { garrul } : undefined;
  },
  start: GARRUL_URL,
  placeholder: "https://comments.example.org",
  keys: {
    title: "comments.garrul.title",
    intro: "comments.garrul.intro",
    start: "comments.garrul.start",
    then: "comments.garrul.then",
    label: "comments.garrul.label",
    invalid: "comments.garrul.invalid",
    button: "comments.garrul.button",
    message: "comments.garrul.message",
  },
};

/** Names a service's place for comments, from what the service gives an owner to paste, and publishes it. */
function NamedServiceSetup({ service }: { service: NamedService }) {
  const t = useStrings();
  const { publish } = useAdmin();
  const { content } = useSiteContent();
  const [pasted, setPasted] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const { keys } = service;

  const use = async () => {
    const comments = service.read(pasted);
    setInvalid(!comments);
    if (!comments) return;
    setBusy(true);
    setFailure(null);
    const result = await publish([siteSettingsFileChange({ ...content.settings, comments })], t(keys.message), {
      checks: false,
    });
    setBusy(false);
    if (!result.ok) setFailure(result);
  };

  return (
    <form
      className="gfa-form"
      aria-labelledby={`gfa-comments-${service.id}`}
      onSubmit={(event) => {
        event.preventDefault();
        void use();
      }}
    >
      <h2 className="gfa-section-title" id={`gfa-comments-${service.id}`}>
        {t(keys.title)}
      </h2>
      <p>{t(keys.intro)}</p>
      <p>
        <a href={service.start} target="_blank" rel="noreferrer">
          {t(keys.start)}
        </a>
        {t(keys.then)}
      </p>
      <TextField
        label={t(keys.label)}
        placeholder={service.placeholder}
        error={invalid ? t(keys.invalid) : undefined}
        value={pasted}
        onChange={(value) => {
          setPasted(value);
          setInvalid(false);
        }}
      />
      <PublishFailure failure={failure} />
      <div>
        <Button type="submit" variant="primary" disabled={busy || !pasted.trim()}>
          {busy ? t("comments.setup.working") : t(keys.button)}
        </Button>
      </div>
    </form>
  );
}

/** Where a service keeps comments, where they're moderated, and stopping. */
function NamedServicePlace({ place }: { place: DisqusPlace | GarrulPlace }) {
  const t = useStrings();
  const disqus = isDisqus(place);
  return (
    <section className="gfa-form" aria-labelledby="gfa-comments-place">
      <h2 className="gfa-section-title" id="gfa-comments-place">
        {t("comments.place.title")}
      </h2>
      <p>
        {t(disqus ? "comments.disqus.kept" : "comments.garrul.kept")}{" "}
        <strong>{disqus ? place.disqus : place.garrul}</strong>
      </p>
      {!disqus && <p className="gfa-hint">{t("comments.garrul.origins")}</p>}
      <p>{t(disqus ? "comments.disqus.moderateHint" : "comments.garrul.moderateHint")}</p>
      <p>
        <a
          className="gfa-button gfa-button-primary"
          href={disqus ? disqusModerationUrl(place.disqus) : garrulModerationUrl(place.garrul)}
          target="_blank"
          rel="noreferrer"
        >
          {t(disqus ? "comments.disqus.moderate" : "comments.garrul.moderate")}
        </a>
      </p>
      <StopComments body={t(disqus ? "comments.disqus.stopBody" : "comments.garrul.stopBody")} />
    </section>
  );
}

function countComments(comments: SiteComment[]): number {
  return comments.reduce((total, comment) => total + 1 + countComments(comment.replies), 0);
}

/** `comment`'s list, with `change` made to the one with `id`, or it removed where `change` gives nothing. */
function changed(
  comments: SiteComment[],
  id: string,
  change: (comment: SiteComment) => SiteComment | undefined,
): SiteComment[] {
  return comments.flatMap((comment) => {
    if (comment.id === id) {
      const next = change(comment);
      return next ? [next] : [];
    }
    return [{ ...comment, replies: changed(comment.replies, id, change) }];
  });
}

type Asking = { kind: "hide" | "delete"; comment: SiteComment };

/** Pages' comments, those commented on most recently first, with hiding, deleting and closing them. */
function Moderation({ place }: { place: CommentsPlace }) {
  const t = useStrings();
  const { comments } = useAdmin();
  const [threads, setThreads] = useState<CommentThread[]>();
  const [next, setNext] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [asking, setAsking] = useState<Asking>();
  const [busy, setBusy] = useState(false);
  // Counts tokens used and forgotten, so the list loads again with the sign-in it has now.
  const [tokens, setTokens] = useState(0);

  const load = useCallback(
    (after?: string) => {
      if (!comments) return;
      setLoading(true);
      setError(undefined);
      comments.threads(place, after).then(
        (found) => {
          setThreads((previous) => [...(after ? (previous ?? []) : []), ...found.threads]);
          setNext(found.next);
          setLoading(false);
        },
        (caught: unknown) => {
          setError(caught);
          setLoading(false);
        },
      );
    },
    [comments, place],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new token loads the list again
  useEffect(() => load(), [load, tokens]);

  const act = async (work: () => Promise<void>, update: (threads: CommentThread[]) => CommentThread[]) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      setThreads((current) => current && update(current));
      setAsking(undefined);
    } catch (caught) {
      setError(caught);
      setAsking(undefined);
    } finally {
      setBusy(false);
    }
  };

  const changeComment =
    (id: string, change: (comment: SiteComment) => SiteComment | undefined) => (current: CommentThread[]) =>
      current.map((thread) => ({ ...thread, comments: changed(thread.comments, id, change) }));

  if (!comments) return null;
  const tokenNeeded = needsToken(error) && !comments.access.active;

  return (
    <section className="gfa-form gfa-comments" aria-labelledby="gfa-comments-moderate">
      <h2 className="gfa-section-title" id="gfa-comments-moderate">
        {t("comments.moderate.title")}
      </h2>
      <CommentsTokenActive onForget={() => setTokens((count) => count + 1)} />
      {tokenNeeded ? (
        <CommentsTokenForm onReady={() => setTokens((count) => count + 1)} />
      ) : (
        error !== undefined && <CommentsProblem error={error} />
      )}
      {threads?.length === 0 && <p>{t("comments.moderate.empty")}</p>}
      {threads?.map((thread) => (
        <details key={thread.id} className="gfa-comments-thread">
          <summary>
            <strong>/{thread.title.replace(/^\/+/, "")}</strong>{" "}
            <span className="gfa-hint">
              {t("comments.thread.count", { count: String(countComments(thread.comments)) })}
              {" · "}
              {formatDate(thread.updatedAt)}
            </span>
            {thread.locked && <span className="gfa-badge gfa-badge-warning">{t("comments.thread.locked")}</span>}
          </summary>
          <div className="gfa-comments-actions">
            <Button
              disabled={busy}
              onClick={() =>
                void act(
                  () => (thread.locked ? comments.unlock(thread.id) : comments.lock(thread.id)),
                  (current) =>
                    current.map((candidate) =>
                      candidate.id === thread.id ? { ...candidate, locked: !thread.locked } : candidate,
                    ),
                )
              }
            >
              {t(thread.locked ? "comments.thread.unlock" : "comments.thread.lock")}
            </Button>
            <a href={thread.url} target="_blank" rel="noreferrer">
              {t("comments.openOnGitHub")}
            </a>
          </div>
          <CommentList
            comments={thread.comments}
            busy={busy}
            onHide={(comment) => setAsking({ kind: "hide", comment })}
            onDelete={(comment) => setAsking({ kind: "delete", comment })}
            onShow={(comment) =>
              void act(
                () => comments.show(comment.id),
                changeComment(comment.id, (found) => {
                  const { hiddenReason: _reason, ...shown } = found;
                  return { ...shown, hidden: false };
                }),
              )
            }
          />
        </details>
      ))}
      {loading && <p role="status">{t("loading")}</p>}
      {next && !loading && (
        <div>
          <Button onClick={() => load(next)}>{t("comments.moderate.more")}</Button>
        </div>
      )}
      <p className="gfa-hint">
        {t("comments.moderate.block")}{" "}
        <a href={BLOCKING_HELP} target="_blank" rel="noreferrer">
          {t("comments.moderate.blockLink")}
        </a>
      </p>
      {asking?.kind === "hide" && (
        <HideDialog
          busy={busy}
          onClose={() => setAsking(undefined)}
          onHide={(reason) =>
            void act(
              () => comments.hide(asking.comment.id, reason),
              changeComment(asking.comment.id, (found) => ({ ...found, hidden: true, hiddenReason: reason })),
            )
          }
        />
      )}
      {asking?.kind === "delete" && (
        <Dialog title={t("comments.delete.title")} onClose={() => setAsking(undefined)}>
          <blockquote className="gfa-comment-quote">{asking.comment.text}</blockquote>
          <p>{t(asking.comment.replies.length > 0 ? "comments.delete.bodyReplies" : "comments.delete.body")}</p>
          <div className="gfa-dialog-actions">
            <Button onClick={() => setAsking(undefined)}>{t("action.cancel")}</Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                void act(
                  () => comments.remove(asking.comment.id),
                  changeComment(asking.comment.id, () => undefined),
                )
              }
            >
              {t("comments.comment.delete")}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

const REASON_WORDS: Record<HideReason, StringKey> = {
  spam: "comments.reason.spam",
  abuse: "comments.reason.abuse",
  "off-topic": "comments.reason.off-topic",
};

function CommentList({
  comments,
  busy,
  onHide,
  onShow,
  onDelete,
}: {
  comments: SiteComment[];
  busy: boolean;
  onHide: (comment: SiteComment) => void;
  onShow: (comment: SiteComment) => void;
  onDelete: (comment: SiteComment) => void;
}) {
  const t = useStrings();
  if (comments.length === 0) return null;
  return (
    <ul className="gfa-comment-list">
      {comments.map((comment) => {
        const reason = HIDE_REASONS.find((candidate) => candidate === comment.hiddenReason);
        return (
          <li key={comment.id} className={comment.hidden ? "gfa-comment gfa-comment-hidden" : "gfa-comment"}>
            <p className="gfa-comment-byline">
              <a href={comment.author.url} target="_blank" rel="noreferrer">
                {comment.author.login}
              </a>{" "}
              <span className="gfa-hint">{formatDate(comment.createdAt)}</span>{" "}
              {comment.hidden && (
                <span className="gfa-badge gfa-badge-warning">
                  {reason
                    ? t("comments.comment.hiddenAs", { reason: t(REASON_WORDS[reason]) })
                    : t("comments.comment.hidden")}
                </span>
              )}
            </p>
            <p className="gfa-comment-text">{comment.text}</p>
            <div className="gfa-comments-actions">
              {comment.hidden ? (
                <Button variant="ghost" disabled={busy} onClick={() => onShow(comment)}>
                  {t("comments.comment.show")}
                </Button>
              ) : (
                <Button variant="ghost" disabled={busy} onClick={() => onHide(comment)}>
                  {t("comments.comment.hide")}
                </Button>
              )}
              <Button variant="ghost" disabled={busy} onClick={() => onDelete(comment)}>
                {t("comments.comment.delete")}
              </Button>
              <a href={comment.url} target="_blank" rel="noreferrer">
                {t("comments.openOnGitHub")}
              </a>
            </div>
            <CommentList comments={comment.replies} busy={busy} onHide={onHide} onShow={onShow} onDelete={onDelete} />
          </li>
        );
      })}
    </ul>
  );
}

function HideDialog({
  busy,
  onClose,
  onHide,
}: {
  busy: boolean;
  onClose: () => void;
  onHide: (reason: HideReason) => void;
}) {
  const t = useStrings();
  const [reason, setReason] = useState<HideReason>("spam");
  return (
    <Dialog title={t("comments.hide.title")} onClose={onClose}>
      <p>{t("comments.hide.body")}</p>
      <fieldset className="gfa-choice-group">
        <legend className="gfa-label">{t("comments.hide.reason")}</legend>
        {HIDE_REASONS.map((choice) => (
          <label key={choice} className="gfa-checkbox">
            <input type="radio" name="hide-reason" checked={reason === choice} onChange={() => setReason(choice)} />
            {t(REASON_WORDS[choice])}
          </label>
        ))}
      </fieldset>
      <div className="gfa-dialog-actions">
        <Button onClick={onClose}>{t("action.cancel")}</Button>
        <Button variant="primary" disabled={busy} onClick={() => onHide(reason)}>
          {t("comments.comment.hide")}
        </Button>
      </div>
    </Dialog>
  );
}
