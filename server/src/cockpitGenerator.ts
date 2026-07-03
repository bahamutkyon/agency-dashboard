import { agentManager } from "./agentManager.js";
import { getWorkspace, createWorkspace } from "./store.js";
import { buildCockpitContext } from "./cockpitContext.js";
import { parseBriefing } from "./cockpitParser.js";
import { saveBriefing } from "./cockpitStore.js";
import type { CockpitContextPack, BriefingRow } from "./cockpitTypes.js";

// 隔離沙箱：幕僚長 agent 跑在這個固定 id 的隱藏工作區（repo 外、記憶為空），
// 一切脈絡靠注入的資料包，不繼承任何單一事業工作區的記憶。
export const COCKPIT_WORKSPACE_ID = "__cockpit__";
// 幕僚長 agent id（~/.claude/agents/specialized-chief-of-staff.md）。
export const COCKPIT_AGENT_ID = "specialized-chief-of-staff";

function ensureCockpitWorkspace(): void {
  if (!getWorkspace(COCKPIT_WORKSPACE_ID)) {
    createWorkspace({ name: "（總管駕駛艙）", id: COCKPIT_WORKSPACE_ID });
  }
}

function buildPrompt(pack: CockpitContextPack): string {
  return `你是使用者的幕僚長。以下是今天各事業與學習系統的現況資料包（由系統彙整，不需你再去查）。請綜觀全局，產出一份「今日總管簡報」。

# 資料包
${JSON.stringify(pack, null, 2)}

# 輸出要求
在回覆最後輸出一段 \`\`\`json，符合結構（sections 每項 kind 從 decisions/new_items/status/learning 四選一）：
{
  "sections": [
    { "kind": "decisions", "title": "🔴 待你拍板", "items": [ { "title": "...", "body": "你的說明與建議", "workspaceId": "對應工作區id", "discussSeed": "展開討論時要接續的一句脈絡" } ] },
    { "kind": "new_items", "title": "🆕 我建議討論的新項目", "items": [ ... ] },
    { "kind": "status", "title": "📋 各事業近況 + 本週重點", "items": [ ... ] },
    { "kind": "learning", "title": "🎓 學習 & 記憶治理", "items": [ { "title": "本週提案 triage", "body": "建議批准/駁回哪些+理由", "action": { "type": "approve", "proposalIds": ["..."] } } ] }
  ]
}
規則：learning 區塊要就資料包 pendingProposals 給 triage 建議，建議批准的 id 放進 type=approve 的 action、建議駁回的放 type=reject（可拆兩個 item）。貼合使用者實際業務用途的內容手藝建議批准；與用途不符（如純軟體開發流水線手藝）建議駁回。沒有待處理項目的區塊就不要放。`;
}

async function defaultRunAgent(prompt: string): Promise<string> {
  ensureCockpitWorkspace();
  return new Promise<string>((resolve) => {
    const session = agentManager.start(COCKPIT_AGENT_ID, "🧭 產生總管簡報", undefined, COCKPIT_WORKSPACE_ID, false);
    let collected = "", streamed = "", settled = false;
    const done = (v: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      session.removeListener("event", onEvent);
      resolve(v);
    };
    const onEvent = (evt: any) => {
      if (evt.type === "delta" && typeof evt.payload === "string") streamed += evt.payload;
      else if (evt.type === "message" && evt.payload?.content) collected = String(evt.payload.content);
      else if (evt.type === "result") done((collected || streamed).trim());
    };
    const t = setTimeout(() => done((collected || streamed).trim()), 5 * 60 * 1000);
    session.on("event", onEvent);
    agentManager.send(session.id, prompt);
  });
}

export interface CockpitDeps { runAgent: (prompt: string) => Promise<string>; }

/**
 * 組包 → 跑幕僚長 agent → 解析 → 存。
 * trigger 目前僅語意用途（daily/manual），保留給之後排程/路由使用。
 * runAgent 可注入（測試不打真 LLM），預設走 agentManager（隔離沙箱工作區）。
 * 永不 throw：任何失敗（含 runAgent 拋錯）都存成 status=error。
 */
export async function runCockpit(
  trigger: "daily" | "manual",
  deps: CockpitDeps = { runAgent: defaultRunAgent },
): Promise<BriefingRow> {
  const date = new Date().toISOString().slice(0, 10);
  const generatedAt = Date.now();
  try {
    const pack = buildCockpitContext();
    const raw = await deps.runAgent(buildPrompt(pack));
    const { status, briefing } = parseBriefing(raw, date, generatedAt);
    return saveBriefing({ date, content: briefing, raw, status });
  } catch (e: any) {
    return saveBriefing({ date, content: null, raw: String(e?.message || e), status: "error" });
  }
}
