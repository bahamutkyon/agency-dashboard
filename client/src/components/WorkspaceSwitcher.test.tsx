import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import type { Workspace } from "../lib/api";

// --- mock api module ---
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    api: {
      workspaces: vi.fn().mockResolvedValue([]),
      mcpServers: vi.fn().mockResolvedValue([]),
      updateWorkspace: vi.fn().mockResolvedValue({ id: "ws1" } as Workspace),
      createWorkspace: vi.fn(),
      deleteWorkspace: vi.fn(),
      launchWorkspaceChrome: vi.fn(),
      stopWorkspaceChrome: vi.fn(),
      startOnboarding: vi.fn(),
      importWorkspace: vi.fn(),
      exportWorkspaceUrl: vi.fn().mockReturnValue("/api/workspaces/ws1/export"),
    },
  };
});

// mock workspace lib
vi.mock("../lib/workspace", () => ({
  getActiveWorkspace: vi.fn().mockReturnValue("ws1"),
  setActiveWorkspace: vi.fn(),
}));

const makeWorkspace = (overrides: Partial<Workspace> = {}): Workspace => ({
  id: "ws1",
  name: "測試工作區",
  description: "desc",
  standingContext: "",
  memory: "",
  enabledMcps: [],
  chromeCdpPort: undefined,
  workingDir: "",
  createdAt: Date.now(),
  ...overrides,
});

describe("WorkspaceSwitcher — 工作目錄欄位", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const openEditing = async (ws: Workspace) => {
    const { api } = await import("../lib/api");
    (api.workspaces as ReturnType<typeof vi.fn>).mockResolvedValue([ws]);

    render(
      <WorkspaceSwitcher onSwitched={vi.fn()} />
    );

    // open dropdown
    fireEvent.click(screen.getByTitle(/切換工作區/));

    // click edit button
    await waitFor(() => screen.getByText("編輯"));
    fireEvent.click(screen.getByText("編輯"));
  };

  it("顯示工作目錄輸入框", async () => {
    const ws = makeWorkspace({ workingDir: "/my/project" });
    await openEditing(ws);

    const input = screen.getByPlaceholderText(/預設沙箱/);
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("/my/project");
  });

  it("工作目錄為空時顯示佔位文字", async () => {
    const ws = makeWorkspace({ workingDir: "" });
    await openEditing(ws);

    const input = screen.getByPlaceholderText(/預設沙箱/);
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("儲存時帶入 workingDir 新值", async () => {
    const { api } = await import("../lib/api");
    const ws = makeWorkspace({ workingDir: "" });
    await openEditing(ws);

    const input = screen.getByPlaceholderText(/預設沙箱/);
    fireEvent.change(input, { target: { value: "/new/path" } });

    fireEvent.click(screen.getByText("儲存"));

    await waitFor(() => {
      expect(api.updateWorkspace).toHaveBeenCalledWith(
        "ws1",
        expect.objectContaining({ workingDir: "/new/path" })
      );
    });
  });

  it("後端回 400 時顯示錯誤訊息", async () => {
    const { api } = await import("../lib/api");
    (api.updateWorkspace as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error("非法路徑"), { status: 400 })
    );

    const ws = makeWorkspace({ workingDir: "" });
    await openEditing(ws);

    const input = screen.getByPlaceholderText(/預設沙箱/);
    fireEvent.change(input, { target: { value: "/bad/path" } });

    fireEvent.click(screen.getByText("儲存"));

    await waitFor(() => {
      expect(screen.getByText(/非法路徑|工作目錄錯誤|儲存失敗/)).toBeTruthy();
    });
  });
});
