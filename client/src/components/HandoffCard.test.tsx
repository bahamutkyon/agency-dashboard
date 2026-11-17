import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HandoffCard } from "./HandoffCard";

const sessionHandoff = vi.fn();
const dropSessionHandoff = vi.fn();
vi.mock("../lib/api", () => ({
  api: {
    sessionHandoff: (...a: unknown[]) => sessionHandoff(...a),
    dropSessionHandoff: (...a: unknown[]) => dropSessionHandoff(...a),
  },
}));

describe("HandoffCard", () => {
  beforeEach(() => { sessionHandoff.mockReset(); dropSessionHandoff.mockReset(); });

  it("有交接：顯示上一場標題與重點；「看原對話」開上一場", async () => {
    sessionHandoff.mockResolvedValue({ handoff: { fromId: "p1", fromTitle: "電容定價", summary: "等你拍照", source: "digest" } });
    const onOpen = vi.fn();
    render(<HandoffCard sessionId="s1" onOpenSession={onOpen} />);
    await waitFor(() => screen.getByText(/電容定價/));
    expect(screen.getByText(/等你拍照/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /看原對話/ }));
    expect(onOpen).toHaveBeenCalledWith("p1", "agents-orchestrator", "電容定價");
  });

  it("節錄來源要標明「尚未整理」", async () => {
    sessionHandoff.mockResolvedValue({ handoff: { fromId: "p1", fromTitle: "t", summary: "x", source: "excerpt" } });
    render(<HandoffCard sessionId="s1" />);
    await waitFor(() => screen.getByText(/尚未整理/));
  });

  it("「不要帶入」→ 呼叫 API 並收起卡片", async () => {
    sessionHandoff.mockResolvedValue({ handoff: { fromId: "p1", fromTitle: "電容定價", summary: "等你拍照", source: "digest" } });
    dropSessionHandoff.mockResolvedValue({ ok: true, restarted: true });
    render(<HandoffCard sessionId="s1" />);
    await waitFor(() => screen.getByText(/電容定價/));
    fireEvent.click(screen.getByRole("button", { name: /不要帶入/ }));
    await waitFor(() => expect(screen.queryByText(/電容定價/)).toBeNull());
    expect(dropSessionHandoff).toHaveBeenCalledWith("s1");
  });

  it("沒有交接 → 不顯示", async () => {
    sessionHandoff.mockResolvedValue({ handoff: null });
    const { container } = render(<HandoffCard sessionId="s1" />);
    await waitFor(() => expect(sessionHandoff).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
