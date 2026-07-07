import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DelegationsPanel } from "./DelegationsPanel";
import { api } from "../lib/api";

vi.mock("../lib/socket", () => ({ getSocket: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })) }));
vi.mock("../lib/workspace", () => ({ getActiveWorkspace: vi.fn().mockReturnValue("ws1") }));
// 只在 mount 時呼叫一次（模擬真實 hook 行為），避免每次 render 都觸發 fetch→setState 無限迴圈
vi.mock("../hooks/useVisiblePolling", async () => {
  const { useEffect } = await import("react");
  return {
    useVisiblePolling: (fn: () => void) => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      useEffect(() => { fn(); }, []);
    },
  };
});
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: { ...actual.api, listDelegations: vi.fn().mockResolvedValue([]) } };
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.mocked(api.listDelegations).mockResolvedValue([]);
});

describe("DelegationsPanel — 背景限流狀態", () => {
  it("限流器正常（無退避、無佇列）→ 不顯示任何限流提示", async () => {
    // mockResolvedValue (not Once): StrictMode renders twice; both calls must return valid data
    vi.mocked(fetch).mockResolvedValue({
      json: () => Promise.resolve({ running: 1, queued: 0, backoffUntil: 0, limit: 3 }),
    } as Response);
    render(<DelegationsPanel />);
    await waitFor(() => expect(screen.getByText(/在途交辦/)).toBeTruthy());
    // 有使用槽但無排隊 → 顯示槽使用資訊
    await waitFor(() => expect(screen.getByText(/背景槽 1\/3 使用中/)).toBeTruthy());
  });

  it("有排隊工作時顯示「排隊 N」", async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: () => Promise.resolve({ running: 3, queued: 2, backoffUntil: 0, limit: 3 }),
    } as Response);
    render(<DelegationsPanel />);
    await waitFor(() => expect(screen.getByText(/排隊 2/)).toBeTruthy());
  });

  it("退避中 → 顯示「⏸ 限流退避中」醒目文字", async () => {
    const future = Date.now() + 60_000; // 1 分鐘後
    vi.mocked(fetch).mockResolvedValue({
      json: () => Promise.resolve({ running: 0, queued: 0, backoffUntil: future, limit: 3 }),
    } as Response);
    render(<DelegationsPanel />);
    await waitFor(() => expect(screen.getByText(/⏸ 限流退避中/)).toBeTruthy());
  });

  it("limiter API 失敗時不崩潰（fetch rejected）", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network error"));
    render(<DelegationsPanel />);
    // 不應拋錯，面板正常渲染
    await waitFor(() => expect(screen.getByText(/在途交辦/)).toBeTruthy());
  });

  it("running=0 queued=0 backoffUntil=0 → 不顯示限流行", async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: () => Promise.resolve({ running: 0, queued: 0, backoffUntil: 0, limit: 3 }),
    } as Response);
    render(<DelegationsPanel />);
    await waitFor(() => expect(screen.getByText(/在途交辦/)).toBeTruthy());
    expect(screen.queryByText(/背景槽/)).toBeNull();
    expect(screen.queryByText(/限流退避/)).toBeNull();
  });
});
