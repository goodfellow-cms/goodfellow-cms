/**
 * The token broker's page: signs editors in to the site's git host, keeps the
 * sign-in and their AI keys in its own storage, and shows the site's admin
 * panel in a frame, whose every call to the git host it makes itself
 * (`serveBackend()`). It asks the editor, in its own part of the page, before
 * publishing anything the admin panel's frame shouldn't decide alone.
 */
import { aiServer, PROVIDERS, type ProviderId, type ServerKeys } from "@goodfellow-cms/ai";
import {
  adminOrigin,
  BROKER_CONNECT_MESSAGE,
  BROKER_READY_MESSAGE,
  type BrokerAccount,
  BrokerRefusedError,
  type BrokerServiceAnswer,
  type BrokerServiceRequest,
  configAdmin,
  type GitBackend,
  type GitHost,
  type HostSource,
  type PluginManifest,
  serveBackend,
} from "@goodfellow-cms/core";
import { type BrokerQuestion, decide } from "./policy.js";
import { type StringKey, t } from "./strings.js";

/** `broker.json`, beside the page: the sites it signs in to, each as its config's backend makes it (`GitHost.source`). */
export interface BrokerConfig {
  sites: HostSource[];
}

/** How the broker makes each git host it knows. */
export type HostLoaders = Record<string, () => Promise<Record<string, unknown>>>;

const ROUTE_KEY = "goodfellow:broker:route";
const AI_KEY = "goodfellow:broker:ai";
const CONFIG_FILE = "goodfellow.config.tsx";

/** The services the broker keeps keys for: those whose API has one address, as the assistant asks them. */
const AI_SERVICES = (Object.keys(PROVIDERS) as ProviderId[]).filter(
  (id) => id !== "custom" && id !== "manual" && (id === "anthropic" || PROVIDERS[id].baseUrl),
);

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The site's name in its host's options, such as `parish/site`. */
function siteName(source: HostSource): string {
  const { repo, project } = source.options as { repo?: unknown; project?: unknown };
  return typeof repo === "string" ? repo : typeof project === "string" ? project : source.package;
}

/** The broker's AI keys, from wherever the editor chose to keep them. */
function loadKeys(): ServerKeys {
  for (const storage of [sessionStorage, localStorage]) {
    try {
      const saved = storage.getItem(AI_KEY);
      if (saved) return JSON.parse(saved) as ServerKeys;
    } catch {
      // Storage that can't be read keeps nothing.
    }
  }
  return {};
}

function saveKeys(keys: ServerKeys, remember: boolean): void {
  forgetKeys();
  (remember ? localStorage : sessionStorage).setItem(AI_KEY, JSON.stringify(keys));
}

function forgetKeys(): void {
  sessionStorage.removeItem(AI_KEY);
  localStorage.removeItem(AI_KEY);
}

/** Where the admin panel is, for a site: its admin address once checked, or the Site address's `admin/`. */
async function adminLocation(backend: GitBackend): Promise<{ url: string; siteUrl: string } | { problem: StringKey }> {
  const revision = await backend.revision();
  const settings = JSON.parse((await backend.read("content/site.json")) ?? "{}") as { url?: unknown };
  if (typeof settings.url !== "string" || !settings.url) return { problem: "noSiteAddress" };
  let site: URL;
  try {
    site = new URL(settings.url.replace(/\/?$/, "/"));
  } catch {
    return { problem: "badSiteAddress" };
  }
  const local = site.hostname === "localhost" || site.hostname === "127.0.0.1";
  if (site.protocol !== "https:" && !(site.protocol === "http:" && local)) return { problem: "badSiteAddress" };
  // A repository of content only has no config: its admin panel is at the Site address.
  const config = await backend.readAt(CONFIG_FILE, revision).catch(() => undefined);
  const admin = config ? configAdmin(config) : undefined;
  const origin = admin?.checked ? adminOrigin(admin) : undefined;
  return { url: `${origin ?? site.origin}${site.pathname}admin/`, siteUrl: settings.url };
}

export interface StartOptions {
  root: HTMLElement;
  config: BrokerConfig | undefined;
  hosts: HostLoaders;
}

