import { describe, it, expect } from "vitest";
import { createProject, listProjects, getProject, renameProject, deleteProject, getProjectMemory, setProjectMemory } from "./projects.js";
import { upsertSession, getSession, setSessionProject } from "./sessions.js";

describe("projects store", () => {
  it("create / list / get / rename", () => {
    const p = createProject({ workspaceId: "w1", name: "AudioScape" });
    expect(p.id).toBeTruthy();
    expect(getProject(p.id)!.name).toBe("AudioScape");
    expect(listProjects("w1").some((x) => x.id === p.id)).toBe(true);
    renameProject(p.id, "AudioScape v2");
    expect(getProject(p.id)!.name).toBe("AudioScape v2");
  });
  it("memory set/get + 滾動截斷(8KB)", () => {
    const p = createProject({ workspaceId: "w1", name: "M" });
    expect(getProjectMemory(p.id)).toBe("");
    setProjectMemory(p.id, "決策一");
    expect(getProjectMemory(p.id)).toBe("決策一");
    const big = "x".repeat(9000);
    setProjectMemory(p.id, big);
    expect(getProjectMemory(p.id)!.length).toBeLessThanOrEqual(8192);
  });
  it("刪除專案 → 其下 session 解除綁定(project_id=null)，session 不刪", () => {
    const p = createProject({ workspaceId: "w1", name: "D" });
    const sid = `t_${Date.now()}`;
    upsertSession({ id: sid, workspaceId: "w1", agentId: "x", title: "t", provider: "claude", createdAt: Date.now(), updatedAt: Date.now(), messages: [] });
    setSessionProject(sid, p.id);
    expect(getSession(sid)!.projectId).toBe(p.id);
    deleteProject(p.id);
    expect(getProject(p.id)).toBeUndefined();
    expect(getSession(sid)).toBeTruthy();
    expect(getSession(sid)!.projectId).toBeUndefined();
  });
});
