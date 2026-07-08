import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { NotesPanel } from "./NotesPanel";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";

vi.mock("../lib/socket", () => ({ getSocket: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })) }));
vi.mock("../lib/workspace", () => ({ getActiveWorkspace: vi.fn().mockReturnValue("ws1") }));
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      notes: vi.fn().mockResolvedValue([]),
      startResearch: vi.fn().mockResolvedValue({ runId: "run_test_01" }),
      getResearchRun: vi.fn(),
    },
  };
});

const RUNNING_RUN = {
  id: "run_test_01", workspaceId: "ws1", question: "台灣 AI",
  status: "running" as const, stage: "researching", total: 3, done: 1,
};

beforeEach(() => {
  vi.mocked(api.notes).mockResolvedValue([]);
  vi.mocked(api.startResearch).mockResolvedValue({ runId: "run_test_01" });
  vi.mocked(api.getResearchRun).mockResolvedValue({ ...RUNNING_RUN });
  // 每次測試重設 socket mock，避免測試間污染
  vi.mocked(getSocket).mockImplementation(() => ({ on: vi.fn(), off: vi.fn() } as any));
});

describe("NotesPanel — 🔬 深入研究區塊", () => {
  it("研究輸入框和送出按鈕可見", async () => {
    render(<NotesPanel />);
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/輸入研究主題/)).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: /深入研究/ })).toBeTruthy();
  });

  it("送出空白問題不呼叫 API", async () => {
    render(<NotesPanel />);
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/輸入研究主題/)).toBeTruthy(),
    );
    // 空白 → 不觸發
    fireEvent.click(screen.getByRole("button", { name: /深入研究/ }));
    expect(vi.mocked(api.startResearch)).not.toHaveBeenCalled();
  });

  it("送出有效問題後呼叫 api.startResearch 帶問題和 workspace", async () => {
    render(<NotesPanel />);
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/輸入研究主題/)).toBeTruthy(),
    );
    fireEvent.change(screen.getByPlaceholderText(/輸入研究主題/), {
      target: { value: "台灣 AI 產業前景" },
    });
    fireEvent.click(screen.getByRole("button", { name: /深入研究/ }));
    await waitFor(() =>
      expect(vi.mocked(api.startResearch)).toHaveBeenCalledWith("台灣 AI 產業前景", "ws1"),
    );
  });

  it("research:progress 事件（stage=researching）更新進度顯示", async () => {
    let capturedHandler: ((p: any) => void) | undefined;
    const mockOn = vi.fn((event: string, handler: any) => {
      if (event === "research:progress") capturedHandler = handler;
    });
    vi.mocked(getSocket).mockReturnValue({ on: mockOn, off: vi.fn() } as any);

    render(<NotesPanel />);
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/輸入研究主題/)).toBeTruthy(),
    );

    fireEvent.change(screen.getByPlaceholderText(/輸入研究主題/), {
      target: { value: "台灣 AI" },
    });
    fireEvent.click(screen.getByRole("button", { name: /深入研究/ }));
    await waitFor(() => expect(vi.mocked(api.startResearch)).toHaveBeenCalled());

    act(() =>
      capturedHandler!({
        runId: "run_test_01",
        status: "running",
        stage: "researching",
        total: 3,
        done: 1,
      }),
    );
    await waitFor(() => expect(screen.getByText(/研究中 1\/3/)).toBeTruthy());
  });

  it("status=done 後刷新 notes 清單並顯示完成提示", async () => {
    let capturedHandler: ((p: any) => void) | undefined;
    const mockOn = vi.fn((event: string, handler: any) => {
      if (event === "research:progress") capturedHandler = handler;
    });
    vi.mocked(getSocket).mockReturnValue({ on: mockOn, off: vi.fn() } as any);

    render(<NotesPanel />);
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/輸入研究主題/)).toBeTruthy(),
    );

    fireEvent.change(screen.getByPlaceholderText(/輸入研究主題/), {
      target: { value: "台灣 AI" },
    });
    fireEvent.click(screen.getByRole("button", { name: /深入研究/ }));
    await waitFor(() => expect(vi.mocked(api.startResearch)).toHaveBeenCalled());

    const callsBefore = vi.mocked(api.notes).mock.calls.length;

    act(() =>
      capturedHandler!({
        runId: "run_test_01",
        status: "done",
        stage: "done",
        total: 2,
        done: 2,
      }),
    );

    await waitFor(() =>
      expect(vi.mocked(api.notes).mock.calls.length).toBeGreaterThan(callsBefore),
    );
    await waitFor(() => expect(screen.getByText(/研究完成/)).toBeTruthy());
  });

  it("status=error 後顯示失敗提示不崩潰", async () => {
    let capturedHandler: ((p: any) => void) | undefined;
    const mockOn = vi.fn((event: string, handler: any) => {
      if (event === "research:progress") capturedHandler = handler;
    });
    vi.mocked(getSocket).mockReturnValue({ on: mockOn, off: vi.fn() } as any);

    render(<NotesPanel />);
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/輸入研究主題/)).toBeTruthy(),
    );

    fireEvent.change(screen.getByPlaceholderText(/輸入研究主題/), {
      target: { value: "台灣 AI" },
    });
    fireEvent.click(screen.getByRole("button", { name: /深入研究/ }));
    await waitFor(() => expect(vi.mocked(api.startResearch)).toHaveBeenCalled());

    act(() =>
      capturedHandler!({
        runId: "run_test_01",
        status: "error",
        stage: "error",
        total: 2,
        done: 0,
      }),
    );

    await waitFor(() => expect(screen.getByText(/研究失敗/)).toBeTruthy());
  });

  it("runId 不匹配的 socket 事件被忽略，不顯示其他 run 的進度", async () => {
    let capturedHandler: ((p: any) => void) | undefined;
    const mockOn = vi.fn((event: string, handler: any) => {
      if (event === "research:progress") capturedHandler = handler;
    });
    vi.mocked(getSocket).mockReturnValue({ on: mockOn, off: vi.fn() } as any);

    render(<NotesPanel />);
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/輸入研究主題/)).toBeTruthy(),
    );

    fireEvent.change(screen.getByPlaceholderText(/輸入研究主題/), {
      target: { value: "台灣 AI" },
    });
    fireEvent.click(screen.getByRole("button", { name: /深入研究/ }));
    await waitFor(() => expect(vi.mocked(api.startResearch)).toHaveBeenCalled());

    // 其他 run 的事件，不應影響目前 run
    act(() =>
      capturedHandler!({
        runId: "run_other_99",
        status: "done",
        stage: "done",
        total: 2,
        done: 2,
      }),
    );

    // 給 React 一點時間 settle
    await new Promise((r) => setTimeout(r, 50));
    // 不應顯示完成提示（因為 runId 不符）
    expect(screen.queryByText(/研究完成/)).toBeNull();
  });
});

