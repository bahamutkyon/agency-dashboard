import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HandoffCard } from "./HandoffCard";

const sessionHandoff = vi.fn();
const dropSessionHandoff = vi.fn();
const updateSessionHandoff = vi.fn();
vi.mock("../lib/api", () => ({
  api: {
    sessionHandoff: (...a: unknown[]) => sessionHandoff(...a),
    dropSessionHandoff: (...a: unknown[]) => dropSessionHandoff(...a),
    updateSessionHandoff: (...a: unknown[]) => updateSessionHandoff(...a),
  },
}));

describe("HandoffCard", () => {
  beforeEach(() => { sessionHandoff.mockReset(); dropSessionHandoff.mockReset(); updateSessionHandoff.mockReset(); });

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
  it("doc 來源：完整顯示、可編輯並送出", async () => {
    sessionHandoff.mockResolvedValue({ handoff: { fromId: "p1", fromTitle: "長對話", summary: "🎯 目標：定價\n✅ 已決定：不走 FBA", source: "doc" }, handedOffTo: null });
    updateSessionHandoff.mockResolvedValue({ ok: true });
    render(<HandoffCard sessionId="s1" canEdit />);
    await waitFor(() => screen.getByText(/已決定：不走 FBA/));
    expect(screen.getByText(/交接單/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /編輯/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "🎯 目標：改過" } });
    fireEvent.click(screen.getByRole("button", { name: /儲存/ }));
    await waitFor(() => expect(updateSessionHandoff).toHaveBeenCalledWith("s1", "🎯 目標：改過"));
    await waitFor(() => screen.getByText(/目標：改過/));
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("編輯被伺服器拒絕（409）→ 顯示伺服器錯誤訊息", async () => {
    sessionHandoff.mockResolvedValue({ handoff: { fromId: "p1", fromTitle: "t", summary: "x", source: "doc" }, handedOffTo: null });
    updateSessionHandoff.mockRejectedValue(Object.assign(new Error(JSON.stringify({ error: "已經開始對話，請直接跟專案經理說要補充什麼" })), { status: 409 }));
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<HandoffCard sessionId="s1" canEdit />);
    await waitFor(() => screen.getByText("x"));
    fireEvent.click(screen.getByRole("button", { name: /編輯/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "y" } });
    fireEvent.click(screen.getByRole("button", { name: /儲存/ }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("已經開始對話")));
    alertSpy.mockRestore();
  });

  it("canEdit=false 不顯示編輯", async () => {
    sessionHandoff.mockResolvedValue({ handoff: { fromId: "p1", fromTitle: "t", summary: "x", source: "doc" }, handedOffTo: null });
    render(<HandoffCard sessionId="s1" />);
    await waitFor(() => screen.getByText("x"));
    expect(screen.queryByRole("button", { name: /編輯/ })).toBeNull();
  });

  it("來源場次：顯示已交接連結", async () => {
    sessionHandoff.mockResolvedValue({ handoff: null, handedOffTo: { id: "n1", title: "新對話" } });
    const onOpen = vi.fn();
    render(<HandoffCard sessionId="s1" onOpenSession={onOpen} />);
    await waitFor(() => screen.getByText(/已交接/));
    fireEvent.click(screen.getByRole("button", { name: /新對話/ }));
    expect(onOpen).toHaveBeenCalledWith("n1", "agents-orchestrator", "新對話");
  });

  it("reloadKey 改變 → 重新抓取", async () => {
    sessionHandoff.mockResolvedValue({ handoff: null, handedOffTo: null });
    const { rerender } = render(<HandoffCard sessionId="s1" reloadKey={0} />);
    await waitFor(() => expect(sessionHandoff).toHaveBeenCalledTimes(1));
    sessionHandoff.mockResolvedValue({ handoff: null, handedOffTo: { id: "n1", title: "新對話" } });
    rerender(<HandoffCard sessionId="s1" reloadKey={1} />);
    await waitFor(() => screen.getByText(/已交接/));
  });
});
