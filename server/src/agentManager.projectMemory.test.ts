/**
 * agentManager.start() + project memory injection
 *
 * 驗證：有 projectId 且該專案有非空記憶 → 回傳的 AgentSession 的
 * extraSystemPrompt 包含「本專案的記憶」標題字串。
 * 不傳 projectId（undefined）→ extraSystemPrompt 不含該字串（向後相容）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { agentManager } from "./agentManager.js";
import { createProject, setProjectMemory, deleteProject } from "./store/projects.js";
import { deleteSession } from "./store.js";

// Track created resources for cleanup
const createdProjectIds: string[] = [];
const createdSessionIds: string[] = [];

afterEach(() => {
  for (const id of createdSessionIds) {
    try { deleteSession(id); } catch { /* ignore */ }
  }
  createdSessionIds.length = 0;
  for (const id of createdProjectIds) {
    try { deleteProject(id); } catch { /* ignore */ }
  }
  createdProjectIds.length = 0;
});

describe("agentManager.start() 專案記憶注入", () => {
  it("有 projectId 且專案有記憶 → extraSystemPrompt 含「本專案的記憶」", () => {
    const proj = createProject({ workspaceId: "default", name: "test-proj" });
    createdProjectIds.push(proj.id);
    setProjectMemory(proj.id, "決策：使用 Postgres 作為主資料庫。");

    const sess = agentManager.start(
      "coder",
      "測試 session",
      undefined,
      undefined,
      false,
      "claude",
      proj.id,
    );
    createdSessionIds.push(sess.id);

    expect(sess.extraSystemPrompt).toContain("本專案的記憶");
    expect(sess.extraSystemPrompt).toContain("決策：使用 Postgres 作為主資料庫。");
  });

  it("有 projectId 但記憶為空字串 → 不注入專案記憶區塊", () => {
    const proj = createProject({ workspaceId: "default", name: "empty-mem-proj" });
    createdProjectIds.push(proj.id);
    // memory 預設為 "" — 不呼叫 setProjectMemory

    const sess = agentManager.start(
      "coder",
      "測試 session 2",
      undefined,
      undefined,
      false,
      "claude",
      proj.id,
    );
    createdSessionIds.push(sess.id);

    expect(sess.extraSystemPrompt ?? "").not.toContain("本專案的記憶");
  });

  it("不傳 projectId（undefined）→ 向後相容、不含專案記憶區塊", () => {
    const sess = agentManager.start(
      "coder",
      "無專案 session",
      undefined,
      undefined,
      false,
      "claude",
      // projectId 省略
    );
    createdSessionIds.push(sess.id);

    expect(sess.extraSystemPrompt ?? "").not.toContain("本專案的記憶");
  });
});
