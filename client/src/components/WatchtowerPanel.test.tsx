/**
 * WatchtowerPanel 測試（TDD）
 *
 * 覆蓋：
 *  1. 列出任務（mock api.watchtowerTasks）
 *  2. 新增任務打對端點（api.createWatchtowerTask）
 *  3. 切 enable 開關呼叫 api.updateWatchtowerTask
 *  4. 展開日誌呼叫 api.watchtowerLogs
 *  5. run-now 打對端點 api.watchtowerRunNow
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { WatchtowerPanel } from "./WatchtowerPanel";
import { api } from "../lib/api";
import type { WatchtowerTask, WatchtowerLog } from "../lib/api";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("../lib/workspace", () => ({ getActiveWorkspace: vi.fn().mockReturnValue("ws1") }));
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      watchtowerTasks: vi.fn(),
      createWatchtowerTask: vi.fn(),
      updateWatchtowerTask: vi.fn(),
      deleteWatchtowerTask: vi.fn(),
      watchtowerLogs: vi.fn(),
      watchtowerRunNow: vi.fn(),
    },
  };
});

// ─── 測試資料 ─────────────────────────────────────────────────────────────────

const TASK_1: WatchtowerTask = {
  id: "wt_001",
  workspaceId: "ws1",
  name: "行銷週報監控",
  cron: "0 9 * * 1",
  enabled: 1,
  quietHours: "22-8",
  dailyQuota: 3,
  lastFiredAt: Date.now() - 3600_000,
  lastConclusion: "act",
  createdAt: Date.now() - 86400_000,
  updatedAt: Date.now() - 3600_000,
};

const TASK_2: WatchtowerTask = {
  id: "wt_002",
  workspaceId: "ws1",
  name: "財報追蹤",
  cron: "0 10 * * *",
  enabled: 0,
  quietHours: "",
  dailyQuota: 2,
  lastFiredAt: null,
  lastConclusion: null,
  createdAt: Date.now() - 43200_000,
  updatedAt: Date.now() - 43200_000,
};

const LOG_1: WatchtowerLog = {
  id: "wtl_001",
  taskId: "wt_001",
  workspaceId: "ws1",
  firedAt: Date.now() - 3600_000,
  decision: "act",
  reason: "目標低於 90%，觸發改善分析",
  runId: "run_abc123",
  createdAt: Date.now() - 3600_000,
};

// ─── 幫助函式 ────────────────────────────────────────────────────────────────

function setupDefaultMocks() {
  vi.mocked(api.watchtowerTasks).mockResolvedValue({ tasks: [TASK_1, TASK_2] });
  vi.mocked(api.createWatchtowerTask).mockResolvedValue({ task: { ...TASK_1, id: "wt_new" } });
  vi.mocked(api.updateWatchtowerTask).mockResolvedValue({ task: { ...TASK_1, enabled: 0 } });
  vi.mocked(api.deleteWatchtowerTask).mockResolvedValue({ ok: true });
  vi.mocked(api.watchtowerLogs).mockResolvedValue({ logs: [LOG_1] });
  vi.mocked(api.watchtowerRunNow).mockResolvedValue({ decision: "act", reason: "成功觸發" });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupDefaultMocks();
});

// ─── 測試群組 ────────────────────────────────────────────────────────────────

describe("WatchtowerPanel — 列出任務", () => {
  it("渲染標題和兩個任務", async () => {
    render(<WatchtowerPanel />);
    await waitFor(() => expect(screen.getByText(/行銷週報監控/)).toBeTruthy());
    expect(screen.getByText(/財報追蹤/)).toBeTruthy();
    expect(screen.getByText(/常駐看守/)).toBeTruthy();
  });

  it("載入時呼叫 watchtowerTasks 帶正確 workspace", async () => {
    render(<WatchtowerPanel />);
    await waitFor(() => expect(vi.mocked(api.watchtowerTasks)).toHaveBeenCalledWith("ws1"));
  });

  it("空清單時顯示空狀態提示", async () => {
    vi.mocked(api.watchtowerTasks).mockResolvedValue({ tasks: [] });
    render(<WatchtowerPanel />);
    await waitFor(() => expect(screen.getByText(/還沒有看守任務/)).toBeTruthy());
  });

  it("顯示任務 cron 表達式", async () => {
    render(<WatchtowerPanel />);
    await waitFor(() => expect(screen.getByText("0 9 * * 1")).toBeTruthy());
  });
});

describe("WatchtowerPanel — 新增任務", () => {
  it("點「新增」顯示表單", async () => {
    render(<WatchtowerPanel />);
    await waitFor(() => expect(screen.getByText(/行銷週報監控/)).toBeTruthy());
    fireEvent.click(screen.getByText(/新增看守任務/));
    expect(screen.getByPlaceholderText(/例如：監控行銷目標/)).toBeTruthy();
  });

  it("填表並送出呼叫 createWatchtowerTask 帶正確參數", async () => {
    render(<WatchtowerPanel />);
    await waitFor(() => expect(screen.getByText(/行銷週報監控/)).toBeTruthy());
    fireEvent.click(screen.getByText(/新增看守任務/));

    fireEvent.change(screen.getByPlaceholderText(/例如：監控行銷目標/), {
      target: { value: "新任務 A" },
    });
    fireEvent.change(screen.getByPlaceholderText(/0 9 \* \* \*/), {
      target: { value: "30 8 * * *" },
    });

    // 點「建立任務」
    fireEvent.click(screen.getByRole("button", { name: /建立任務/ }));

    await waitFor(() =>
      expect(vi.mocked(api.createWatchtowerTask)).toHaveBeenCalledWith(
        "ws1",
        expect.objectContaining({ name: "新任務 A", cron: "30 8 * * *" }),
      )
    );
  });

  it("送出空名稱時顯示錯誤，不呼叫 API", async () => {
    render(<WatchtowerPanel />);
    await waitFor(() => expect(screen.getByText(/行銷週報監控/)).toBeTruthy());
    fireEvent.click(screen.getByText(/新增看守任務/));

    // 清空 name 欄位（預設是空的），直接送出
    fireEvent.click(screen.getByRole("button", { name: /建立任務/ }));
    await waitFor(() => expect(screen.getByText(/請輸入任務名稱/)).toBeTruthy());
    expect(vi.mocked(api.createWatchtowerTask)).not.toHaveBeenCalled();
  });
});

