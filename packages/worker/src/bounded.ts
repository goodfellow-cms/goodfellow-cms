/**
 * An answer's text, read no further than `limit` bytes: `undefined` for a
 * larger one, which is given up on there, so an address someone else chose
 * can't keep the worker reading.
 */
export async function boundedText(response: Response, limit: number): Promise<string | undefined> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    return undefined;
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let read = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    read += value.byteLength;
    if (read > limit) {
      await reader.cancel();
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
}
