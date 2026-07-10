/**
 * G1 — AutorunApprovalCard 測試
 * 收到 autorun:pending 事件 → 彈確認卡 → 按確認 → 呼叫 onStart
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AutorunApprovalCard } from "./AutorunApprovalCard";

describe("AutorunApprovalCard", () => {
  it("顯示目標句", () => {
    render(
      <AutorunApprovalCard
        goal="本週完成行銷週報並發布"
        busy={false}
        onConfirm={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(screen.getByText(/本週完成行銷週報並發布/)).toBeTruthy();
  });

  it("按確認 → 呼叫 onConfirm", () => {
    const onConfirm = vi.fn();
    render(
      <AutorunApprovalCard
        goal="整理本週報告"
        busy={false}
        onConfirm={onConfirm}
        onDismiss={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /確認啟動/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("按取消 → 呼叫 onDismiss，不呼叫 onConfirm", () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(
      <AutorunApprovalCard
        goal="整理本週報告"
        busy={false}
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("busy=true 時按鈕 disabled，顯示處理中", () => {
    render(
      <AutorunApprovalCard
        goal="整理本週報告"
        busy={true}
        onConfirm={() => {}}
        onDismiss={() => {}}
      />
    );
    const btns = screen.getAllByRole("button");
    btns.forEach((btn) => expect(btn).toHaveProperty("disabled", true));
  });
});
