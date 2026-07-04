import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useVisiblePolling } from "./useVisiblePolling";

/**
 * Tests for useVisiblePolling.
 * Uses fake timers and mocks document.visibilityState.
 */

describe("useVisiblePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Default: document is visible
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls fn immediately on mount", () => {
    const fn = vi.fn();
    renderHook(() => useVisiblePolling(fn, 1000));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("calls fn on each interval tick", () => {
    const fn = vi.fn();
    renderHook(() => useVisiblePolling(fn, 1000));
    expect(fn).toHaveBeenCalledTimes(1); // immediate call

    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("stops polling when document becomes hidden", () => {
    const fn = vi.fn();
    renderHook(() => useVisiblePolling(fn, 1000));
    expect(fn).toHaveBeenCalledTimes(1);

    // Simulate tab going to background
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Advance time — fn should NOT be called again
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("resumes and calls fn immediately when document becomes visible again", () => {
    const fn = vi.fn();
    renderHook(() => useVisiblePolling(fn, 1000));
    expect(fn).toHaveBeenCalledTimes(1);

    // Go hidden
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(1); // still 1

    // Come back visible — fn should fire immediately
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fn).toHaveBeenCalledTimes(2); // immediate call on resume

    // And continue polling
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("clears interval and event listener on unmount", () => {
    const fn = vi.fn();
    const { unmount } = renderHook(() => useVisiblePolling(fn, 1000));
    expect(fn).toHaveBeenCalledTimes(1);

    unmount();

    // After unmount, no more calls
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("always calls the latest fn reference without re-mounting", () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    let currentFn = fn1;

    const { rerender } = renderHook(() => useVisiblePolling(currentFn, 1000));
    expect(fn1).toHaveBeenCalledTimes(1);

    // Switch fn reference between renders
    currentFn = fn2;
    rerender();

    // Next tick should call fn2, not fn1
    vi.advanceTimersByTime(1000);
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(fn1).toHaveBeenCalledTimes(1); // not called again
  });
});
