import {
  type AvailableBlock,
  availableBlocks,
  type BlockUse,
  blockUses,
  type FetchJson,
  INSTALLED_RECORD_FILE,
  type InstalledRecord,
  parseInstalledRecord,
  planBlockChanges,
  RegistryError,
  type RegistryProblem,
} from "@goodfellow-cms/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { useUnsavedChanges } from "./router.js";
import { type StringKey, type Translate, useStrings } from "./strings.js";
import { Button, Dialog, ErrorMessage } from "./ui.js";

const fetchJson: FetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  return response.json();
};

/** What went wrong with a block registry, in plain words. */
function problemText(t: Translate, problem: RegistryProblem, name: string): string {
  const key = `blocks.error.${problem.code}` as StringKey;
  if (problem.code === "packages") return t(key, { packages: problem.packages.join(", ") });
  if (problem.code === "file-exists" || problem.code === "unsupported-file") return t(key, { path: problem.path });
  return t(key, { name });
}

/** The places a block is used, as they're named elsewhere in the admin panel. */
function placesText(t: Translate, uses: BlockUse[]): string {
  return uses
    .map((use) => {
      if (use.kind === "page") return use.title ? `${use.title} (${use.path})` : use.path;
      if (use.kind === "template") return t("blocks.usedTemplate", { name: use.name });
      return t(use.kind === "header" ? "layout.header" : "layout.footer");
    })
    .join(", ");
}

type Notice = { type: "published" } | { type: "failed"; message: string; error?: unknown };

/** A block to add or remove when the changes are published. */
type Pending = { kind: "add"; block: AvailableBlock } | { kind: "remove"; name: string; title: string };

/** Says why a block that's in use can't be removed yet. */
function InUseDialog({ name, title, onClose }: { name: string; title: string; onClose: () => void }) {
  const t = useStrings();
  const { content } = useSiteContent();
  const uses = useMemo(() => blockUses(content, name), [content, name]);
  return (
    <Dialog title={t("blocks.inUseTitle", { name: title })} onClose={onClose}>
      <p>{t("blocks.inUse", { name: title, places: placesText(t, uses) })}</p>
      <div className="gfa-dialog-actions">
        <Button onClick={onClose}>{t("action.close")}</Button>
      </div>
    </Dialog>
  );
}

function BlockCard({
  block,
  installed,
  pending,
  disabled,
  onAdd,
  onUndo,
}: {
  block: AvailableBlock;
  installed: boolean;
  pending: boolean;
  disabled: boolean;
  onAdd: () => void;
  onUndo: () => void;
}) {
  const t = useStrings();
  return (
    <li className="gfa-block-card">
      {block.image && <img src={block.image} alt="" className="gfa-block-image" loading="lazy" />}
      <div className="gfa-block-text">
        <h3 className="gfa-block-title">
          {block.title}
          {block.recommended && <span className="gfa-badge">{t("blocks.recommended")}</span>}
        </h3>
        {block.description && <p className="gfa-hint">{block.description}</p>}
      </div>
      {installed ? (
        <span className="gfa-block-added">{t("blocks.added")}</span>
      ) : pending ? (
        <span className="gfa-block-pending">
          <span className="gfa-block-added">{t("blocks.willAdd")}</span>
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={onUndo}
            aria-label={t("blocks.undoAddLabel", { name: block.title })}
          >
            {t("blocks.undo")}
          </Button>
        </span>
      ) : (
        <Button disabled={disabled} onClick={onAdd} aria-label={t("blocks.addLabel", { name: block.title })}>
          {t("blocks.add")}
        </Button>
      )}
    </li>
  );
}

/** The publish's description: the one block's, or every change's. */
function publishMessage(t: Translate, pending: Pending[]): string {
  const [only] = pending;
  if (pending.length === 1 && only) {
    return only.kind === "add"
      ? t("blocks.addMessage", { name: only.block.title })
      : t("blocks.removeMessage", { name: only.title });
  }
  const added = pending.flatMap((change) => (change.kind === "add" ? [change.block.title] : []));
  const removed = pending.flatMap((change) => (change.kind === "remove" ? [change.title] : []));
  return t("blocks.changeMessage", {
    changes: [
      ...(added.length > 0 ? [t("blocks.addPart", { names: added.join(", ") })] : []),
      ...(removed.length > 0 ? [t("blocks.removePart", { names: removed.join(", ") })] : []),
    ].join("; "),
  });
}

