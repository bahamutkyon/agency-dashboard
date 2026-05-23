import { Router } from "express";
import { agentManager } from "../agentManager.js";
import { loadAgents } from "../agentLoader.js";
import {
  listWorkspaces, getWorkspace, createWorkspace, updateWorkspace, deleteWorkspace as removeWorkspace,
  listNotes, upsertNote,
  listTemplates, upsertTemplate,
  listSchedules,
  upsertWorkflow,
  DEFAULT_WORKSPACE_ID,
} from "../store.js";
import { scheduler } from "../scheduler.js";
import { v4 as uuid } from "uuid";

/** Helper: extract workspace id from request query or header */
function ws(req: any): string | undefined {
  const w = req.query?.workspace || req.headers["x-workspace"];
  return w ? String(w) : undefined;
}

// ============================================================
// /api/workspaces
// ============================================================
export const workspacesRouter = Router();

workspacesRouter.get("/", (_req, res) => res.json(listWorkspaces()));

workspacesRouter.post("/", (req, res) => {
  const { name, description, standingContext } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  res.json(createWorkspace({ name, description, standingContext }));
});

workspacesRouter.patch("/:id", (req, res) => {
  const updated = updateWorkspace(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "not found" });
  res.json(updated);
});

workspacesRouter.delete("/:id", (req, res) => {
  if (req.params.id === DEFAULT_WORKSPACE_ID) {
    return res.status(400).json({ error: "預設工作區無法刪除" });
  }
  const ok = removeWorkspace(req.params.id);
  res.json({ ok });
});

