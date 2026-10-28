/**
 * agentManager — system prompt 組裝與 reattach 重建（2026-10）。
 *
 * - 所有 Claude session 帶「工作環境」說明（--agent 會取代 Claude Code 預設 prompt，裡面關於自動壓縮、
 *   不必提早收尾的說明也沒了）。
 * - 無人值守 session（派工子代理、排程、workflow、簡報）在最後帶收尾規則；互動 session 不帶。
 * - 學習標記的長度指引放寬（舊版「< 200 字」＋解析端丟掉超長條目）。
 * - reattach 依存下的配方重建 system prompt（舊版傳 undefined：對話一壓縮，記憶/派工手冊全消失）；
 *   有註冊 seed builder 的 agent（專案經理）會重新產生最新內容。
 */
import { describe, it, expect, afterEach } from "vitest";
import { agentManager, UNATTENDED_TURN_POLICY, workingEnvironmentBlock } from "./agentManager.js";
import { deleteSession } from "./store.js";
import { getSessionPrompt } from "./store/sessionPrompts.js";

const created: string[] = [];
afterEach(() => {
  for (const id of created) {
    try { agentManager.stop(id); } catch { /* ignore */ }
    try { deleteSession(id); } catch { /* ignore */ }
  }
  created.length = 0;
});

function startAgent(opts: { unattended?: boolean; extra?: string; autoFork?: boolean; agentId?: string } = {}) {
  const s = agentManager.start(
    opts.agentId ?? "test-agent-sp", "系統 prompt 測試", opts.extra, undefined,
    opts.autoFork ?? true, "claude", undefined, { unattended: opts.unattended },
  );
  created.push(s.id);
  return s;
}

describe("system prompt 組裝", () => {
  it("互動 session：有工作環境說明與學習能力、沒有無人值守收尾規則", () => {
    const s = startAgent();
    const p = s.extraSystemPrompt!;
    expect(p).toContain("# 工作環境");
    expect(p).toContain("自動壓縮");
    expect(p).toContain("台北時間");
    expect(p).toContain("# 學習能力");
    expect(p).toContain("建議 300 字內");
    expect(p).not.toContain("一行描述（< 200 字）");
    expect(p).not.toContain("收尾方式（使用者的長期指示）");
  });

  it("無人值守 session：收尾規則放在最後", () => {
    const s = startAgent({ unattended: true, autoFork: false });
    const p = s.extraSystemPrompt!;
    expect(p.endsWith(UNATTENDED_TURN_POLICY)).toBe(true);
    // 該停的兩種情況與風險確認仍保留
    expect(UNATTENDED_TURN_POLICY).toContain("沒有他就完全無法往下做");
    expect(UNATTENDED_TURN_POLICY).toContain("有風險或不可逆的動作仍須確認");
  });

  it("工作環境寫的是「對話開始於」某日（Claude Code 沿用第一次記錄的 prompt，不能寫成今天）", () => {
    const block = workingEnvironmentBlock(new Date("2026-10-24T07:00:00Z"));
    expect(block).toContain("這段對話開始於 2026/10/24");
  });

  it("額外 prompt 原樣放在最前面", () => {
    const s = startAgent({ extra: "# 常駐脈絡\n專做 LP 音響" });
    expect(s.extraSystemPrompt!.startsWith("# 常駐脈絡\n專做 LP 音響")).toBe(true);
  });
});

describe("配方保存與 reattach 重建", () => {
  it("start 會存配方（額外 prompt＋旗標）", () => {
    const s = startAgent({ extra: "EXTRA-123", unattended: true, autoFork: false });
    expect(getSessionPrompt(s.id)).toEqual({ extra: "EXTRA-123", flags: { autoFork: false, unattended: true } });
  });

  it("reattach（server 重啟/閒置回收後喚醒）會用配方重建 system prompt，而不是空的", () => {
    const s = startAgent({ extra: "EXTRA-REATTACH", unattended: true, autoFork: false });
    const id = s.id;
    agentManager.stop(id); // 從記憶體移除，模擬 server 重啟後
    expect(agentManager.get(id)).toBeUndefined();
    const r = agentManager.reattach(id)!;
    expect(r).toBeTruthy();
    expect(r.extraSystemPrompt).toContain("EXTRA-REATTACH");
    expect(r.extraSystemPrompt).toContain("# 工作環境");
    expect(r.extraSystemPrompt!.endsWith(UNATTENDED_TURN_POLICY)).toBe(true);
  });

  it("有 seed builder 的 agent：reattach 用最新產生的內容取代舊配方", () => {
    const agentId = "test-seeded-agent";
    agentManager.registerSeedBuilder(agentId, (ws) => `FRESH-SEED-${ws}`);
    const s = startAgent({ agentId, extra: "OLD-SEED", autoFork: false });
    agentManager.stop(s.id);
    const r = agentManager.reattach(s.id)!;
    expect(r.extraSystemPrompt).toContain("FRESH-SEED-");
    expect(r.extraSystemPrompt).not.toContain("OLD-SEED");
  });
});
