/**
 * How long a question's answering buttons wait before they work, after the dialog opens and again whenever the window
 * comes back: the admin panel's frame decides when a question appears, so a click it asked for at the right moment
 * could otherwise land on Publish or Allow before the person has read anything, as browsers' own permission prompts
 * also guard against.
 */
export const ANSWER_DELAY_MS = 1000;

/** What `holdAnswers()` holds: buttons it can turn off and on. */
export interface Holdable {
  disabled: boolean;
}

/**
 * Turns `buttons` off for `ANSWER_DELAY_MS`, now and each time `window` gets the focus back or its page shows again,
 * so a click already on its way does nothing. Returns a function that stops listening.
 */
export function holdAnswers(
  buttons: readonly Holdable[],
  window: Pick<EventTarget, "addEventListener" | "removeEventListener">,
  timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } = globalThis,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hold = () => {
    for (const button of buttons) button.disabled = true;
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      timer = undefined;
      for (const button of buttons) button.disabled = false;
    }, ANSWER_DELAY_MS);
  };
  hold();
  window.addEventListener("focus", hold);
  window.addEventListener("pageshow", hold);
  return () => {
    if (timer !== undefined) timers.clearTimeout(timer);
    window.removeEventListener("focus", hold);
    window.removeEventListener("pageshow", hold);
  };
}
