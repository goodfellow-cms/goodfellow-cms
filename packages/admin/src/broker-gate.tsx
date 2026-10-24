import {
  BROKER_AI_ADDRESS,
  BROKER_CONNECT_MESSAGE,
  BROKER_READY_MESSAGE,
  type BrokerAccount,
  type BrokerAddress,
  type BrokerServiceAnswer,
  type BrokerServiceRequest,
  brokerOrigin,
  type GitBackend,
  type GitHost,
  remoteBackend,
} from "@goodfellow-cms/core";
import { type ReactNode, useEffect, useState } from "react";
import { useStrings } from "./strings.js";
import { ErrorMessage } from "./ui.js";

/** How long the admin panel waits for the broker around it before saying where to open it. */
const CONNECT_TIMEOUT_MS = 10_000;

type GateState =
  | { status: "connecting" }
  /** Opened on its own, or in a page that isn't the broker: it doesn't sign in here. */
  | { status: "elsewhere" }
  | { status: "connected"; backend: GitBackend; account: BrokerAccount; fetch: typeof fetch };

/** Sends the AI assistant's requests to the broker on `port`, which sends them on with its own keys. */
function brokerFetch(port: MessagePort): typeof fetch {
  const waiting = new Map<number, (answer: BrokerServiceAnswer) => void>();
  let next = 1;
  port.onmessage = (event) => {
    const answer = event.data as BrokerServiceAnswer | undefined;
    if (answer?.type === "ai") waiting.get(answer.id)?.(answer);
    if (answer) waiting.delete(answer.id);
  };
  return async (input, init) => {
    const request = new Request(input, init);
    if (!request.url.startsWith(`${BROKER_AI_ADDRESS}/`)) throw new TypeError("Only AI requests go to the broker.");
    const id = next++;
    const body = request.method === "GET" ? undefined : await request.arrayBuffer();
    const answer = await new Promise<BrokerServiceAnswer>((resolve, reject) => {
      waiting.set(id, resolve);
      request.signal.addEventListener("abort", () => {
        waiting.delete(id);
        reject(new DOMException("The request was stopped.", "AbortError"));
      });
      const message: BrokerServiceRequest = {
        type: "ai",
        id,
        path: request.url.slice(BROKER_AI_ADDRESS.length + 1),
        method: request.method,
        headers: [...request.headers.entries()],
        ...(body && { body }),
      };
      port.postMessage(message, body ? [body] : []);
    });
    return new Response(answer.body, { status: answer.status, headers: answer.headers });
  };
}

/**
 * Where a site has a token broker, the admin panel signs in to nothing itself:
 * it waits for the broker, which shows it in a frame, to give it a backend on a
 * port, and says where to open it when it's opened anywhere else. Renders its
 * children with that backend once the broker has connected.
 */
export function BrokerGate({
  broker,
  host,
  children,
}: {
  broker: BrokerAddress;
  /** The site's git host, whose sign-in kept here before the broker is forgotten. */
  host?: GitHost;
  children: (backend: GitBackend, account: BrokerAccount & { fetch: typeof fetch }) => ReactNode;
}) {
  const t = useStrings();
  const origin = brokerOrigin(broker);
  const [state, setState] = useState<GateState>({ status: "connecting" });

  useEffect(() => {
    // Tokens kept here from before the broker are within the site's pages' reach: forget them.
    void host
      ?.restore()
      .then((backend) => backend?.signOut())
      .catch(() => undefined);
  }, [host]);

  useEffect(() => {
    if (!origin || window.parent === window) {
      setState({ status: "elsewhere" });
      return;
    }
    let services: MessagePort | undefined;
    const onRoute = () => services?.postMessage({ type: "route", hash: location.hash } satisfies BrokerServiceRequest);
    const onMessage = (event: MessageEvent) => {
      // Only the broker, around this page, gives it a backend.
      if (event.source !== window.parent || event.origin !== origin) return;
      const data = event.data as { type?: unknown; account?: BrokerAccount } | null;
      if (data?.type !== BROKER_CONNECT_MESSAGE || !data.account || event.ports.length !== 2) return;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      const [backendPort, servicesPort] = event.ports as [MessagePort, MessagePort];
      services = servicesPort;
      const account = data.account;
      const fetch = brokerFetch(servicesPort);
      onRoute();
      window.addEventListener("hashchange", onRoute);
      void remoteBackend(backendPort).then((backend) => setState({ status: "connected", backend, account, fetch }));
    };
    const timer = setTimeout(() => setState({ status: "elsewhere" }), CONNECT_TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: BROKER_READY_MESSAGE }, origin);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      window.removeEventListener("hashchange", onRoute);
    };
  }, [origin]);

  if (state.status === "connecting") return <p className="gfa-screen">{t("signIn.checking")}</p>;
  if (state.status === "elsewhere") {
    return (
      <div className="gfa-sign-in">
        <h1>{t("signIn.title")}</h1>
        {origin ? (
          <>
            <p>{t("broker.elsewhere")}</p>
            <div>
              <a className="gfa-button gfa-button-primary" href={`${origin}/`}>
                {t("broker.open")}
              </a>
            </div>
          </>
        ) : (
          <ErrorMessage message={t("broker.invalid")} />
        )}
      </div>
    );
  }
  return children(state.backend, { ...state.account, fetch: state.fetch });
}
