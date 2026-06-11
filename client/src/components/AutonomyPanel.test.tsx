import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AutonomyPanel } from "./AutonomyPanel";
import type { AutonomyRun } from "../lib/api";

const makeRun = (overrides: Partial<AutonomyRun> = {}): AutonomyRun => ({
  id: "run1",
  sessionId: "s1",
  workspaceId: "ws1",
  goal: "測試目標",
  status: "running",
  stepCount: 2,
  maxSteps: 10,
  startedAt: Date.now(),
  deadlineAt: Date.now() + 3600000,
  ...overrides,
});

describe("AutonomyPanel", () => {
  it("run=null 顯示目標輸入與開始鈕", () => {
    const onStart = vi.fn();
    render(
      <AutonomyPanel
        run={null}
        busy={false}
        onStart={onStart}
        onApprovePlan={() => {}}
        onStop={() => {}}
        onResume={() => {}}
        onInput={() => {}}
      />
    );
    expect(screen.getByPlaceholderText(/例如/)).toBeTruthy();
    expect(screen.getByText(/開始自主執行/)).toBeTruthy();
  });

  it("輸入目標後點開始呼叫 onStart", () => {
    const onStart = vi.fn();
    render(
      <AutonomyPanel
        run={null}
        busy={false}
        onStart={onStart}
        onApprovePlan={() => {}}
        onStop={() => {}}
        onResume={() => {}}
        onInput={() => {}}
      />
    );
    const textarea = screen.getByPlaceholderText(/例如/);
    fireEvent.change(textarea, { target: { value: "我的目標" } });
    fireEvent.click(screen.getByText(/開始自主執行/));
    expect(onStart).toHaveBeenCalledWith("我的目標");
  });

  it("run.status=awaiting_plan_approval 顯示核可計畫鈕", () => {
    const onApprovePlan = vi.fn();
    render(
      <AutonomyPanel
        run={makeRun({ status: "awaiting_plan_approval" })}
        busy={false}
        onStart={() => {}}
        onApprovePlan={onApprovePlan}
        onStop={() => {}}
        onResume={() => {}}
        onInput={() => {}}
      />
    );
    const btn = screen.getByText(/核可計畫並開跑/);
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onApprovePlan).toHaveBeenCalled();
  });

  it("run.status=running 顯示步數與喊停鈕", () => {
    const onStop = vi.fn();
    render(
      <AutonomyPanel
        run={makeRun({ status: "running", stepCount: 3, maxSteps: 10 })}
        busy={false}
        onStart={() => {}}
        onApprovePlan={() => {}}
        onStop={onStop}
        onResume={() => {}}
        onInput={() => {}}
      />
    );
    expect(screen.getByText(/3\/10/)).toBeTruthy();
    fireEvent.click(screen.getByText(/喊停/));
    expect(onStop).toHaveBeenCalled();
  });
});
