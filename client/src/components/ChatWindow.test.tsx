/**
 * ChatWindow 測試 — 聚焦 AutorunApprovalCard 掛載（G1）
 *
 * ChatWindow 依賴大量 hooks 與 socket，採用完整 mock 策略。
 * 重點驗證：
 *  1. autorunPending 有值時 AutorunApprovalCard 渲染
 *  2. 按確認呼叫 confirmAutorun
 *  3. 按取消呼叫 dismissAutorun
 *  4. autorunPending=null 時不渲染卡片
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ChatWindow } from "./ChatWindow";
import { getSocket, onReconnect } from "../lib/socket";
import { api } from "../lib/api";
import { useChatSession } from "../hooks/useChatSession";
import { HANDOFF_REQUEST_TEXT } from "../lib/handoffNudge";

// ─── Mock 所有外部依賴 ────────────────────────────────────────────────────────

vi.mock("../lib/socket", () => ({
  onReconnect: vi.fn(() => () => {}),
  getSocket: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  })),
}));

vi.mock("../lib/workspace", () => ({
  getActiveWorkspace: vi.fn().mockReturnValue("ws1"),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      session: vi.fn().mockResolvedValue({ messages: [], tags: [], status: "idle" }),
      autonomyRun: vi.fn().mockResolvedValue({ run: null }),
      autonomyPending: vi.fn().mockResolvedValue({ pending: [] }),
      notes: vi.fn().mockResolvedValue([]),
      templates: vi.fn().mockResolvedValue([]),
      tags: vi.fn().mockResolvedValue([]),
      summarize: vi.fn().mockResolvedValue({ summary: "" }),
      listProjects: vi.fn().mockResolvedValue({ projects: [] }),
      sessionHandoff: vi.fn().mockResolvedValue({ handoff: null, handedOffTo: null }),
    },
    onUnauthorized: vi.fn().mockReturnValue(() => {}),
  };
});

// mock useAutonomy 讓我們可以注入 autorunPending
const mockUseAutonomy = vi.fn();
vi.mock("../hooks/useAutonomy", () => ({
  useAutonomy: (...args: any[]) => mockUseAutonomy(...args),
}));

vi.mock("../hooks/useChatSession", () => ({
  useChatSession: vi.fn().mockReturnValue({
    messages: [],
    setMessages: vi.fn(),
    status: "idle",
    setStatus: vi.fn(),
    autoInjectedNotes: [],
    scrollerRef: { current: null },
  }),
}));

vi.mock("../hooks/useWorkflowDetection", () => ({
  useWorkflowDetection: vi.fn().mockReturnValue({
    detectedWorkflow: null,
    applyingWf: false,
    appliedWf: false,
    applyWorkflow: vi.fn(),
  }),
}));

vi.mock("../hooks/useMemoDetection", () => ({
  useMemoDetection: vi.fn().mockReturnValue({
    detectedMemo: null,
    applying: false,
    applied: false,
    applyMemo: vi.fn(),
  }),
}));

vi.mock("../hooks/useFileUpload", () => ({
  useFileUpload: vi.fn().mockReturnValue({
    dragActive: false,
    setDragActive: vi.fn(),
    uploading: false,
    handleFiles: vi.fn(),
    handlePaste: vi.fn(),
  }),
}));

vi.mock("../hooks/useTemplates", () => ({
  useTemplates: vi.fn().mockReturnValue({
    showPicker: false,
    setShowPicker: vi.fn(),
    pickerFilter: "",
    setPickerFilter: vi.fn(),
    visibleTemplates: [],
    insertTemplate: vi.fn(),
  }),
}));

vi.mock("../hooks/useNotes", () => ({
  useNotes: vi.fn().mockReturnValue({
    notes: [],
    showNotePicker: false,
    setShowNotePicker: vi.fn(),
    attachNote: vi.fn(),
  }),
}));

vi.mock("../hooks/useTags", () => ({
  useTags: vi.fn().mockReturnValue({
    tags: [],
    setTags: vi.fn(),
    tagInput: "",
    setTagInput: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
  }),
}));

vi.mock("../hooks/useSessionSummary", () => ({
  useSessionSummary: vi.fn().mockReturnValue({
    summary: null,
    summarizing: false,
    summarize: vi.fn(),
    clearSummary: vi.fn(),
  }),
}));

vi.mock("../hooks/useProjects", () => ({
  useProjects: vi.fn().mockReturnValue({
    projects: [],
    create: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// ─── 基礎 useAutonomy 回傳值 ──────────────────────────────────────────────────

function makeAutonomyReturn(overrides: Record<string, any> = {}) {
  return {
    run: null,
    pending: [],
    busy: false,
    start: vi.fn(),
    approvePlan: vi.fn(),
    stop: vi.fn(),
    resume: vi.fn(),
    sendInput: vi.fn(),
    inject: vi.fn().mockResolvedValue(false),
    approveAction: vi.fn(),
    rejectAction: vi.fn(),
    autorunPending: null,
    confirmAutorun: vi.fn(),
    dismissAutorun: vi.fn(),
    ...overrides,
  };
}

// ─── Props ──────────────────────────────────────────────────────────────────

const BASE_PROPS = {
  sessionId: "sess_001",
  agentId: "agent_001",
  agentName: "測試 Agent",
};

// ─── 測試 ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ChatWindow — AutorunApprovalCard 掛載（G1）", () => {
  it("autorunPending=null 時不渲染 AutorunApprovalCard", async () => {
    mockUseAutonomy.mockReturnValue(makeAutonomyReturn({ autorunPending: null }));
    render(<ChatWindow {...BASE_PROPS} />);
    await waitFor(() => {
      expect(screen.queryByText(/PM 建議啟動自走/)).toBeNull();
    });
  });

  it("autorunPending 有值時渲染 AutorunApprovalCard 並顯示目標句", async () => {
    mockUseAutonomy.mockReturnValue(
      makeAutonomyReturn({ autorunPending: "本週完成行銷月報" })
    );
    render(<ChatWindow {...BASE_PROPS} />);
    await waitFor(() => {
      expect(screen.getByText(/PM 建議啟動自走/)).toBeTruthy();
      expect(screen.getByText(/本週完成行銷月報/)).toBeTruthy();
    });
  });

  it("按「確認啟動」呼叫 confirmAutorun", async () => {
    const confirmAutorun = vi.fn();
    mockUseAutonomy.mockReturnValue(
      makeAutonomyReturn({ autorunPending: "完成月報", confirmAutorun })
    );
    render(<ChatWindow {...BASE_PROPS} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /確認啟動/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /確認啟動/ }));
    expect(confirmAutorun).toHaveBeenCalledTimes(1);
  });

  it("按「取消」呼叫 dismissAutorun 且不呼叫 confirmAutorun", async () => {
    const confirmAutorun = vi.fn();
    const dismissAutorun = vi.fn();
    mockUseAutonomy.mockReturnValue(
      makeAutonomyReturn({ autorunPending: "完成月報", confirmAutorun, dismissAutorun })
    );
    render(<ChatWindow {...BASE_PROPS} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /取消/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    expect(dismissAutorun).toHaveBeenCalledTimes(1);
    expect(confirmAutorun).not.toHaveBeenCalled();
  });

  it("autorunPending 卡片傳遞 busy=false 時按鈕可點擊", async () => {
    mockUseAutonomy.mockReturnValue(
      makeAutonomyReturn({ autorunPending: "測試目標", busy: false })
    );
    render(<ChatWindow {...BASE_PROPS} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /確認啟動/ })).toBeTruthy());
    const btn = screen.getByRole("button", { name: /確認啟動/ });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("autorunPending 卡片傳遞 busy=true 時按鈕 disabled 顯示處理中", async () => {
    mockUseAutonomy.mockReturnValue(
      makeAutonomyReturn({ autorunPending: "測試目標", busy: true })
    );
    render(<ChatWindow {...BASE_PROPS} />);
    await waitFor(() => expect(screen.getByText(/處理中…/)).toBeTruthy());
    const btn = screen.getByRole("button", { name: /確認啟動|處理中/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("ChatWindow — 專案經理一句話交接", () => {
  function setupSocket() {
    const handlers: Record<string, (e: any) => void> = {};
    const sock = {
      on: vi.fn((ev: string, fn: (e: any) => void) => { handlers[ev] = fn; }),
      off: vi.fn(),
      emit: vi.fn(),
    };
    vi.mocked(getSocket).mockReturnValue(sock as any);
    return { sock, handlers };
  }
  const PM_PROPS = { sessionId: "pm_1", agentId: "agents-orchestrator", agentName: "專案經理" };

  it("「🔁 交接」樂觀顯示自己的訊息並 emit session:send（帶 handoff 旗標，伺服器強制交接）", async () => {
    mockUseAutonomy.mockReturnValue(makeAutonomyReturn());
    const { sock } = setupSocket();
    // useChatSession mock 每次回傳同一個物件，取出它的 setMessages 來檢查樂觀更新
    const setMessages = vi.mocked((useChatSession as any)().setMessages as ReturnType<typeof vi.fn>);
    setMessages.mockClear();
    render(<ChatWindow {...PM_PROPS} />);
    fireEvent.click(await screen.findByRole("button", { name: /交接/ }));
    expect(sock.emit).toHaveBeenCalledWith("session:send", { sessionId: "pm_1", text: HANDOFF_REQUEST_TEXT, handoff: true });
    const updaters = setMessages.mock.calls.map((c: any[]) => c[0]).filter((u: unknown) => typeof u === "function");
    const appended = updaters.map((u: any) => u([])).find((r: any[]) => r.length === 1 && r[0].role === "user");
    expect(appended?.[0].content).toBe(HANDOFF_REQUEST_TEXT);
  });

  it("收到本場 session:handoff → 交接鈕隱藏；別場的不理", async () => {
    mockUseAutonomy.mockReturnValue(makeAutonomyReturn());
    const { handlers } = setupSocket();
    render(<ChatWindow {...PM_PROPS} />);
    await screen.findByRole("button", { name: /交接/ });
    act(() => handlers["session:handoff"]({ fromId: "other", toId: "x", toTitle: "x" }));
    expect(screen.getByRole("button", { name: /交接/ })).toBeTruthy();
    act(() => handlers["session:handoff"]({ fromId: "pm_1", toId: "n1", toTitle: "新對話" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /交接/ })).toBeNull());
  });

  it("收到本場 session:handoff_failed → 顯示錯誤訊息", async () => {
    mockUseAutonomy.mockReturnValue(makeAutonomyReturn());
    const { handlers } = setupSocket();
    render(<ChatWindow {...PM_PROPS} />);
    await screen.findByRole("button", { name: /交接/ });
    act(() => handlers["session:handoff_failed"]({ fromId: "pm_1", error: "DB 寫入失敗" }));
    expect(await screen.findByText(/DB 寫入失敗/)).toBeTruthy();
  });

  it("非專案經理不顯示交接鈕", async () => {
    mockUseAutonomy.mockReturnValue(makeAutonomyReturn());
    setupSocket();
    render(<ChatWindow {...BASE_PROPS} />);
    await waitFor(() => expect(screen.queryByRole("button", { name: /🔁 交接/ })).toBeNull());
  });
});

describe("ChatWindow — 斷線重連補抓訊息", () => {
  it("重連時重抓這場的歷史並寫回訊息（不用手動刷新）", async () => {
    mockUseAutonomy.mockReturnValue(makeAutonomyReturn());
    let fire: (() => void) | undefined;
    vi.mocked(onReconnect).mockImplementation((cb: () => void) => { fire = cb; return () => {}; });
    const setMessages = vi.mocked((useChatSession as any)().setMessages as ReturnType<typeof vi.fn>);
    render(<ChatWindow {...BASE_PROPS} />);
    await waitFor(() => expect(fire).toBeDefined());
    const fresh = [{ role: "assistant", content: "斷線期間的回覆", ts: 1 }];
    vi.mocked(api.session).mockResolvedValueOnce({ messages: fresh, tags: [], status: "idle" } as any);
    setMessages.mockClear();
    fire!();
    await waitFor(() => expect(setMessages).toHaveBeenCalledWith(fresh));
  });
});