// Export — bundle a workspace's metadata + notes + templates + schedules
// (NOT sessions, those are conversation history specific to user) into a
// single JSON file for sharing or backup.
workspacesRouter.get("/:id/export", (req, res) => {
  const w = getWorkspace(req.params.id);
  if (!w) return res.status(404).json({ error: "not found" });
  const bundle = {
    schemaVersion: 1,
    exportedAt: Date.now(),
    workspace: { name: w.name, description: w.description, standingContext: w.standingContext },
    notes: listNotes(w.id).map(({ id: _i, workspaceId: _w, ...rest }) => rest),
    templates: listTemplates(w.id).map(({ id: _i, workspaceId: _w, ...rest }) => rest),
    schedules: listSchedules(w.id).map(({ id: _i, workspaceId: _w, lastRunAt: _l, nextRunAt: _n, ...rest }) => rest),
  };
  res.setHeader("Content-Disposition", `attachment; filename="workspace-${w.name}-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(bundle);
});

// Import — create a new workspace from a JSON bundle. Generates fresh ids
// for everything (so re-importing gives you a separate copy).
workspacesRouter.post("/import", (req, res) => {
  const bundle = req.body;
  if (!bundle?.workspace?.name) return res.status(400).json({ error: "invalid bundle: missing workspace.name" });
  const w = createWorkspace({
    name: bundle.workspace.name,
    description: bundle.workspace.description || "",
    standingContext: bundle.workspace.standingContext || "",
  });
  const now = Date.now();
  let n = 0, t = 0, s = 0;
  for (const note of bundle.notes || []) {
    upsertNote({
      id: uuid(), workspaceId: w.id,
      title: note.title, body: note.body, pinned: !!note.pinned,
      createdAt: now, updatedAt: now,
    });
    n++;
  }
  for (const tpl of bundle.templates || []) {
    upsertTemplate({
      id: uuid(), workspaceId: w.id,
      name: tpl.name, body: tpl.body, agentId: tpl.agentId,
      tags: tpl.tags || [], createdAt: now, updatedAt: now,
    });
    t++;
  }
  for (const sc of bundle.schedules || []) {
    try {
      scheduler.create({
        workspaceId: w.id,
        name: sc.name, agentId: sc.agentId, prompt: sc.prompt, cron: sc.cron,
        enabled: false, // import as paused — user opts in to re-enable
      });
      s++;
    } catch (e) {
      console.warn("[import] schedule skipped:", (e as any).message);
    }
  }
  res.json({ workspaceId: w.id, imported: { notes: n, templates: t, schedules: s } });
});

// ============================================================
// /api/onboarding
// ============================================================
export const onboardingRouter = Router();

// Onboarding — opens a special chat where the orchestrator interviews the
// user about their project and outputs a structured "standing context" memo.
// The frontend detects the marker block in the response and offers a one-click
// "apply to workspace" action.
onboardingRouter.post("/", (req, res) => {
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  const extra = `

# 🚨 重要:你現在是「工作區設定顧問」,不是普通對話 agent

使用者剛剛點了「🤖 AI 訪問我」按鈕,**期望你訪問他、產出工作區備忘錄**,**不是回答他的業務問題本身**。

## 規則(絕對遵守)

1. **不論使用者第一句話是什麼**(就算他問「怎麼做最好」、「教我」、「給我建議」),你**都不要直接回答**。先**禮貌打斷**:「我是工作區設定顧問,先幫你建好專案脈絡,之後你跟其他 agent 對話它們才能對上頻率。我問你幾個問題就好,5 分鐘搞定。」
2. 然後**第一個正式問題**:「請用 1-2 句話描述你這個專案在做什麼?(例如:給上班族的 AI 工具教學自媒體 / 外勞人力仲介 B2B 服務)」
3. 接著用結構化方式訪問,**每次最多 1-2 題**:
   - 業務領域 / 服務類型
   - 目標客群(年齡/職業/痛點/在哪)
   - 品牌語氣 / 差異化
   - 禁用詞 / 紅線
   - 法規與合規要點(若適用)
   - 常用工作流程慣例
4. 大約 5-7 輪後資訊夠了,**輸出最終備忘錄**(格式見下)
5. 寫完後問:「這份草稿可以嗎?需要修改哪裡?」

## 最終備忘錄格式(嚴格遵守,前端會自動偵測)

\`\`\`
=== MEMO START ===
# [專案名稱]

## 業務領域
...

## 目標客群
...

## 品牌語氣 / 風格
...

## 禁用詞 / 紅線
...

## 工作流程慣例
...
=== MEMO END ===
\`\`\`

## 反例(絕對不要這樣做)

❌ 使用者問「自媒體怎麼做才會紅?」→ 你直接給三種做法 + 變現策略 + 建議
✓ 你應該:「我先幫你建好專案脈絡再來規劃。第一題:你這個自媒體想專攻什麼題材?」

❌ 跳過訪問流程直接寫 MEMO
✓ 至少 5 輪對話後才寫

如果使用者一直想跳過訪問,**直接接著問下一題就好**,不要解釋規則。
`;
  const session = agentManager.start(
    "agents-orchestrator",
    "🤖 工作區設定顧問",
    extra,
    wsId,
    false,
  );
  res.json({ id: session.id });
});

// Apply onboarding result — extracts the MEMO block from the latest assistant
// message and updates the target workspace's standing context.
onboardingRouter.post("/apply", (req, res) => {
  const { sessionId, workspaceId, memo } = req.body || {};
  if (!sessionId || !workspaceId || !memo) {
    return res.status(400).json({ error: "sessionId, workspaceId, memo required" });
  }
  const updated = updateWorkspace(workspaceId, { standingContext: String(memo) });
  if (!updated) return res.status(404).json({ error: "workspace not found" });
  res.json(updated);
});

// ============================================================
// /api/workflow
// ============================================================
export const workflowDraftRouter = Router();

// Workflow drafting — orchestrator interviews the user about a recurring
// task and outputs a workflow JSON that the UI auto-detects + lets user
// apply with one click.
workflowDraftRouter.post("/draft", (req, res) => {
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  const allAgents = loadAgents();
  const catalog = allAgents
    .map((a) => `- \`${a.id}\` (${a.category}) — ${a.name}: ${a.description.slice(0, 80)}`)
    .join("\n");

  const extra = `

# 你現在的特殊任務:Workflow 設計顧問(進階版)

使用者想自動化某個重複性流程,你幫他設計一個 **DAG-based workflow**(支援平行 / 暫停 / 條件)。

## 訪問流程

1. 第一句問:「你想自動化什麼工作?例如『每週多平台內容生產』、『新客戶提案完整流程』、『競品深度分析』。」
2. 釐清:
   - 流程的輸入(workflow 起始點是什麼?)與最終產出
   - **中間哪些步驟可以平行進行?**(多個獨立子任務同時跑)
   - 是否有需要人工確認 / 暫停的關鍵節點
   - 是否有條件性步驟(某結果出現才需要某 agent)
3. 從可用團隊中挑最合適的 agent,**設計 4-8 個步驟,主動使用 DAG 平行**
4. 輸出最終 workflow

## 輸出格式(嚴格遵守)

\`\`\`workflow
{
  "name": "簡潔的 workflow 名稱",
  "description": "一句話描述用途",
  "maxConcurrency": 2,
  "steps": [
    {
      "id": "research",
      "agentId": "marketing-trend-researcher",
      "prompt": "第一步指令,可用 {{out}} 引用 workflow 起始輸入"
    },
    {
      "id": "ig_version",
      "agentId": "marketing-content-creator",
      "dependsOn": ["research"],
      "prompt": "把以下找到的選題改編成 IG 貼文:\\n\\n{{research.out}}"
    },
    {
      "id": "rednote_version",
      "agentId": "marketing-content-creator",
      "dependsOn": ["research"],
      "prompt": "把以下找到的選題改編成小紅書筆記:\\n\\n{{research.out}}"
    },
    {
      "id": "review",
      "agentId": "design-brand-guardian",
      "dependsOn": ["ig_version", "rednote_version"],
      "pauseBefore": true,
      "prompt": "請審以下兩平台內容:\\n\\nIG:{{ig_version.out}}\\n\\n小紅書:{{rednote_version.out}}"
    }
  ]
}
\`\`\`

## 設計規則(重要)

1. **每個 step 都要有 id**(唯一,小寫 + 底線,例:research / ig_version / final_review)
2. **主動找平行機會**:獨立的子任務(多平台改編、多角度分析、不同部門 brief)→ 一定要 dependsOn 同樣的上游,不要寫成直線
3. **{{stepId.out}}** 引用任意上游的輸出;**{{out}}** 取最後依賴的輸出(直線時用)
4. **dependsOnMode: "any"** 適合「賽跑」場景(多個 agent 同時嘗試,先出結果就用),預設是 "all"
5. **pauseBefore: true** 在關鍵節點(發布前、合約前、決策前)插入,讓使用者批准
6. **skipIfMatch: "regex"** 條件跳過(上一步輸出符合則跳過此步)
7. **maxConcurrency**:多平台/多面向同跑可設 3-4;一般 2
8. step 數 **4-8 步最佳**;前 1-2 步是研究/輸入,中段平行展開,最後合併/審稿
9. agentId **必須來自下方清單,完全一致**;prompt 用**繁體中文**

## 設計典範(快速啟發)

- **多平台內容**:research → ig + rednote + threads(平行)→ brand_review
- **競品分析**:intel → market + tech + finance(平行)→ synthesis
- **客戶提案**:intake → research → draft(pause)→ legal + finance(平行)→ final
- **內容發佈前審查**:author → fact + brand + legal + seo(平行)→ consolidate(pause)
- **CEO 多部門委派**:plan → product + marketing + finance(平行)→ ceo_review(pause)

## 任務完成後

寫完後告訴使用者:「我產出了 workflow 草稿(N 步,其中 X 個並行)。對話頂部會跳出綠色按鈕「套用為 Workflow」一鍵建立。」

## 可用團隊
${catalog}
`;
  const session = agentManager.start(
    "agents-orchestrator",
    "🔗 Workflow 設計顧問",
    extra,
    wsId,
    false,
  );
  res.json({ id: session.id });
});

// Apply workflow draft — extract the JSON block from a session's latest
// assistant message and create the workflow in the target workspace.
workflowDraftRouter.post("/draft/apply", (req, res) => {
  const { sessionId, workspaceId, workflow } = req.body || {};
  if (!sessionId || !workspaceId || !workflow?.name || !Array.isArray(workflow?.steps)) {
    return res.status(400).json({ error: "sessionId, workspaceId, workflow{name, steps[]} required" });
  }
  // validate agentIds exist
  const allAgents = loadAgents();
  const validIds = new Set(allAgents.map((a) => a.id));
  for (const s of workflow.steps) {
    if (!s.agentId || !validIds.has(s.agentId)) {
      return res.status(400).json({ error: `unknown agentId: ${s.agentId}` });
    }
    if (!s.prompt) return res.status(400).json({ error: "step missing prompt" });
  }
  const now = Date.now();
  const wf = {
    id: uuid(),
    workspaceId,
    name: workflow.name,
    description: workflow.description || "",
    steps: workflow.steps.map((s: any) => ({ agentId: s.agentId, prompt: s.prompt })),
    createdAt: now,
    updatedAt: now,
  };
  upsertWorkflow(wf);
  res.json(wf);
});