/**
 * Adds blocks from block registries to the site, and removes them. Blocks are
 * marked to add or remove, then published together in one save, which writes
 * their code into the site; the editor offers them once the site has been
 * rebuilt with it.
 */
export function BlocksScreen() {
  const t = useStrings();
  const { blocks, registries, readFile, publish, demo } = useAdmin();
  const { content, revision } = useSiteContent();
  const [record, setRecord] = useState<InstalledRecord>();
  const [available, setAvailable] = useState<AvailableBlock[]>();
  const [recordError, setRecordError] = useState<unknown>();
  const [loadError, setLoadError] = useState<unknown>();
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [inUse, setInUse] = useState<{ name: string; title: string }>();
  const [pending, setPending] = useState<Pending[]>([]);
  useUnsavedChanges(pending.length > 0);

  // The record is read again after each publish, which changes the revision.
  useEffect(() => {
    let current = true;
    // The revision changes after each publish, and with it what the record says.
    void revision;
    readFile(INSTALLED_RECORD_FILE)
      .then((text) => parseInstalledRecord(text))
      .then(
        (next) => current && setRecord(next),
        (error: unknown) => current && setRecordError(error),
      );
    return () => {
      current = false;
    };
  }, [readFile, revision]);

  const loadAvailable = useCallback(() => {
    setLoadError(undefined);
    availableBlocks(registries, fetchJson).then(setAvailable, setLoadError);
  }, [registries]);
  useEffect(loadAvailable, [loadAvailable]);

  const isPendingAdd = (block: AvailableBlock) =>
    pending.some((change) => change.kind === "add" && change.block.ref === block.ref);
  const isPendingRemove = (name: string) => pending.some((change) => change.kind === "remove" && change.name === name);
  const change = (next: Pending[]) => {
    setNotice(undefined);
    setPending(next);
  };

  const onRemove = (name: string, title: string) => {
    if (blockUses(content, name).length > 0) setInUse({ name, title });
    else change([...pending, { kind: "remove", name, title }]);
  };

  const onPublish = async () => {
    if (!record || pending.length === 0) return;
    setPublishing(true);
    setNotice(undefined);
    const failedTitle = (error: unknown) => {
      if (!(error instanceof RegistryError)) return "";
      const problem = error.problem;
      if ("name" in problem) {
        const match = pending.find((item) =>
          item.kind === "add" ? item.block.name === problem.name : item.name === problem.name,
        );
        if (match) return match.kind === "add" ? match.block.title : match.title;
      }
      return pending.length === 1 && pending[0]?.kind === "add" ? pending[0].block.title : "";
    };
    try {
      const plan = await planBlockChanges({
        changes: pending.map((item) => (item.kind === "add" ? { add: item.block.ref } : { remove: item.name })),
        registries,
        fetchJson,
        readFile,
        record,
        blocks: Object.keys(blocks),
        content,
      });
      const result = await publish(plan.changes, publishMessage(t, pending));
      if (result.ok) {
        setPending([]);
        setNotice({ type: "published" });
      } else if (result.reason === "checks") {
        setNotice(undefined);
      } else {
        setNotice({
          type: "failed",
          message: t(result.reason === "conflict" ? "publish.conflict" : "publish.error"),
          error: result.error,
        });
      }
    } catch (error) {
      setNotice({
        type: "failed",
        message:
          error instanceof RegistryError ? problemText(t, error.problem, failedTitle(error)) : t("publish.error"),
        error,
      });
    }
    setPublishing(false);
  };

  const installed = record ? Object.entries(record.blocks).sort(([, a], [, b]) => a.title.localeCompare(b.title)) : [];
  const categories = new Map<string, AvailableBlock[]>();
  for (const block of available ?? [])
    categories.set(block.category, [...(categories.get(block.category) ?? []), block]);
  const locked = publishing || !record || Boolean(demo);

  return (
    <div className="gfa-screen">
      <div className="gfa-screen-header">
        <h1>{t("blocks.title")}</h1>
      </div>
      <p className="gfa-hint">{t("blocks.intro")}</p>
      {demo && (
        <p className="gfa-notice" role="note">
          {t("blocks.demo")}
        </p>
      )}

      {pending.length > 0 && (
        <section className="gfa-block-pending-bar" aria-label={t("blocks.pendingTitle")}>
          <div>
            <strong>{t("blocks.pendingTitle")}</strong>
            <ul>
              {pending.map((item) => (
                <li key={item.kind === "add" ? `add:${item.block.ref}` : `remove:${item.name}`}>
                  {item.kind === "add"
                    ? t("blocks.pendingAdd", { name: item.block.title })
                    : t("blocks.pendingRemove", { name: item.title })}
                </li>
              ))}
            </ul>
          </div>
          <div className="gfa-dialog-actions">
            <Button variant="ghost" disabled={publishing} onClick={() => change([])}>
              {t("blocks.discard")}
            </Button>
            <Button variant="primary" disabled={locked} onClick={() => void onPublish()}>
              {publishing ? t("publish.publishing") : t("blocks.publish")}
            </Button>
          </div>
        </section>
      )}

      {notice?.type === "published" && (
        <p className="gfa-notice gfa-notice-success" role="status">
          {t("blocks.publishedNotice")}
        </p>
      )}
      {notice?.type === "failed" && <ErrorMessage message={notice.message} error={notice.error} />}

      <h2 className="gfa-section-title">{t("blocks.installed")}</h2>
      {installed.length === 0 ? (
        <p className="gfa-hint">{record ? t("blocks.noneInstalled") : t("loading")}</p>
      ) : (
        <ul className="gfa-block-list">
          {installed.map(([name, block]) => (
            <li key={name} className="gfa-block-row">
              <span>
                <strong>{block.title}</strong> <span className="gfa-hint">{block.category}</span>
              </span>
              {isPendingRemove(name) ? (
                <span className="gfa-block-pending">
                  <span className="gfa-block-added">{t("blocks.willRemove")}</span>
                  <Button
                    variant="ghost"
                    disabled={publishing}
                    aria-label={t("blocks.undoRemoveLabel", { name: block.title })}
                    onClick={() => change(pending.filter((item) => !(item.kind === "remove" && item.name === name)))}
                  >
                    {t("blocks.undo")}
                  </Button>
                </span>
              ) : (
                <Button
                  variant="ghost"
                  disabled={locked}
                  aria-label={t("blocks.removeLabel", { name: block.title })}
                  onClick={() => onRemove(name, block.title)}
                >
                  {t("blocks.remove")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {recordError !== undefined && <ErrorMessage message={t("blocks.error.record")} error={recordError} />}
      {loadError !== undefined && (
        <ErrorMessage
          message={
            loadError instanceof RegistryError ? problemText(t, loadError.problem, "") : t("blocks.error.unreachable")
          }
          error={loadError}
          action={<Button onClick={loadAvailable}>{t("action.tryAgain")}</Button>}
        />
      )}
      {!available && loadError === undefined && <p className="gfa-hint">{t("blocks.loading")}</p>}
      {[...categories].map(([category, blocks]) => (
        <section key={category}>
          <h2 className="gfa-section-title">{category}</h2>
          <ul className="gfa-block-grid">
            {blocks.map((block) => (
              <BlockCard
                key={block.ref}
                block={block}
                installed={Boolean(record?.blocks[block.name])}
                pending={isPendingAdd(block)}
                disabled={locked}
                onAdd={() => change([...pending, { kind: "add", block }])}
                onUndo={() => change(pending.filter((item) => !(item.kind === "add" && item.block.ref === block.ref)))}
              />
            ))}
          </ul>
        </section>
      ))}

      {inUse && <InUseDialog name={inUse.name} title={inUse.title} onClose={() => setInUse(undefined)} />}
    </div>
  );
}
