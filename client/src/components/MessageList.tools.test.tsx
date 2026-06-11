import { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageList } from "./MessageList";
import type { Msg } from "../hooks/useChatSession";

vi.mock("./MarkdownView", () => ({
  MarkdownView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const baseProps = () => ({
  scrollerRef: createRef<HTMLDivElement>() as any,
  agentName: "測試員",
  agents: [],
  status: "idle",
  dismissedForks: new Set<number>(),
  onDismissFork: vi.fn(),
  onAcceptFork: vi.fn(),
  onHandoff: vi.fn(),
  onCopy: vi.fn(),
  onEditResend: vi.fn(),
  onRegenerate: vi.fn(),
});

const toolCallMsg = (name: string): Msg => ({
  role: "system",
  content: "",
  ts: 0,
  tool: { name, summary: name },
});

const toolResultMsg = (status: "ok" | "error"): Msg => ({
  role: "system",
  content: "",
  ts: 0,
  tool: { status, summary: status === "error" ? "工具錯誤" : "工具完成" },
});

const plainMsg = (role: Msg["role"], content: string): Msg => ({
  role,
  content,
  ts: 0,
});

describe("MessageList — 工具 chip", () => {
  it("tool_call chip：顯示工具名稱與 🔧 圖示", () => {
    render(<MessageList {...baseProps()} messages={[toolCallMsg("Bash")]} />);
    expect(screen.getByText(/Bash/)).toBeInTheDocument();
    expect(screen.getByText(/🔧/)).toBeInTheDocument();
  });

  it("tool_result chip（成功）：顯示 ↳ ✓ 與摘要", () => {
    render(<MessageList {...baseProps()} messages={[toolResultMsg("ok")]} />);
    expect(screen.getByText(/↳/)).toBeInTheDocument();
    expect(screen.getByText(/✓/)).toBeInTheDocument();
    expect(screen.getByText(/工具完成/)).toBeInTheDocument();
  });

  it("tool_result chip（錯誤）：顯示 ↳ ✗ 與 rose 標記", () => {
    const { container } = render(<MessageList {...baseProps()} messages={[toolResultMsg("error")]} />);
    expect(screen.getByText(/↳/)).toBeInTheDocument();
    expect(screen.getByText(/✗/)).toBeInTheDocument();
    expect(screen.getByText(/工具錯誤/)).toBeInTheDocument();
    // error chip 應有 rose 相關 class
    const errorEl = container.querySelector(".text-rose-400");
    expect(errorEl).not.toBeNull();
  });

  it("一般 user/assistant 訊息不受影響，照常渲染", () => {
    const messages: Msg[] = [
      plainMsg("user", "你好"),
      plainMsg("assistant", "我在"),
    ];
    render(<MessageList {...baseProps()} messages={messages} />);
    expect(screen.getByText("你好")).toBeInTheDocument();
    expect(screen.getByText("我在")).toBeInTheDocument();
  });

  it("一般 system 訊息（無 tool 欄位）照常以 italic 渲染，不顯示 🔧", () => {
    const messages: Msg[] = [plainMsg("system", "[錯誤] 連線失敗")];
    render(<MessageList {...baseProps()} messages={messages} />);
    expect(screen.getByText(/連線失敗/)).toBeInTheDocument();
    expect(screen.queryByText(/🔧/)).not.toBeInTheDocument();
  });

  it("混合訊息：工具 chip 與一般訊息同時出現互不干擾", () => {
    const messages: Msg[] = [
      plainMsg("user", "執行測試"),
      toolCallMsg("Bash"),
      toolResultMsg("ok"),
      plainMsg("assistant", "測試完成"),
    ];
    render(<MessageList {...baseProps()} messages={messages} />);
    expect(screen.getByText("執行測試")).toBeInTheDocument();
    expect(screen.getByText(/Bash/)).toBeInTheDocument();
    expect(screen.getByText(/工具完成/)).toBeInTheDocument();
    expect(screen.getByText("測試完成")).toBeInTheDocument();
  });
});
