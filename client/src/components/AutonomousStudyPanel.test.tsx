import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    studyTiers: vi.fn().mockResolvedValue({
      hot: [{ agentId: "a1", name: "熱A", sessions30d: 5, sessions90d: 12, lastResearchedAt: null, override: null }],
      cold: [],
      dormant: [],
      excluded: [],
    }),
    studySchedules: vi.fn().mockResolvedValue([
      { tier: "hot", cron: "0 4 * * 1", enabled: false, perRunCap: 10 },
      { tier: "cold", cron: "0 4 1 * *", enabled: false, perRunCap: 10 },
    ]),
    studyOverride: vi.fn().mockResolvedValue({ ok: true }),
    studyRun: vi.fn().mockResolvedValue({ runId: "r1" }),
    studyReport: vi.fn(),
    studyPatchSchedule: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

import { api } from "../lib/api";
import { AutonomousStudyPanel } from "./AutonomousStudyPanel";

describe("AutonomousStudyPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("載入後顯示熱層 agent", async () => {
    render(<AutonomousStudyPanel />);
    await waitFor(() => expect(screen.getByText("熱A")).toBeInTheDocument());
  });

  it("顯示排程開關，切換時呼叫 studyPatchSchedule", async () => {
    render(<AutonomousStudyPanel />);
    await waitFor(() => expect(screen.getByText("熱A")).toBeInTheDocument());
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    await waitFor(() =>
      expect(api.studyPatchSchedule).toHaveBeenCalledWith("hot", { enabled: true })
    );
  });

  it("點立即進修呼叫 studyRun", async () => {
    vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<AutonomousStudyPanel />);
    await waitFor(() => expect(screen.getByText("熱A")).toBeInTheDocument());
    fireEvent.click(screen.getByText("立即進修"));
    await waitFor(() => expect(api.studyRun).toHaveBeenCalledWith("a1"));
  });
});
