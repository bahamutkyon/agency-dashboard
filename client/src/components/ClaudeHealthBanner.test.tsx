import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ClaudeHealthBanner } from "./ClaudeHealthBanner";

// useVisiblePolling：只在 mount 時呼叫一次（同 UsageBar.test 的作法，避免 render 迴圈）。
vi.mock("../hooks/useVisiblePolling", async () => {
  const { useEffect } = await import("react");
  return {
    useVisiblePolling: (fn: () => void) => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      useEffect(() => { fn(); }, []);
    },
  };
});

const FAILED = {
  status: "auth_failed",
  since: 1_760_000_000_000,
  lastOkAt: null,
  lastErrorAt: 1_760_000_100_000,
  lastError: "Failed to authenticate: OAuth session expired and could not be refreshed",
  failures: 12,
  remedy: "修復（擇一）：\n① 開終端機執行 claude，輸入 /login 重新登入",
  lastProbe: null,
};
const OK = { ...FAILED, status: "ok", failures: 0, remedy: null, lastError: null };

function mockFetch(byUrl: Record<string, unknown>) {
  vi.mocked(fetch).mockImplementation(async (input: any) => {
    const url = String(input);
    const key = Object.keys(byUrl).find((k) => url.includes(k));
    return { ok: true, status: 200, json: () => Promise.resolve(key ? byUrl[key] : {}), text: () => Promise.resolve("") } as Response;
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("ClaudeHealthBanner", () => {
  it("狀態正常 → 不顯示任何東西", async () => {
    mockFetch({ "/api/system/claude-health": OK });
    const { container } = render(<ClaudeHealthBanner />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("登入失效 → 顯示紅色橫幅、修復步驟與錯誤原文", async () => {
    mockFetch({ "/api/system/claude-health": FAILED });
    render(<ClaudeHealthBanner />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/登入已失效/)).toBeTruthy();
    expect(screen.getByText(/\/login/)).toBeTruthy();
    expect(screen.getByText(/OAuth session expired/)).toBeTruthy();
    expect(screen.getByText(/已失敗 12 次/)).toBeTruthy();
  });

  it("按「重新檢查」→ 打探測端點；恢復時改顯示綠色確認", async () => {
    mockFetch({ "/api/system/claude-health/probe": OK, "/api/system/claude-health": FAILED });
    render(<ClaudeHealthBanner />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    fireEvent.click(screen.getByText("重新檢查"));
    await waitFor(() => expect(screen.getByText(/登入已恢復/)).toBeTruthy());
    const probeCall = vi.mocked(fetch).mock.calls.find(([u]) => String(u).includes("/probe"));
    expect(probeCall?.[1]).toMatchObject({ method: "POST" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("按 × → 這次失效期間不再顯示", async () => {
    mockFetch({ "/api/system/claude-health": FAILED });
    render(<ClaudeHealthBanner />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("暫時關閉登入失效提示"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
