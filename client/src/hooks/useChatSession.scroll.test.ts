import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../lib/socket", () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }),
  joinSession: vi.fn(),
  leaveSession: vi.fn(),
}));
vi.mock("../lib/notifications", () => ({ notify: vi.fn() }));

import { useChatSession } from "./useChatSession";

function fakeScroller() {
  return { scrollHeight: 5000, scrollTop: 0, clientHeight: 600, scrollTo: vi.fn() } as unknown as HTMLDivElement;
}

describe("useChatSession 捲動接線", () => {
  it("打開對話載入歷史後，停在最底部而不是最上面", () => {
    const { result } = renderHook(() => useChatSession("s1", "PM", undefined));
    const el = fakeScroller();
    (result.current.scrollerRef as { current: HTMLDivElement | null }).current = el;
    act(() => {
      result.current.setMessages([
        { role: "user", content: "a", ts: 1 },
        { role: "assistant", content: "b", ts: 2 },
      ]);
    });
    expect(el.scrollTop).toBe(5000);
  });

  it("第一次跳到底之後，往上翻時來新回覆不會被拉走", () => {
    const { result } = renderHook(() => useChatSession("s2", "PM", undefined));
    const el = fakeScroller();
    (result.current.scrollerRef as { current: HTMLDivElement | null }).current = el;
    act(() => { result.current.setMessages([{ role: "assistant", content: "x", ts: 1 }]); });
    el.scrollTop = 100; // 使用者往上翻
    act(() => { result.current.setMessages((p) => [...p, { role: "assistant", content: "y", ts: 2 }]); });
    expect(el.scrollTop).toBe(100);
    expect(el.scrollTo).not.toHaveBeenCalled();
  });
});
