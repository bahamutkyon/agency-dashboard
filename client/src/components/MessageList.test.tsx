import { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MessageList } from "./MessageList";
import type { Msg } from "../hooks/useChatSession";

// 避免拉進 react-markdown 整套 ESM，冒煙測試只關心渲染與接線
vi.mock("./MarkdownView", () => ({
  MarkdownView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const baseProps = () => ({
  scrollerRef: createRef<HTMLDivElement>() as any,
  agentName: "測試員",
  agents: [{ id: "marketing-content-creator", name: "內容創作者", category: "marketing" }],
  status: "idle",
  dismissedForks: new Set<number>(),
  onDismissFork: vi.fn(),
  onAcceptFork: vi.fn(),
  onHandoff: vi.fn(),
  onCopy: vi.fn(),
  onEditResend: vi.fn(),
  onRegenerate: vi.fn(),
});

const msg = (role: Msg["role"], content: string): Msg => ({ role, content, ts: 0 });

describe("MessageList", () => {
  it("空訊息時顯示開場提示", () => {
    render(<MessageList {...baseProps()} messages={[]} />);
    expect(screen.getByText(/開始對話/)).toBeInTheDocument();
  });

  it("渲染使用者與助理訊息內容", () => {
    render(<MessageList {...baseProps()} messages={[msg("user", "你好"), msg("assistant", "我在")]} />);
    expect(screen.getByText("你好")).toBeInTheDocument();
    expect(screen.getByText("我在")).toBeInTheDocument();
  });

  it("[[CONSULT_RESULTS]] 內部訊息顯示為灰字提示、不洩漏原文", () => {
    render(<MessageList {...baseProps()} messages={[msg("user", "[[CONSULT_RESULTS]]\n一堆原始資料")]} />);
    expect(screen.getByText(/已將同事回覆交給專案經理整合/)).toBeInTheDocument();
    expect(screen.queryByText(/一堆原始資料/)).not.toBeInTheDocument();
  });

  it("複製按鈕呼叫 onCopy", () => {
    const p = baseProps();
    render(<MessageList {...p} messages={[msg("assistant", "答案")]} />);
    fireEvent.click(screen.getByTitle("複製"));
    expect(p.onCopy).toHaveBeenCalledWith("答案");
  });

  it("助理訊息含 FORK 區塊時顯示分支建議卡,接受呼叫 onAcceptFork", () => {
    const p = baseProps();
    const fork = "=== FORK: marketing-content-creator ===\n原因：需要文案\n---\n幫我寫貼文\n=== END FORK ===";
    render(<MessageList {...p} messages={[msg("assistant", fork)]} />);
    expect(screen.getByText(/AI 建議分支到/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/接受/));
    expect(p.onAcceptFork).toHaveBeenCalledWith("marketing-content-creator", "幫我寫貼文", "測試員");
  });

  it("自主迴圈協議 user 訊息（含「你正在「自主模式」下工作」）不出現在畫面", () => {
    const autonomyPrompt = "你正在「自主模式」下工作。\n\n以下是你的目標：\n分析報告";
    render(<MessageList {...baseProps()} messages={[msg("user", autonomyPrompt)]} />);
    expect(screen.queryByText(/你正在「自主模式」下工作/)).not.toBeInTheDocument();
    expect(screen.queryByText(/分析報告/)).not.toBeInTheDocument();
  });

  it("assistant 訊息中 ACTION 區塊被移除，保留其餘文字", () => {
    const content = "好的我來做。\n=== ACTION ===\nkind: next_step\nsummary: x\n=== END ACTION ===";
    render(<MessageList {...baseProps()} messages={[msg("assistant", content)]} />);
    expect(screen.getByText("好的我來做。")).toBeInTheDocument();
    expect(screen.queryByText(/=== ACTION ===/)).not.toBeInTheDocument();
    expect(screen.queryByText(/=== END ACTION ===/)).not.toBeInTheDocument();
  });

  it("assistant 訊息只含 ACTION 區塊時顯示灰色占位提示而非空泡泡", () => {
    const content = "=== ACTION ===\nkind: next_step\nsummary: 執行下一步\n=== END ACTION ===";
    render(<MessageList {...baseProps()} messages={[msg("assistant", content)]} />);
    expect(screen.getByText(/自主步驟/)).toBeInTheDocument();
    expect(screen.queryByText(/=== ACTION ===/)).not.toBeInTheDocument();
  });

  it("一般對話訊息不受自主過濾影響", () => {
    render(<MessageList {...baseProps()} messages={[msg("user", "請幫我分析"), msg("assistant", "好的，分析如下：\n1. 項目一")]} />);
    expect(screen.getByText("請幫我分析")).toBeInTheDocument();
    expect(screen.getByText(/好的，分析如下：/)).toBeInTheDocument();
  });
});
