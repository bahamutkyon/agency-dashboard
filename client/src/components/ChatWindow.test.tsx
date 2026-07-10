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
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatWindow } from "./ChatWindow";

// ─── Mock 所有外部依賴 ────────────────────────────────────────────────────────

vi.mock("../lib/socket", () => ({
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
