/**
 * session 的 system prompt 配方（見 dbSchema 的 session_prompts）。
 *
 * 為什麼要存：Claude Code 在對話第一個請求時把 system prompt 記錄下來，之後 --resume 會沿用，
 * 但「對話被壓縮後」會改用當次啟動帶的 flags 重建。dashboard 舊版 reattach（server 重啟或閒置回收後
 * 喚醒對話）不帶 --append-system-prompt-file，所以長對話一旦壓縮，工作區記憶、同事記憶、學習成果、
 * 專案經理的派工手冊就從 system prompt 消失。存下配方，reattach 時就能重建同一份（並帶入最新記憶）。
 */
import { db } from "../db.js";

export interface SessionPromptFlags {
  autoFork?: boolean;
  unattended?: boolean;
}

export interface SessionPromptRecipe {
  extra: string;
  flags: SessionPromptFlags;
}

export function saveSessionPrompt(sessionId: string, recipe: SessionPromptRecipe): void {
  db.prepare(`
    INSERT INTO session_prompts (session_id, extra, flags, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET extra = excluded.extra, flags = excluded.flags, updated_at = excluded.updated_at
  `).run(sessionId, recipe.extra || "", JSON.stringify(recipe.flags || {}), Date.now());
}

export function getSessionPrompt(sessionId: string): SessionPromptRecipe | null {
  const r = db.prepare("SELECT extra, flags FROM session_prompts WHERE session_id = ?").get(sessionId) as
    | { extra: string; flags: string }
    | undefined;
  if (!r) return null;
  let flags: SessionPromptFlags = {};
  try { flags = JSON.parse(r.flags || "{}") || {}; } catch { flags = {}; }
  return { extra: r.extra || "", flags };
}
