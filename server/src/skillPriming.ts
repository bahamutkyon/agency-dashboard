/**
 * Skill priming — 啟動 agent session 時告訴 LLM「你應該特別善用這些 skill」。
 *
 * 來源:`agent-skill-map.json`(repo 根目錄,由 scripts/build-agent-skill-map.mjs
 * 用 Haiku 一次性產生並 commit)。
 *
 * 原理:Claude Code 預設把所有 ~/.claude/skills/ 列在 system prompt 中讓 agent
 * 「知道有這些可用」,但 agent 不一定會主動觸發。我們從每個 agent 的人設推導
 * 出 3-5 個最相關的 skill,在 system prompt 開頭明確點名,顯著提升觸發率。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_PATH = path.resolve(__dirname, "..", "..", "agent-skill-map.json");

interface SkillEntry {
  id: string;
  why: string;
}

interface MapFile {
  generated_at: string;
  skill_count: number;
  agent_count: number;
  agents: Record<string, { skills: SkillEntry[] }>;
}

let cached: MapFile | null = null;
let cachedMtime = 0;

function load(): MapFile | null {
  if (!fs.existsSync(MAP_PATH)) return null;
  try {
    const stat = fs.statSync(MAP_PATH);
    if (cached && stat.mtimeMs === cachedMtime) return cached;
    const raw = fs.readFileSync(MAP_PATH, "utf8");
    cached = JSON.parse(raw);
    cachedMtime = stat.mtimeMs;
    return cached;
  } catch (e) {
    console.warn("[skillPriming] failed to load map:", (e as Error).message);
    return null;
  }
}

export function buildSkillPrimingBlock(agentId: string): string {
  const map = load();
  if (!map) return "";
  const entry = map.agents[agentId];
  if (!entry || !entry.skills || entry.skills.length === 0) return "";
  const lines = entry.skills.map((s) => `- **${s.id}** — ${s.why}`).join("\n");
  return `\n\n# 你應該特別善用的 Skills(從全域 21 個 skill 中精選)
以下這幾個 skill 跟你的職責 / 領域**特別契合**,遇到對應情境時請主動啟用。
全部 21 個 skill 你仍然都可用,只是這幾個是你的「主要工具」。

${lines}
`;
}

/** Debug helper — list all primed agents */
export function getPrimingStats(): { mapped: number; total_skill_refs: number } {
  const map = load();
  if (!map) return { mapped: 0, total_skill_refs: 0 };
  let refs = 0;
  for (const a of Object.values(map.agents)) refs += a.skills?.length || 0;
  return { mapped: Object.keys(map.agents).length, total_skill_refs: refs };
}