describe("WatchtowerPanel — 啟用/停用切換", () => {
  it("點啟用開關呼叫 updateWatchtowerTask 帶 enabled 反轉", async () => {
    render(<WatchtowerPanel />);
    await waitFor(() => expect(screen.getByText(/行銷週報監控/)).toBeTruthy());

    // TASK_1 enabled=1，點停用
    const toggleBtns = screen.getAllByRole("button", { name: /停用|啟用/ });
    fireEvent.click(toggleBtns[0]); // 第一個任務（TASK_1 enabled）

    await waitFor(() =>
      expect(vi.mocked(api.updateWatchtowerTask)).toHaveBeenCalledWith(
        "wt_001",
        "ws1",
        { enabled: false }, // 反轉
      )
    );
  });
});

describe("WatchtowerPanel — 日誌時間軸", () => {
  it("點「日誌」展開後呼叫 watchtowerLogs 並顯示 decision 色標", async () => {
    render(<WatchtowerPanel />);
    await waitFor(() => expect(screen.getByText(/行銷週報監控/)).toBeTruthy());

    const logBtns = screen.getAllByRole("button", { name: /日誌/ });
    fireEvent.click(logBtns[0]);

    await waitFor(() =>
      expect(vi.mocked(api.watchtowerLogs)).toHaveBeenCalledWith("wt_001", "ws1", 30)
    );
    await waitFor(() => expect(screen.getByText(/目標低於 90%/)).toBeTruthy());
    // decision chip（可能出現在 lastConclusion badge 和 log chip 兩處，用 getAllByText）
    expect(screen.getAllByText(/^執行$/).length).toBeGreaterThan(0);
  });

  it("日誌顯示 runId 縮略", async () => {
    render(<WatchtowerPanel />);
    await waitFor(() => expect(screen.getByText(/行銷週報監控/)).toBeTruthy());

    const logBtns = screen.getAllByRole("button", { name: /日誌/ });
    fireEvent.click(logBtns[0]);

    await waitFor(() => expect(screen.getByText(/#run_abc1/)).toBeTruthy());
  });
});

describe("WatchtowerPanel — 立即執行", () => {
  it("點「立即」按鈕呼叫 watchtowerRunNow 帶正確 id 和 workspace", async () => {
    render(<WatchtowerPanel />);
    await waitFor(() => expect(screen.getByText(/行銷週報監控/)).toBeTruthy());

    const runBtns = screen.getAllByRole("button", { name: /立即/ });
    await act(async () => {
      fireEvent.click(runBtns[0]);
    });

    await waitFor(() =>
      expect(vi.mocked(api.watchtowerRunNow)).toHaveBeenCalledWith("wt_001", "ws1", false)
    );
  });

  it("run-now 回傳 decision=act 後顯示執行結果", async () => {
    render(<WatchtowerPanel />);
    await waitFor(() => expect(screen.getByText(/行銷週報監控/)).toBeTruthy());

    const runBtns = screen.getAllByRole("button", { name: /立即/ });
    await act(async () => {
      fireEvent.click(runBtns[0]);
    });

    await waitFor(() => expect(screen.getByText(/成功觸發/)).toBeTruthy());
  });
});
