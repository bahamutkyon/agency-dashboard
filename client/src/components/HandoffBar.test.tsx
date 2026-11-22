import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HandoffBar } from "./HandoffBar";
import { HANDOFF_REQUEST_TEXT } from "../lib/handoffNudge";

const long = Array.from({ length: 80 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x" }));

describe("HandoffBar", () => {
  beforeEach(() => localStorage.clear());
  it("交接鈕送出固定訊息", () => {
    const onSend = vi.fn();
    render(<HandoffBar sessionId="s1" messages={[]} status="idle" onSend={onSend} handedOff={false} />);
    fireEvent.click(screen.getByRole("button", { name: /交接/ }));
    expect(onSend).toHaveBeenCalledWith(HANDOFF_REQUEST_TEXT);
  });
  it("忙碌中交接鈕停用", () => {
    render(<HandoffBar sessionId="s1" messages={[]} status="busy" onSend={vi.fn()} handedOff={false} />);
    expect((screen.getByRole("button", { name: /交接/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("過長顯示提醒；按「不用」後消失且記住", () => {
    const { rerender, unmount } = render(<HandoffBar sessionId="s1" messages={long} status="idle" onSend={vi.fn()} handedOff={false} />);
    expect(screen.getByText(/這場已經很長（80 則）/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /不用/ }));
    expect(screen.queryByText(/這場已經很長/)).toBeNull();
    rerender(<HandoffBar sessionId="s1" messages={long} status="idle" onSend={vi.fn()} handedOff={false} />);
    expect(screen.queryByText(/這場已經很長/)).toBeNull();
    unmount();
    render(<HandoffBar sessionId="s1" messages={long} status="idle" onSend={vi.fn()} handedOff={false} />);
    expect(screen.queryByText(/這場已經很長/)).toBeNull();
  });
  it("按鈕觸發後回合結束仍沒交接 → 顯示失敗提示", () => {
    const { rerender } = render(<HandoffBar sessionId="s1" messages={[]} status="idle" onSend={vi.fn()} handedOff={false} />);
    fireEvent.click(screen.getByRole("button", { name: /交接/ }));
    rerender(<HandoffBar sessionId="s1" messages={[]} status="busy" onSend={vi.fn()} handedOff={false} />);
    rerender(<HandoffBar sessionId="s1" messages={[]} status="idle" onSend={vi.fn()} handedOff={false} />);
    expect(screen.getByText(/交接單沒有產生/)).toBeTruthy();
  });
  it("沒按鈕觸發（自然語言）回合結束 → 不顯示失敗提示", () => {
    const { rerender } = render(<HandoffBar sessionId="s1" messages={[]} status="idle" onSend={vi.fn()} handedOff={false} />);
    rerender(<HandoffBar sessionId="s1" messages={[]} status="busy" onSend={vi.fn()} handedOff={false} />);
    rerender(<HandoffBar sessionId="s1" messages={[]} status="idle" onSend={vi.fn()} handedOff={false} />);
    expect(screen.queryByText(/交接單沒有產生/)).toBeNull();
  });
  it("回合中收到交接（handedOff 先於 idle）→ 不誤報失敗", () => {
    const { rerender, container } = render(<HandoffBar sessionId="s1" messages={[]} status="idle" onSend={vi.fn()} handedOff={false} />);
    fireEvent.click(screen.getByRole("button", { name: /交接/ }));
    rerender(<HandoffBar sessionId="s1" messages={[]} status="busy" onSend={vi.fn()} handedOff={false} />);
    rerender(<HandoffBar sessionId="s1" messages={[]} status="busy" onSend={vi.fn()} handedOff />);
    rerender(<HandoffBar sessionId="s1" messages={[]} status="idle" onSend={vi.fn()} handedOff />);
    expect(container.textContent).not.toMatch(/交接單沒有產生/);
  });
  it("伺服器回報交接失敗 → 顯示錯誤訊息，不顯示「沒有產生」", () => {
    const { rerender } = render(<HandoffBar sessionId="s1" messages={[]} status="idle" onSend={vi.fn()} handedOff={false} />);
    fireEvent.click(screen.getByRole("button", { name: /交接/ }));
    rerender(<HandoffBar sessionId="s1" messages={[]} status="busy" onSend={vi.fn()} handedOff={false} failError="開新對話失敗" />);
    rerender(<HandoffBar sessionId="s1" messages={[]} status="idle" onSend={vi.fn()} handedOff={false} failError="開新對話失敗" />);
    expect(screen.getByText(/開新對話失敗/)).toBeTruthy();
    expect(screen.queryByText(/交接單沒有產生/)).toBeNull();
  });
  it("已交接 → 不顯示提醒與按鈕", () => {
    render(<HandoffBar sessionId="s1" messages={long} status="idle" onSend={vi.fn()} handedOff />);
    expect(screen.queryByRole("button", { name: /交接/ })).toBeNull();
    expect(screen.queryByText(/這場已經很長/)).toBeNull();
  });
});
