import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentSidebar } from "./AgentSidebar";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(window, "localStorage", { value: localStorageMock });

const noop = () => {};
const baseProps = {
  agents: [],
  categories: [],
  liveAgentIds: new Set<string>(),
  sessionCounts: {},
  onPick: noop,
  onAskOrchestrator: noop,
  onOpenCockpit: noop,
  onOpenSchedules: noop,
  onOpenHistory: noop,
  onOpenTemplates: noop,
  onOpenSettings: noop,
  onOpenBatch: noop,
  onOpenNotes: noop,
  onOpenLearning: noop,
  onOpenCapabilityLearning: noop,
  onOpenAutonomousStudy: noop,
  onOpenMemoryEditor: noop,
  onOpenLegacyReview: noop,
  onOpenWorkflows: noop,
  onOpenActivity: noop,
  onOpenDelegations: noop,
  onOpenGoals: noop,
  onOpenOutcomes: noop,
  onOpenWatchtower: noop,
};

beforeEach(() => {
  localStorageMock.clear();
});

describe("AgentSidebar 分組折疊", () => {
  it("預設「經營」展開，其餘收合", () => {
    render(<AgentSidebar {...baseProps} />);
    // 目標 button is inside 經營 group (should be visible by default)
    expect(screen.getByTitle("目標帳本")).toBeTruthy();
    // 歷史 button is inside 對話 group (should be hidden by default)
    expect(screen.queryByTitle("所有過往對話")).toBeNull();
  });

  it("點擊「對話」組頭展開後，歷史按鈕出現", () => {
    render(<AgentSidebar {...baseProps} />);
    const dialogHeader = screen.getByTestId("group-header-對話");
    fireEvent.click(dialogHeader);
    expect(screen.getByTitle("所有過往對話")).toBeTruthy();
  });

  it("點擊「學習/研究」組頭展開後，筆記按鈕出現", () => {
    render(<AgentSidebar {...baseProps} />);
    const learningHeader = screen.getByTestId("group-header-學習/研究");
    fireEvent.click(learningHeader);
    expect(screen.getByTitle("共享筆記/知識庫")).toBeTruthy();
  });

  it("點擊「系統」組頭展開後，設定按鈕出現", () => {
    render(<AgentSidebar {...baseProps} />);
    const sysHeader = screen.getByTestId("group-header-系統");
    fireEvent.click(sysHeader);
    expect(screen.getByTitle("主題、字體、通知設定")).toBeTruthy();
  });

  it("折疊「經營」後，目標按鈕消失", () => {
    render(<AgentSidebar {...baseProps} />);
    const header = screen.getByTestId("group-header-經營");
    fireEvent.click(header); // collapse
    expect(screen.queryByTitle("目標帳本")).toBeNull();
  });

  it("orchestrator 按鈕一直在", () => {
    render(<AgentSidebar {...baseProps} />);
    expect(screen.getByText("找專案經理討論")).toBeTruthy();
  });
});
