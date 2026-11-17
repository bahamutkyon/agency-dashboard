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
    render(<ResumeStrip sessions={[rec({})]} onResume={onResume} onNewTopic={vi.fn()} onMarkDone={vi.fn()} onPark={vi.fn()} onReply={vi.fn()} />);
    expect(screen.getByText("M83421 電容定價")).toBeTruthy();
    expect(screen.getByText(/兩套定價表都備好了/)).toBeTruthy();
    expect(screen.getByText(/6 則/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "繼續" }));
    expect(onResume).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }));
  });

  it("「停在」標明是誰說的", () => {
    render(<ResumeStrip sessions={[rec({ lastRole: "user", lastSnippet: "等我拍照" })]} onResume={vi.fn()} onNewTopic={vi.fn()} onMarkDone={vi.fn()} onPark={vi.fn()} onReply={vi.fn()} />);
    expect(screen.getByText(/停在［我］/)).toBeTruthy();
  });

  it("沒有可接續的對話時不顯示", () => {
    const { container } = render(<ResumeStrip sessions={[]} onResume={vi.fn()} onNewTopic={vi.fn()} onMarkDone={vi.fn()} onPark={vi.fn()} onReply={vi.fn()} />);
    expect(container.textContent).toBe("");
  });

  it("有整理好的「停在哪」就用它，並顯示狀態標籤", () => {
    render(<ResumeStrip sessions={[rec({ stoppedAt: "等你拍外殼照片再選定價表", state: "waiting_user", pendingCount: 0 })]}
      onResume={vi.fn()} onNewTopic={vi.fn()} onMarkDone={vi.fn()} onPark={vi.fn()} onReply={vi.fn()} />);
    expect(screen.getByText(/等你拍外殼照片再選定價表/)).toBeTruthy();
    expect(screen.queryByText(/兩套定價表都備好了/)).toBeNull();
    expect(screen.getByText(/等你回覆/)).toBeTruthy();
  });

  it("按「標記完成」", () => {
    const onMarkDone = vi.fn();
    render(<ResumeStrip sessions={[rec({})]} onResume={vi.fn()} onNewTopic={vi.fn()} onMarkDone={onMarkDone} onPark={vi.fn()} onReply={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /✓ 完成/ }));
    expect(onMarkDone).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }));
  });
  const base = { onResume: vi.fn(), onNewTopic: vi.fn(), onMarkDone: vi.fn(), onPark: vi.fn() };

  it("選項變成按鈕，點一下就回覆該選項", () => {
    const onReply = vi.fn();
    render(<ResumeStrip {...base} onReply={onReply} sessions={[rec({ lastOptions: [{ key: "A", label: "實體商品" }, { key: "B", label: "服務" }] })]} />);
    fireEvent.click(screen.getByRole("button", { name: /A\. 實體商品/ }));
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }), "A");
  });

  it("直接打字回覆；送出後顯示已送出，可打開看回覆", () => {
    const onReply = vi.fn();
    const onResume = vi.fn();
    render(<ResumeStrip {...base} onResume={onResume} onReply={onReply} sessions={[rec({})]} />);
    fireEvent.click(screen.getByRole("button", { name: /回覆/ }));
    fireEvent.change(screen.getByPlaceholderText(/回覆專案經理/), { target: { value: "先做定價" } });
    fireEvent.click(screen.getByRole("button", { name: "送出" }));
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }), "先做定價");
    expect(screen.getByText(/已送出/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /打開看回覆/ }));
    expect(onResume).toHaveBeenCalled();
  });

  it("「先擱著」", () => {
    const onPark = vi.fn();
    render(<ResumeStrip {...base} onPark={onPark} onReply={vi.fn()} sessions={[rec({})]} />);
    fireEvent.click(screen.getByRole("button", { name: /先擱著/ }));
    expect(onPark).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }));
  });

  it("有更多未結束的對話時顯示「整理」入口", () => {
    const onOpenTidy = vi.fn();
    render(<ResumeStrip {...base} onReply={vi.fn()} onOpenTidy={onOpenTidy} openCount={19} sessions={[rec({})]} />);
    fireEvent.click(screen.getByRole("button", { name: /整理.*19/ }));
    expect(onOpenTidy).toHaveBeenCalled();
  });
});
