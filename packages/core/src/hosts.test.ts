import { describe, expect, it } from "vitest";
import { isLoopbackHost, isPrivateHost, type RemoteFetch, readRemoteText } from "./hosts.js";

const host = (address: string) => new URL(address).hostname;

describe("isLoopbackHost", () => {
  it("knows this computer however its address is spelled", () => {
    for (const address of [
      "https://localhost/",
      "https://localhost./",
      "https://admin.localhost/",
      "https://127.0.0.1/",
      "https://127.1/",
      "https://0x7f.1/",
      "https://2130706433/",
      "https://0.0.0.0/",
      "https://[::1]/",
      "https://[::ffff:127.0.0.1]/",
      "https://[::ffff:7f00:1]/",
    ]) {
      expect(isLoopbackHost(host(address)), address).toBe(true);
    }
    expect(isLoopbackHost(host("https://example.org/"))).toBe(false);
    expect(isLoopbackHost(host("https://localhost.example.org/"))).toBe(false);
  });
});

describe("isPrivateHost", () => {
  it("knows private networks' addresses, and other sites' aren't", () => {
    for (const address of [
      "https://10.0.0.1/",
      "https://172.16.0.1/",
      "https://172.31.255.255/",
      "https://192.168.1.1/",
      "https://169.254.169.254/",
      "https://100.64.0.1/",
      "https://[fd00::1]/",
      "https://[fe80::1]/",
      "https://[::ffff:a00:1]/",
    ]) {
      expect(isPrivateHost(host(address)), address).toBe(true);
    }
    for (const address of [
      "https://172.32.0.1/",
      "https://8.8.8.8/",
      "https://[2001:db8::1]/",
      "https://fd.example/",
    ]) {
      expect(isPrivateHost(host(address)), address).toBe(false);
    }
  });
});

describe("readRemoteText", () => {
  const answer = (status: number, body = "", headers: Record<string, string> = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    body: {
      getReader() {
        const chunks = body ? [new TextEncoder().encode(body)] : [];
        return { read: async () => ({ done: chunks.length === 0, value: chunks.shift() }), cancel: async () => {} };
      },
    },
  });
  const options = (fetch: RemoteFetch) => ({ what: "feed", accept: "text/xml", limit: 10, fetch });

  it("reads another site's file, following its redirects", async () => {
    const asked: string[] = [];
    const fetch: RemoteFetch = async (url) => {
      asked.push(url);
      return url.endsWith("/old") ? answer(301, "", { location: "/new" }) : answer(200, "<rss/>");
    };
    expect(await readRemoteText("https://example.org/old", options(fetch))).toBe("<rss/>");
    expect(asked).toEqual(["https://example.org/old", "https://example.org/new"]);
  });

  it("never reads this computer, a private network, or anything but https://, redirected there or not", async () => {
    const fetch: RemoteFetch = async (url) =>
      url.endsWith("/away") ? answer(302, "", { location: "http://169.254.169.254/latest" }) : answer(200, "x");
    await expect(readRemoteText("http://example.org/", options(fetch))).rejects.toThrow(/https:\/\//);
    await expect(readRemoteText("https://127.0.0.1/", options(fetch))).rejects.toThrow(/private network/);
    await expect(readRemoteText("https://[::ffff:7f00:1]/", options(fetch))).rejects.toThrow(/private network/);
    await expect(readRemoteText("https://example.org/away", options(fetch))).rejects.toThrow(/https:\/\//);
    const looping: RemoteFetch = async () => answer(302, "", { location: "/again" });
    await expect(readRemoteText("https://example.org/", options(looping))).rejects.toThrow(/too often/);
  });

  it("stops reading past its limit", async () => {
    const fetch: RemoteFetch = async () => answer(200, "x".repeat(11));
    await expect(readRemoteText("https://example.org/", options(fetch))).rejects.toThrow(/too large/);
    const said: RemoteFetch = async () => answer(200, "x", { "content-length": "11" });
    await expect(readRemoteText("https://example.org/", options(said))).rejects.toThrow(/too large/);
  });
});
