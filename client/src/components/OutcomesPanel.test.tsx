import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { OutcomesPanel } from "./OutcomesPanel";
import { api, type OutcomeCheck } from "../lib/api";

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
  return { ...actual, api: { ...actual.api, outcomes: vi.fn().mockResolvedValue([]) } };
});

function mk(partial: Partial<OutcomeCheck>): OutcomeCheck {
  return {
    id: "oc_1", workspaceId: "ws1", delegationId: "", goalId: "",
    description: "露天 Hairball 那檔有沒有詢問/成交", dueAt: 1_800_000_000_000,
    status: "pending", result: "", createdAt: 1000, updatedAt: 1000, ...partial,
  };
}

beforeEach(() => {
  vi.mocked(api.outcomes).mockResolvedValue([]);
});

describe("OutcomesPanel", () => {
  it("標題「📈 成效回訪」存在", async () => {
    render(<OutcomesPanel />);
    await waitFor(() => expect(screen.getByText(/成效回訪/)).toBeTruthy());
  });

  it("無回訪時顯示空狀態提示", async () => {
    vi.mocked(api.outcomes).mockResolvedValue([]);
    render(<OutcomesPanel />);
    await waitFor(() => expect(screen.getByText(/沒有待回訪的項目/)).toBeTruthy());
  });

  it("有 open 回訪時渲染描述", async () => {
    // pending 給空，notified 給一筆，done 給空
    vi.mocked(api.outcomes).mockImplementation(async (opts) => {
      if (opts?.status === "notified") return [mk({ id: "oc_n", status: "notified" })];
      return [];
    });
    render(<OutcomesPanel />);
    await waitFor(() => expect(screen.getByText(/露天 Hairball 那檔有沒有詢問\/成交/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/待你填結果/)).toBeTruthy());
  });

  it("api.outcomes 失敗時不崩潰，顯示錯誤訊息", async () => {
    vi.mocked(api.outcomes).mockRejectedValue(new Error("network error"));
    render(<OutcomesPanel />);
    await waitFor(() => expect(screen.getByText(/network error/)).toBeTruthy());
  });

  it("+ 新增按鈕點擊後顯示建立表單", async () => {
    const { getByText } = render(<OutcomesPanel />);
    await waitFor(() => getByText(/成效回訪/));
    getByText(/\+ 新增/, { selector: "button" }).click();
    await waitFor(() => expect(screen.getByText(/新增回訪/)).toBeTruthy());
  });
});