describe("NotesPanel — 進度輪詢兜底（R5）", () => {
  // 送出研究並進入 running 狀態的共用步驟（fake timers 下 flush 各 promise）。
  async function submitAndRun() {
    render(<NotesPanel />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); }); // flush 初始 notes()
    fireEvent.change(screen.getByPlaceholderText(/輸入研究主題/), { target: { value: "台灣 AI" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /深入研究/ }));
      await vi.advanceTimersByTimeAsync(0); // flush startResearch → status=running
    });
  }

  it("running 期間每 8 秒輪詢 getResearchRun 兜底", async () => {
    vi.useFakeTimers();
    try {
      await submitAndRun();
      expect(vi.mocked(api.startResearch)).toHaveBeenCalled();
      expect(vi.mocked(api.getResearchRun)).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
      expect(vi.mocked(api.getResearchRun)).toHaveBeenCalledWith("run_test_01");
    } finally {
      vi.useRealTimers();
    }
  });

  it("輪詢查無此 run（reject）→ 顯示「進度未知」並解鎖表單", async () => {
    vi.useFakeTimers();
    vi.mocked(api.getResearchRun).mockRejectedValue(new Error("404"));
    try {
      await submitAndRun();
      // running 期間表單禁用
      expect((screen.getByPlaceholderText(/輸入研究主題/) as HTMLInputElement).disabled).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
      // unknown → 解鎖 + 顯示提示
      expect((screen.getByPlaceholderText(/輸入研究主題/) as HTMLInputElement).disabled).toBe(false);
      expect(screen.getByText(/進度未知/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("輪詢收到 done → 刷新 notes 並收斂（停止輪詢）", async () => {
    vi.useFakeTimers();
    vi.mocked(api.getResearchRun).mockResolvedValue({
      ...RUNNING_RUN, status: "done", stage: "done", done: 3,
    });
    try {
      await submitAndRun();
      const before = vi.mocked(api.notes).mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
      expect(vi.mocked(api.notes).mock.calls.length).toBeGreaterThan(before);
      const afterDone = vi.mocked(api.getResearchRun).mock.calls.length;
      // done 後不再輪詢
      await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
      expect(vi.mocked(api.getResearchRun).mock.calls.length).toBe(afterDone);
    } finally {
      vi.useRealTimers();
    }
  });

  it("unmount 清 interval，不再輪詢", async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<NotesPanel />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      fireEvent.change(screen.getByPlaceholderText(/輸入研究主題/), { target: { value: "台灣 AI" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /深入研究/ }));
        await vi.advanceTimersByTimeAsync(0);
      });
      const before = vi.mocked(api.getResearchRun).mock.calls.length; // 尚未到 8s，應為 0
      unmount();
      await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
      // interval 已隨 unmount 清除 → 不再輪詢
      expect(vi.mocked(api.getResearchRun).mock.calls.length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
