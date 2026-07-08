import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { GoalsPanel } from "./GoalsPanel";
import { api } from "../lib/api";

vi.mock("../lib/workspace", () => ({ getActiveWorkspace: vi.fn().mockReturnValue("ws1") }));
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
  return { ...actual, api: { ...actual.api, goals: vi.fn().mockResolvedValue([]) } };
});

beforeEach(() => {
  vi.mocked(api.goals).mockResolvedValue([]);
});

describe("GoalsPanel", () => {
  it("標題「🎯 目標帳本」存在", async () => {
    render(<GoalsPanel />);
    await waitFor(() => expect(screen.getByText(/目標帳本/)).toBeTruthy());
  });

  it("無目標時顯示空狀態提示", async () => {
    vi.mocked(api.goals).mockResolvedValue([]);
    render(<GoalsPanel />);
    await waitFor(() => expect(screen.getByText(/沒有進行中的目標/)).toBeTruthy());
  });

  it("有 active 目標時渲染標題與指標", async () => {
    vi.mocked(api.goals).mockResolvedValue([
      {
        id: "goal_test_1",
        workspaceId: "ws1",
        title: "露天月銷 3 台 Hairball",
        metric: "本月成交台數",
        currentValue: "1 台",
        targetValue: "3 台",
        deadline: "2026-07-31",
        status: "active",
        note: "",
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]);
    render(<GoalsPanel />);
    await waitFor(() => expect(screen.getByText(/露天月銷 3 台 Hairball/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/本月成交台數/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/1 台/)).toBeTruthy());
  });

  it("api.goals 失敗時不崩潰，顯示錯誤訊息", async () => {
    vi.mocked(api.goals).mockRejectedValue(new Error("network error"));
    render(<GoalsPanel />);
    await waitFor(() => expect(screen.getByText(/network error/)).toBeTruthy());
  });

  it("+ 新增按鈕點擊後顯示建立表單", async () => {
    const { getByText } = render(<GoalsPanel />);
    await waitFor(() => getByText(/目標帳本/));
    getByText(/\+ 新增/, { selector: "button" }).click();
    await waitFor(() => expect(screen.getByText(/新增目標/)).toBeTruthy());
  });
});
