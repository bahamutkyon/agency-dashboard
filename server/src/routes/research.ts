/**
 * 主題研究路由 —— 非同步：POST 立即回 runId，背景跑多階段研究，socket 推進度
 * （research:progress）。GET /:id 查狀態/結果。
 *
 * 為何非同步：一趟研究含規劃 + 數個帶 web 工具的子研究 + 綜合，會花數分鐘，
 * 同步 HTTP 會逾時。故立即回 runId，前端靠 socket + polling 追蹤。
 *
 * 測試環境（VITEST）注入 fake 三階段函式（回固定值），不打真 LLM、跑得飛快，
 * 比照 routes/cockpit.ts 的 testDeps 模式。存 note 仍走真 saveResearchNote，
 * 以端到端驗證 workspaceId 正確落庫。
 */
import { Router } from "express";
import { runTopicResearch, type ResearchResult, type ResearchDeps } from "../researchRunner.js";
import { DEFAULT_WORKSPACE_ID } from "../store.js";

export const researchRouter = Router();

interface ResearchRun {
  id: string;
  workspaceId: string;
  question: string;
  status: "running" | "done" | "error";
  stage: string;
  total: number;
  done: number;
  result?: ResearchResult;
  error?: string;
  createdAt: number;
}

// in-memory run 狀態。研究是即時觸發、可 socket + polling 追蹤的一次性工作，
// 不像能力學習 run 需要斷點續跑，故不落 DB（簡化；重啟丟失在途 run 可接受）。
const runs = new Map<string, ResearchRun>();
const RUN_TTL_MS = 30 * 60 * 1000; // 完成後保留 30 分鐘供查詢

// 測試環境用 fake 三階段（回固定值），避免打真 LLM。saveNote 不覆蓋 → 走真庫。
const testDeps: Partial<ResearchDeps> | undefined = process.env.VITEST
  ? {
      plan: async (q: string) => [`${q}：子題1`, `${q}：子題2`],
      research: async (sq: string) => ({
        findings: `對「${sq}」的模擬發現`,
        sources: [`https://example.com/${encodeURIComponent(sq)}`],
        confidence: "medium",
      }),
      synthesize: async (q: string) => `針對「${q}」的模擬綜合結論。`,
    }
  : undefined;

// POST /api/research —— 啟動一趟研究，立即回 runId，背景執行。
researchRouter.post("/", (req, res) => {
  const workspaceId = String(
    req.body?.workspaceId || req.query?.workspaceId || DEFAULT_WORKSPACE_ID,
  );
  const question = String(req.body?.question || req.query?.question || "").trim();
  if (!question) return res.status(400).json({ error: "question 不可為空" });

  const run: ResearchRun = {
    id: `research_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    question,
    status: "running",
    stage: "planning",
    total: 0,
    done: 0,
    createdAt: Date.now(),
  };
  runs.set(run.id, run);
  res.json({ runId: run.id });

  const io = req.app.get("io");
  const emit = () =>
    io?.emit?.("research:progress", {
      runId: run.id,
      status: run.status,
      stage: run.stage,
      total: run.total,
      done: run.done,
    });

  const deps: Partial<ResearchDeps> = {
    ...(testDeps || {}),
    onProgress: (p) => {
      run.stage = p.stage;
      run.total = p.total;
      run.done = p.done;
      emit();
    },
  };

  // 背景執行，不阻塞回應。
  runTopicResearch({ workspaceId, question }, deps)
    .then((result) => {
      run.status = "done";
      run.stage = "done";
      run.result = result;
      run.done = run.total;
      emit();
    })
    .catch((e: any) => {
      run.status = "error";
      run.stage = "error";
      run.error = e?.message || String(e);
      emit();
      console.warn("[research] run failed:", e?.message || e);
    })
    .finally(() => {
      setTimeout(() => runs.delete(run.id), RUN_TTL_MS).unref?.();
    });
});

// GET /api/research/:id —— 查詢 run 狀態/結果。
researchRouter.get("/:id", (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).json({ error: "找不到 run" });
  res.json(run);
});
