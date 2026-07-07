import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { UsageBar } from "./UsageBar";

// Mock useVisiblePolling：只在 mount 時呼叫一次（模擬真實 hook 行為）。
// 不能在每次 render 都呼叫 fn()，否則 fetch→setState→re-render 會形成無限 microtask 迴圈。
vi.mock("../hooks/useVisiblePolling", async () => {
  const { useEffect } = await import("react");
  return {
    useVisiblePolling: (fn: () => void) => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      useEffect(() => { fn(); }, []);
    },
  };
});

const BASE_SUMMARY = {
  today: { date: "2026-07-06", costUSD: 0.05, inputTokens: 500, outputTokens: 200, turns: 3 },
  total: { costUSD: 1.2, turns: 50 },
  last7: [],
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("UsageBar", () => {
  it("沒有 bySource 時正常渲染（不拋錯）", async () => {
    // mockResolvedValue (not Once): StrictMode renders twice; both calls must return valid data
    vi.mocked(fetch).mockResolvedValue({
      json: () => Promise.resolve(BASE_SUMMARY),
    } as Response);
    render(<UsageBar />);
    await waitFor(() => expect(screen.getByText(/3/)).toBeTruthy());
  });

  it("bySource 空陣列時不顯示「近 7 天成本來源」", async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: () => Promise.resolve({ ...BASE_SUMMARY, bySource: [] }),
    } as Response);
    const { container } = render(<UsageBar />);
    await waitFor(() => expect(screen.getByText(/3/)).toBeTruthy());
    // Click to open
    const btn = container.querySelector("button");
    btn?.click();
    await waitFor(() => expect(screen.queryByText(/近 7 天成本來源/)).toBeNull());
  });
});

describe("UsageBar bySource 展開顯示", () => {
  it("bySource 有資料時展開後顯示來源標籤與成本", async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: () => Promise.resolve({
        ...BASE_SUMMARY,
        bySource: [
          { source: "research", costUSD: 0.5, turns: 3, inputTokens: 5000, outputTokens: 2000 },
          { source: "titler", costUSD: 0.01, turns: 10, inputTokens: 100, outputTokens: 50 },
        ],
      }),
    } as Response);
    const { container } = render(<UsageBar />);
    await waitFor(() => expect(screen.getByText(/3/)).toBeTruthy());
    // Open the dropdown
    const btn = container.querySelector("button");
    btn?.click();
    await waitFor(() => {
      expect(screen.getByText("近 7 天成本來源")).toBeTruthy();
      expect(screen.getByText("主題研究")).toBeTruthy();
      expect(screen.getByText("自動命名")).toBeTruthy();
    });
  });

  it("未知 source 顯示原始 source 名稱", async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: () => Promise.resolve({
        ...BASE_SUMMARY,
        bySource: [
          { source: "unknown_src", costUSD: 0.05, turns: 1, inputTokens: 10, outputTokens: 5 },
        ],
      }),
    } as Response);
    const { container } = render(<UsageBar />);
    await waitFor(() => expect(screen.getByText(/3/)).toBeTruthy());
    const btn = container.querySelector("button");
    btn?.click();
    await waitFor(() => expect(screen.getByText("unknown_src")).toBeTruthy());
  });
});
