import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActionApprovalCard } from "./ActionApprovalCard";

describe("ActionApprovalCard", () => {
  it("dispatch kind 顯示 summary 與核可鈕", () => {
    const onApprove = vi.fn();
    render(<ActionApprovalCard action={{ id: "a1", kind: "dispatch", risk: "high", summary: "派工給 2 位", status: "pending", sessionId: "s" }} busy={false} onApprove={onApprove} onReject={() => {}} />);
    expect(screen.getByText(/派工給 2 位/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /核可/ }));
    expect(onApprove).toHaveBeenCalled();
  });
  it("external_send 顯示 summary 與 detail", () => {
    render(<ActionApprovalCard action={{ id: "a2", kind: "external_send", risk: "high", summary: "寄信", detail: "給客戶", status: "pending", sessionId: "s" }} busy={false} onApprove={() => {}} onReject={() => {}} />);
    expect(screen.getByText(/寄信/)).toBeTruthy();
    expect(screen.getByText(/給客戶/)).toBeTruthy();
  });
  it("拒絕鈕觸發 onReject", () => {
    const onReject = vi.fn();
    render(<ActionApprovalCard action={{ id: "a3", kind: "spend", risk: "high", summary: "付款", status: "pending", sessionId: "s" }} busy={false} onApprove={() => {}} onReject={onReject} />);
    fireEvent.click(screen.getByText(/拒絕/));
    expect(onReject).toHaveBeenCalled();
  });
});
