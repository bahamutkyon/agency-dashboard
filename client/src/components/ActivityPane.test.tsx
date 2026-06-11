import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ActivityPane } from "./ActivityPane";
import { api } from "../lib/api";

vi.mock("../lib/socket", () => ({ getSocket: () => ({ on: vi.fn(), off: vi.fn() }) }));

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
});
