import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CockpitPanel } from "./CockpitPanel";
import { api } from "../lib/api";

describe("CockpitPanel", () => {
  beforeEach(() => {
    vi.spyOn(api, "cockpit").mockResolvedValue({ briefing: {
      id: "1", date: "2026-07-03", createdAt: Date.now(), raw: "", status: "ok",
      content: { date: "2026-07-03", generatedAt: 1, sections: [
        { kind: "decisions", title: "🔴 待你拍板", items: [{ title: "76F 雙機", body: "要不要" }] },
      ] },
    } } as any);
  });
  it("渲染簡報區塊與展開討論鈕", async () => {
    render(<CockpitPanel onDiscuss={() => {}} />);
    await waitFor(() => expect(screen.getByText("76F 雙機")).toBeInTheDocument());
    expect(screen.getByText("🔴 待你拍板")).toBeInTheDocument();
    expect(screen.getByText(/展開討論/)).toBeInTheDocument();
  });
});
