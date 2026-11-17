import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResumeStrip } from "./ResumeStrip";
import type { SessionRecord } from "../lib/api";

const rec = (o: Partial<SessionRecord>): SessionRecord => ({
  id: "s1", agentId: "agents-orchestrator", title: "M83421 電容定價", createdAt: 0, updatedAt: Date.now(),
  messages: [], messageCount: 6, lastSnippet: "兩套定價表都備好了", lastRole: "assistant", ...o,
});

describe("ResumeStrip", () => {
  it("列出可接續的對話：標題、停在哪、則數；按「繼續」開那一場", () => {
    const onResume = vi.fn();
    render(<ResumeStrip sessions={[rec({})]} onResume={onResume} onNewTopic={vi.fn()} />);
    expect(screen.getByText("M83421 電容定價")).toBeTruthy();
    expect(screen.getByText(/兩套定價表都備好了/)).toBeTruthy();
    expect(screen.getByText(/6 則/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "繼續" }));
    expect(onResume).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }));
  });

  it("「停在」標明是誰說的", () => {
    render(<ResumeStrip sessions={[rec({ lastRole: "user", lastSnippet: "等我拍照" })]} onResume={vi.fn()} onNewTopic={vi.fn()} />);
    expect(screen.getByText(/停在［我］/)).toBeTruthy();
  });

  it("沒有可接續的對話時不顯示", () => {
    const { container } = render(<ResumeStrip sessions={[]} onResume={vi.fn()} onNewTopic={vi.fn()} />);
    expect(container.textContent).toBe("");
  });
});
