import { describe, expect, it } from "vitest";
import { boundedText } from "./bounded.js";
import { MAX_REMEMBERED, remember } from "./worker.js";

/** An answer streamed in pieces with no length given, as an address someone else chose might send. */
function streamed(pieces: string[]): Response {
  const encoder = new TextEncoder();
  let sent = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        const piece = pieces[sent++];
        if (piece === undefined) controller.close();
        else controller.enqueue(encoder.encode(piece));
      },
    }),
  );
}

describe("boundedText", () => {
  it("reads an answer up to its limit, and gives up on a larger one without reading the rest", async () => {
    expect(await boundedText(streamed(["{", '"a":1', "}"]), 100)).toBe('{"a":1}');
    const pieces = Array.from({ length: 1000 }, () => "x".repeat(100));
    const response = streamed(pieces);
    expect(await boundedText(response, 1_000)).toBeUndefined();
    expect(await boundedText(new Response("x".repeat(10), { headers: { "content-length": "10" } }), 5)).toBeUndefined();
  });
});

describe("remember", () => {
  it("forgets what it remembered longest ago past its limit", () => {
    const map = new Map<number, number>();
    for (let key = 0; key < MAX_REMEMBERED + 5; key++) remember(map, key, key);
    expect(map.size).toBe(MAX_REMEMBERED);
    expect(map.has(0)).toBe(false);
    expect(map.has(MAX_REMEMBERED + 4)).toBe(true);
  });
});
