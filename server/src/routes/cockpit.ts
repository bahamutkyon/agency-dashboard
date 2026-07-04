import { Router } from "express";
import { getLatestBriefing } from "../cockpitStore.js";
import { runCockpit } from "../cockpitGenerator.js";

export const cockpitRouter = Router();

const REFRESH_THROTTLE_MS = 10 * 60 * 1000;

// 測試環境用假 agent，避免打真 LLM
const testDeps = process.env.VITEST
  ? { runAgent: async () => '```json\n{"sections":[{"kind":"status","title":"近況","items":[{"title":"t","body":"b"}]}]}\n```' }
  : undefined;

cockpitRouter.get("/", (_req, res) => {
  const row = getLatestBriefing();
  res.json({ briefing: row });
});

cockpitRouter.post("/refresh", async (_req, res) => {
  const latest = getLatestBriefing();
  if (latest && Date.now() - latest.createdAt < REFRESH_THROTTLE_MS) {
    return res.json({ ok: true, throttled: true, briefing: latest });
  }
  const row = await runCockpit("manual", testDeps as any);
  res.json({ ok: true, briefing: row });
});
