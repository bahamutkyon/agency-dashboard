import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TidyPanel } from "./TidyPanel";
import type { SessionRecord } from "../lib/api";

const DAY = 86_400_000;
const sessions = vi.fn();
const setSessionState = vi.fn();
const learningProposals = vi.fn();
vi.mock("../lib/api", () => ({
  api: {
    sessions: (...a: unknown[]) => sessions(...a),
    setSessionState: (...a: unknown[]) => setSessionState(...a),
    learningProposals: (...a: unknown[]) => learningProposals(...a),
  },
}));

const rec = (o: Partial<SessionRecord>): SessionRecord => ({
  id: "x", agentId: "agents-orchestrator", title: "t", createdAt: 0, updatedAt: Date.now(), messages: [], messageCount: 4, ...o,
});

describe("TidyPanel（整理掛單）", () => {
  beforeEach(() => {
    sessions.mockResolvedValue([
      rec({ id: "new", title: "電容定價", updatedAt: Date.now() - 2 * DAY, stoppedAt: "等你拍照", state: "waiting_user" }),
      rec({ id: "old", title: "代購保固", updatedAt: Date.now() - 90 * DAY, stoppedAt: "等你批准派工" }),
      rec({ id: "park", title: "自媒體", updatedAt: Date.now() - 60 * DAY, state: "parked" }),
      rec({ id: "done", title: "已講完", state: "done" }),
      rec({ id: "sched", title: "[排程 x] LP" }),
    ]);
    setSessionState.mockResolvedValue({});
    learningProposals.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);
  });

  it("列出未結束的對話（不含已完成、排程），擱置中的另列", async () => {
    render(<TidyPanel onOpen={vi.fn()} onOpenLearning={vi.fn()} />);
    await waitFor(() => screen.getByText("電容定價"));
    expect(screen.getByText("代購保固")).toBeTruthy();
    expect(screen.getByText(/等你拍照/)).toBeTruthy();
    expect(screen.queryByText("已講完")).toBeNull();
    expect(screen.queryByText("[排程 x] LP")).toBeNull();
    expect(screen.getByText(/擱置中（1）/)).toBeTruthy();
  });

  it("勾選超過 30 天的 → 批次標記完成", async () => {
    render(<TidyPanel onOpen={vi.fn()} onOpenLearning={vi.fn()} />);
    await waitFor(() => screen.getByText("電容定價"));
    fireEvent.click(screen.getByRole("button", { name: /勾選超過 30 天/ }));
    fireEvent.click(screen.getByRole("button", { name: /標記完成（1）/ }));
    await waitFor(() => expect(setSessionState).toHaveBeenCalledWith("old", "done"));
    expect(setSessionState).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText("代購保固")).toBeNull());
  });

  it("勾選後「先擱著」；擱置中可以拉回", async () => {
    render(<TidyPanel onOpen={vi.fn()} onOpenLearning={vi.fn()} />);
    await waitFor(() => screen.getByText("電容定價"));
    fireEvent.click(screen.getByLabelText("選取 電容定價"));
    fireEvent.click(screen.getByRole("button", { name: /先擱著（1）/ }));
    await waitFor(() => expect(setSessionState).toHaveBeenCalledWith("new", "parked"));
    fireEvent.click(screen.getByText(/擱置中（2）/));
    fireEvent.click(screen.getAllByRole("button", { name: /拉回/ })[0]);
    await waitFor(() => expect(setSessionState).toHaveBeenCalledWith(expect.any(String), null));
  });

  it("顯示學習審核待處理數並可前往", async () => {
    const onOpenLearning = vi.fn();
    render(<TidyPanel onOpen={vi.fn()} onOpenLearning={onOpenLearning} />);
    await waitFor(() => screen.getByText(/學習審核還有 2 條/));
    fireEvent.click(screen.getByRole("button", { name: /去審核/ }));
    expect(onOpenLearning).toHaveBeenCalled();
  });
});