/** Starts the broker's page in `root`. */
export async function startBroker({ root, config, hosts }: StartOptions): Promise<void> {
  document.title = t("title");
  const show = (...children: (Node | string)[]) => root.replaceChildren(...children);

  // Never under someone else's pointer: a page around it could trick the editor into publishing.
  if (window.top !== window) {
    show(element("p", { class: "broker-note" }, t("framed")));
    return;
  }
  const wanted = new URLSearchParams(location.search).get("site");
  const source = config?.sites.find((site) => !wanted || siteName(site) === wanted) ?? config?.sites[0];
  const load = source && Object.hasOwn(hosts, source.package) ? hosts[source.package] : undefined;
  const make = load && (await load())[source?.export ?? ""];
  if (!source || typeof make !== "function") {
    show(element("p", { class: "broker-note" }, t("noConfig")));
    return;
  }
  const host = (make as (options: Record<string, unknown>) => GitHost)(source.options);
  // An address the editor opened, such as a link to a page in the admin panel, or the screen they were on.
  const keepRoute = () => {
    if (location.hash) sessionStorage.setItem(ROUTE_KEY, location.hash);
  };
  keepRoute();
  window.addEventListener("hashchange", keepRoute);

  show(element("p", { class: "broker-note" }, t("loading")));
  let backend: GitBackend | null = null;
  let failure: unknown;
  try {
    backend = await host.restore();
  } catch (error) {
    failure = error;
  }
  if (backend) await showAdmin(backend);
  else showSignIn(failure);

  function showSignIn(error?: unknown) {
    const form = element("form", { class: "broker-sign-in" });
    const remember = element("input", { type: "checkbox", id: "broker-remember" });
    const token = element("input", { type: "password", id: "broker-token", autocomplete: "off" });
    const problem = element("p", { class: "broker-error", role: "alert" });
    if (error !== undefined) problem.textContent = t("signInError", { message: message(error) });
    const signIn = element("button", { type: "submit" }, t("signInButton"));
    const finish = async (attempt: () => Promise<GitBackend>) => {
      signIn.disabled = true;
      problem.textContent = t("signingIn");
      try {
        await showAdmin(await attempt());
      } catch (caught) {
        problem.textContent = t("signInError", { message: message(caught) });
        signIn.disabled = false;
      }
    };
    form.append(
      element("h1", {}, t("signInTitle", { site: siteName(source as HostSource) })),
      element("p", {}, t("signInIntro")),
      problem,
    );
    if (host.canRedirect) {
      const redirect = element(
        "button",
        { type: "button", class: "broker-primary" },
        t("signInRedirect", { host: host.name }),
      );
      redirect.addEventListener(
        "click",
        () =>
          void host.startRedirect(remember.checked).catch((caught: unknown) => {
            problem.textContent = t("signInError", { message: message(caught) });
          }),
      );
      form.append(element("div", {}, redirect));
    }
    if (host.tokenLinks) {
      const links = element("ul", {});
      for (const link of host.tokenLinks) {
        links.append(
          element("li", {}, element("a", { href: link.url, target: "_blank", rel: "noreferrer" }, link.url)),
        );
      }
      form.append(
        element("h2", {}, t("signInToken")),
        links,
        element("label", { for: "broker-token" }, t("tokenLabel")),
        token,
        element("label", { class: "broker-check" }, remember, ` ${t("remember")}`),
        element("div", {}, signIn),
      );
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (token.value.trim()) void finish(() => host.signInWithToken(token.value.trim(), remember.checked));
    });
    show(form);
  }

  async function showAdmin(signedIn: GitBackend) {
    const where = await adminLocation(signedIn).catch((error: unknown) => ({ problem: "signInError" as const, error }));
    if ("problem" in where) {
      show(
        element(
          "p",
          { class: "broker-note", role: "alert" },
          t(where.problem, { address: "", message: "error" in where ? message(where.error) : "" }),
        ),
      );
      return;
    }
    const frameOrigin = new URL(where.url).origin;
    const route = sessionStorage.getItem(ROUTE_KEY) ?? "";
    const frame = element("iframe", {
      class: "broker-frame",
      title: t("adminFrame"),
      src: `${where.url}${route.startsWith("#") ? route : ""}`,
      // The admin panel runs at its own address, without leaving the broker or reaching the page it's in.
      sandbox:
        "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals",
      allow: "clipboard-write",
    });
    const signOut = () => {
      window.removeEventListener("message", onMessage);
      stop?.();
      signedIn.signOut();
      forgetKeys();
      sessionStorage.removeItem(ROUTE_KEY);
      showSignIn();
    };
    const aiButton = element("button", { type: "button" }, t("aiKeys"));
    aiButton.addEventListener("click", () => editKeys(() => frame.contentWindow?.location.replace(frame.src)));
    const signOutButton = element("button", { type: "button" }, t("signOut"));
    signOutButton.addEventListener("click", signOut);
    show(
      element(
        "header",
        { class: "broker-bar" },
        element("span", {}, t("signedInAs", { name: signedIn.user.name || signedIn.user.login })),
        aiButton,
        signOutButton,
      ),
      frame,
    );

    let stop: (() => void) | undefined;
    const onMessage = (event: MessageEvent) => {
      // Only the admin panel, in this page's own frame, at its own address.
      if (event.source !== frame.contentWindow || event.origin !== frameOrigin) return;
      if ((event.data as { type?: unknown } | null)?.type !== BROKER_READY_MESSAGE) return;
      stop?.();
      const backendChannel = new MessageChannel();
      const services = new MessageChannel();
      stop = serveBackend(backendChannel.port1, signedIn, {
        async check(call) {
          const decision = await decide(call, where.siteUrl);
          if (decision.action === "refuse") {
            throw new BrokerRefusedError("workflow", t("refusedWorkflow", { paths: decision.paths.join(", ") }));
          }
          if (decision.action === "ask" && !(await confirm(decision.questions))) {
            throw new BrokerRefusedError("declined", t("declined"));
          }
        },
        extra: {
          signOut,
          "ownerAccess.requestToken": () => askOwnerToken(signedIn),
        },
      });
      services.port1.onmessage = (serviceEvent) => void answerService(services.port1, serviceEvent.data);
      const account: BrokerAccount = {
        hostName: host.name,
        redirectAddressesListed: host.canRedirect && host.redirectAddressesListed === true,
        aiServices: Object.keys(loadKeys()),
      };
      frame.contentWindow?.postMessage({ type: BROKER_CONNECT_MESSAGE, account }, frameOrigin, [
        backendChannel.port2,
        services.port2,
      ]);
    };
    window.addEventListener("message", onMessage);
  }

  async function answerService(port: MessagePort, request: BrokerServiceRequest | undefined) {
    if (request?.type === "route" && typeof request.hash === "string") {
      sessionStorage.setItem(ROUTE_KEY, request.hash);
      return;
    }
    if (request?.type !== "ai") return;
    const [service = "", ...rest] = request.path.split("?")[0]?.split("/") ?? [];
    const query = request.path.includes("?") ? request.path.slice(request.path.indexOf("?")) : "";
    const forwarded = new Request(`https://broker.invalid/${rest.join("/")}${query}`, {
      method: request.method,
      headers: request.headers,
      ...(request.body && request.method !== "GET" && { body: request.body }),
    });
    const response = await aiServer(loadKeys()).forward(forwarded, service, rest.join("/"));
    const body = await response.arrayBuffer();
    const answer: BrokerServiceAnswer = {
      type: "ai",
      id: request.id,
      status: response.status,
      headers: [...response.headers.entries()],
      body,
    };
    port.postMessage(answer, [body]);
  }

  /** Shows a dialog in the broker's own part of the page, resolving with what the editor chose. */
  function dialog(
    title: string,
    body: (Node | string)[],
    actions: { label: string; value: boolean; primary?: boolean }[],
  ) {
    return new Promise<boolean>((resolve) => {
      const box = element("dialog", { class: "broker-dialog" }, element("h2", {}, title), ...body);
      const buttons = element("div", { class: "broker-actions" });
      for (const action of actions) {
        const button = element(
          "button",
          { type: "button", ...(action.primary && { class: "broker-primary" }) },
          action.label,
        );
        button.addEventListener("click", () => box.close(action.value ? "yes" : "no"));
        buttons.append(button);
      }
      box.append(buttons);
      box.addEventListener("close", () => {
        box.remove();
        resolve(box.returnValue === "yes");
      });
      document.body.append(box);
      box.showModal();
    });
  }

  /** What a plugin asks to do, a line each, as the broker says it. */
  function pluginLines(manifest: PluginManifest): string[] {
    const { permissions } = manifest;
    const list = (values: string[] | undefined, key: StringKey) =>
      values?.length ? [t(key, { list: values.join(", ") })] : [];
    const lines = [
      ...list(permissions.connect, "pluginConnect"),
      ...list(permissions.files, "pluginFiles"),
      ...list(permissions.secrets, "pluginSecrets"),
      ...list(permissions.read, "pluginRead"),
      ...list(permissions.write, "pluginWrite"),
      ...list(manifest.blocks, "pluginBlocks"),
      ...(manifest.admin ? [t("pluginAdmin")] : []),
      ...(manifest.build?.length ? [t("pluginBuild")] : []),
      ...(manifest.server ? [t("pluginServer")] : []),
    ];
    return lines.length > 0 ? lines : [t("pluginNothing")];
  }

  function confirm(questions: BrokerQuestion[]): Promise<boolean> {
    const body: (Node | string)[] = [element("p", {}, t("confirmIntro"))];
    let publishes = false;
    for (const question of questions) {
      if (question.kind === "update") body.push(element("p", {}, t("confirmUpdate", { release: question.release })));
      else if (question.kind === "plugins") {
        publishes = true;
        for (const plugin of question.installed) {
          const { manifest } = plugin;
          body.push(
            element("p", {}, t("confirmPlugin", { title: manifest.title, name: plugin.name, release: plugin.release })),
            element("ul", {}, ...pluginLines(manifest).map((line) => element("li", {}, line))),
          );
        }
        for (const name of question.removed) body.push(element("p", {}, t("confirmPluginRemove", { name })));
      } else if (question.kind === "editors") {
        body.push(
          element(
            "p",
            {},
            question.who
              ? t("confirmEditors", { who: question.who, role: question.role ? ` (${question.role})` : "" })
              : t("confirmEditorsPublish"),
          ),
        );
      } else {
        publishes = true;
        const intro =
          question.kind === "code"
            ? "confirmCode"
            : question.kind === "custom-code"
              ? "confirmCustomCode"
              : "confirmSiteAddress";
        body.push(
          element("p", {}, t(intro)),
          element("ul", {}, ...question.paths.map((path) => element("li", {}, element("code", {}, path)))),
        );
      }
    }
    return dialog(t("confirmTitle"), body, [
      { label: t("cancel"), value: false },
      { label: t(publishes ? "confirmPublish" : "confirmAllow"), value: true, primary: true },
    ]);
  }

  /** Asks for an owner token in the broker's own dialog, and gives it to the backend, which keeps it in memory. */
  async function askOwnerToken(signedIn: GitBackend): Promise<void> {
    const access = signedIn.ownerAccess;
    if (!access) throw new BrokerRefusedError("not-here", "This site's host has no owner token.");
    const field = element("input", { type: "password", id: "broker-owner-token", autocomplete: "off" });
    const problem = element("p", { class: "broker-error", role: "alert" });
    for (;;) {
      const ok = await dialog(
        t("ownerTitle"),
        [
          element("p", {}, t("ownerIntro")),
          element(
            "p",
            {},
            element("a", { href: access.tokenLink.url, target: "_blank", rel: "noreferrer" }, t("ownerCreate")),
          ),
          element("label", { for: "broker-owner-token" }, t("ownerLabel")),
          field,
          problem,
        ],
        [
          { label: t("cancel"), value: false },
          { label: t("ownerUse"), value: true, primary: true },
        ],
      );
      if (!ok) throw new BrokerRefusedError("declined", t("declined"));
      try {
        await access.applyToken(field.value.trim());
        return;
      } catch (error) {
        // Asked again, saying why, until it works or the editor gives up.
        problem.textContent = t("signInError", { message: message(error) });
      }
    }
  }

  /** The AI keys dialog: a key for each service, kept where the editor chose. */
  async function editKeys(onSaved: () => void) {
    const keys = loadKeys();
    const fields = new Map<ProviderId, HTMLInputElement>();
    const rows = AI_SERVICES.map((id) => {
      const field = element("input", { type: "password", id: `broker-ai-${id}`, autocomplete: "off" });
      const saved = keys[id as Exclude<ProviderId, "manual">];
      if (typeof saved === "string") field.value = saved;
      fields.set(id, field);
      return element("div", {}, element("label", { for: `broker-ai-${id}` }, PROVIDERS[id].name), field);
    });
    const remember = element("input", { type: "checkbox", id: "broker-ai-remember" });
    remember.checked = localStorage.getItem(AI_KEY) !== null;
    const saved = await dialog(
      t("aiTitle"),
      [
        element("p", {}, t("aiIntro")),
        ...rows,
        element("label", { class: "broker-check" }, remember, ` ${t("aiRemember")}`),
      ],
      [
        { label: t("cancel"), value: false },
        { label: t("aiSave"), value: true, primary: true },
      ],
    );
    if (!saved) return;
    const next: ServerKeys = {};
    for (const [id, field] of fields) {
      if (field.value.trim()) next[id as Exclude<ProviderId, "manual">] = field.value.trim();
    }
    saveKeys(next, remember.checked);
    // The admin panel learns which services it can ask when it connects again.
    onSaved();
  }
}
