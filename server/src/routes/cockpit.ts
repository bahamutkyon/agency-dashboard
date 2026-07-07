import { Router } from "express";
import { getLatestBriefing, getLatestOkBriefing } from "../cockpitStore.js";
import { runCockpit } from "../cockpitGenerator.js";
import { sanitizeBriefingRow } from "../cockpitSanitize.js";
import { listPendingProposals } from "../learningStore.js";
import type { BriefingRow } from "../cockpitTypes.js";

export const cockpitRouter = Router();

const REFRESH_THROTTLE_MS = 10 * 60 * 1000;

// 測試環境用假 agent，避免打真 LLM
const testDeps = process.env.VITEST
  ? { runAgent: async () => '```json\n{"sections":[{"kind":"status","title":"近況","items":[{"title":"t","body":"b"}]}]}\n```' }
  : undefined;

// 回傳前過濾掉已批准/駁回的建議 item（簡報是靜態快照，提案狀態會在存檔後改變）
function sanitize(row: BriefingRow | null): BriefingRow | null {
  if (!row?.content) return row;
  const pending = new Set(listPendingProposals().map((p) => p.id));
  return sanitizeBriefingRow(row, pending);
}

// GET：回最近成功簡報；若最新一筆是失敗，附 lastError 讓前端顯示註記但不蓋掉好簡報
cockpitRouter.get("/", (_req, res) => {
  const latest = getLatestBriefing();
  const ok = latest && latest.status === "ok" ? latest : getLatestOkBriefing();
  const lastError = latest && latest.status !== "ok"
    ? { status: latest.status, raw: latest.raw, at: latest.createdAt } : undefined;
  res.json({ briefing: sanitize(ok), lastError });
});

// refresh 節流：只以「最近成功簡報」為基準（error 不觸發鎖定，允許立即重試）
cockpitRouter.post("/refresh", async (_req, res) => {
  const lastOk = getLatestOkBriefing();
  if (lastOk && Date.now() - lastOk.createdAt < REFRESH_THROTTLE_MS) {
    return res.json({ ok: true, throttled: true, briefing: sanitize(lastOk) });
  }
  const row = await runCockpit("manual", testDeps as any);
  const briefing = row.status === "ok" ? row : (getLatestOkBriefing() ?? row);
  res.json({
    ok: true,
    briefing: sanitize(briefing),
    error: row.status !== "ok" ? { status: row.status, raw: row.raw } : undefined,
  });
});
