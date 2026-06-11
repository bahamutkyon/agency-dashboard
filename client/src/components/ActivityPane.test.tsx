import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { ActivityPane } from "./ActivityPane";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";

vi.mock("../lib/socket", () => ({ getSocket: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })) }));

describe("ActivityPane", () => {
  beforeEach(() => {
    vi.spyOn(api, "listActivity").mockResolvedValue({ items: [
      { id: "1", ts: 2, workspaceId: "w", sessionId: "s", kind: "tool_call", summary: "Bash: npm test" },
      { id: "2", ts: 1, workspaceId: "w", sessionId: "s", kind: "tool_result", summary: "完成", status: "ok" },
    ] } as any);
  });
  it("渲染活動列表", async () => {
    render(<ActivityPane />);
    await waitFor(() => expect(screen.getByText(/Bash: npm test/)).toBeTruthy());
    expect(screen.getByText(/完成/)).toBeTruthy();
  });
  it("socket 事件 prepend 到列表最前", async () => {
    let captured: ((row: any) => void) | undefined;
    const mockOn = vi.fn((_: string, h: any) => { captured = h; });
    vi.mocked(getSocket).mockReturnValue({ on: mockOn, off: vi.fn() } as any);
    render(<ActivityPane />);
    await waitFor(() => expect(screen.getByText(/Bash: npm test/)).toBeTruthy());
    act(() => captured!({ id: "3", ts: 99, workspaceId: "w", kind: "run_done", summary: "新事件" }));
    await waitFor(() => expect(screen.getByText(/新事件/)).toBeTruthy());
  });
  it("socket 事件 id 已存在 → 不重複", async () => {
    let captured: ((row: any) => void) | undefined;
    const mockOn = vi.fn((_: string, h: any) => { captured = h; });
    vi.mocked(getSocket).mockReturnValue({ on: mockOn, off: vi.fn() } as any);
    render(<ActivityPane />);
    await waitFor(() => expect(screen.getByText(/Bash: npm test/)).toBeTruthy());
    // id "1" 已在初次載入的 mock 資料裡
    act(() => captured!({ id: "1", ts: 2, workspaceId: "w", sessionId: "s", kind: "tool_call", summary: "Bash: npm test" }));
    expect(screen.getAllByText(/Bash: npm test/).length).toBe(1);
  });
  it("unmount 時 off 傳入與 on 相同的 handler 參考", async () => {
    const mockOn = vi.fn();
    const mockOff = vi.fn();
    vi.mocked(getSocket).mockReturnValue({ on: mockOn, off: mockOff } as any);
    const { unmount } = render(<ActivityPane />);
    await waitFor(() => expect(screen.getByText(/Bash: npm test/)).toBeTruthy());
    unmount();
    expect(mockOn.mock.calls[0][1]).toBe(mockOff.mock.calls[0][1]);
  });
});
