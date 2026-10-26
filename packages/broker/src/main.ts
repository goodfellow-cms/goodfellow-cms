import "./broker.css";
import { type BrokerConfig, startBroker } from "./broker.js";

const root = document.getElementById("broker") as HTMLElement;
const config = await fetch("./broker.json", { cache: "no-store" })
  .then((response) => (response.ok ? (response.json() as Promise<BrokerConfig>) : undefined))
  .catch(() => undefined);

await startBroker({
  root,
  config,
  hosts: {
    "@goodfellow-cms/bitbucket": () => import("@goodfellow-cms/bitbucket"),
    "@goodfellow-cms/github": () => import("@goodfellow-cms/github"),
    "@goodfellow-cms/gitlab": () => import("@goodfellow-cms/gitlab"),
  },
});
