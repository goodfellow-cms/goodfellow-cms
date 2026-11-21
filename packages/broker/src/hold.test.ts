import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANSWER_DELAY_MS, holdAnswers } from "./hold.js";

describe("holdAnswers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the answering buttons from working for a moment after the question opens", () => {
    const allow = { disabled: false };
    const target = new EventTarget();
    const stop = holdAnswers([allow], target);
    // A click 100 ms after the dialog opens lands on a button that's off.
    vi.advanceTimersByTime(100);
    expect(allow.disabled).toBe(true);
    vi.advanceTimersByTime(ANSWER_DELAY_MS - 100);
    expect(allow.disabled).toBe(false);
    stop();
  });

  it("holds them again when the window gets the focus back", () => {
    const allow = { disabled: false };
    const target = new EventTarget();
    const stop = holdAnswers([allow], target);
    vi.advanceTimersByTime(ANSWER_DELAY_MS);
    expect(allow.disabled).toBe(false);
    target.dispatchEvent(new Event("focus"));
    expect(allow.disabled).toBe(true);
    vi.advanceTimersByTime(ANSWER_DELAY_MS / 2);
    // Coming back again starts the wait again.
    target.dispatchEvent(new Event("pageshow"));
    vi.advanceTimersByTime(ANSWER_DELAY_MS / 2);
    expect(allow.disabled).toBe(true);
    vi.advanceTimersByTime(ANSWER_DELAY_MS / 2);
    expect(allow.disabled).toBe(false);
    stop();
    target.dispatchEvent(new Event("focus"));
    expect(allow.disabled).toBe(false);
  });
});
