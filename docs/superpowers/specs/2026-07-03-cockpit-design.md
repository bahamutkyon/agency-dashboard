# 總管駕駛艙（Cockpit）設計規格

- 日期：2026-07-03
- 狀態：設計已與使用者確認，待寫實作計畫
- 相關：跨工作區記憶隔離（`workspaceDir.ts` 沙箱移 repo 外）、通用 Scheduler（`scheduler.ts`）、能力學習（`routes/learning.ts`）、派工（`dispatchRunner.ts`）

## 1. 背景與問題

目前 dashboard 是**被動**的：排程會定時產出週報、學習會產出待審提案，但這些都靜靜躺在各工作區的歷史 / 審核佇列裡，使用者要**自己記得去翻**。使用者回饋「有時候太被動、突然不知道要做什麼、也不知道最近有什麼新項目該討論」。

需求：一個**主動、在 dashboard 內**（不接 Telegram/LINE）的「總管顧問」，每天主動把「該看、該拍板、該討論」的事迎面攤在使用者面前，並且能就任一項**展開討論**、當場處理。

## 2. 目標 / 非目標

**目標（MVP）**
- 每天固定時間生成一份**跨所有工作區**的「今日總管簡報」，由一位幕僚長 agent 產出（有觀點、會 triage，不只是列清單）。
- dashboard 預設落地畫面 = 駕駛艙，簡報迎面而來。
- 簡報四大區塊，每項可「展開討論」、部分可「一鍵處理」：
  - 🔴 待你拍板
  - 🆕 我建議討論的新項目
  - 📋 各事業一句話近況 + 本週重點
  - 🎓 學習 & 記憶治理（含提案 triage 建議 + 一鍵批准/駁回）
- 手動「🔄 再想一次」可即時重生。

**非目標（YAGNI，之後再說）**
- 任何外部推播（Telegram / LINE / web push）。
- 主動 nudge（「你三天沒動個人IP」）、複雜優先級評分。
- 雙向外部對話。

## 3. 使用者流程

1. 早上 07:00（Asia/Taipei，固定）系統自動生成當日簡報。
2. 使用者打開 dashboard → 預設進「🧭 駕駛艙」→ 看到今日簡報。
3. 對任一項按「💬 展開討論」→ 切到該項所屬工作區、開一個帶脈絡的新對話，跟該工作區 PM 聊；跨事業/學習類的項目則跟幕僚長聊。
4. 🎓 區塊：幕僚長已 triage 好待審提案（建議批准哪些、駁回哪些+理由）→ 使用者可「照建議處理」一鍵套用，或先展開討論辯完再處理。
5. 想立刻刷新 → 按「🔄 再想一次」。

## 4. 架構與資料流

```
每日 cron(07:00 Asia/Taipei) ┐
手動 POST /api/cockpit/refresh ┘─→ cockpitGenerator.run()
    1) cockpitContext.build()  ── server 端「受控」組跨工作區資料包：
         各工作區：name + 記憶摘要 + 最近排程週報重點 + 從週報擷取的待拍板事項
         全局：pending 學習提案(含 id/agent/內容) + 近期活動 + 卡太久的 open-topics
    2) 跑幕僚長 agent（隔離的 cockpit context，全部脈絡由資料包注入）
         → 產出結構化簡報 JSON（見 §6 schema）
    3) 解析 + 存 DB（cockpit_briefings，含日期）；解析失敗則存 raw + 標記
前端「🧭 駕駛艙」view ─→ GET /api/cockpit（最新簡報）→ 渲染四區塊
    「展開討論」→ 切工作區 + 開帶脈絡 session
    「照建議處理」→ 呼叫既有 /api/learning/proposals/bulk-approve|reject
```

**跨工作區資料存取的隔離考量（重要）**：跨工作區資料是**server 端主動、受控地組包**後餵給幕僚長，**不是**讓 agent 自己去爬各工作區沙箱。幕僚長本身跑在**獨立的 cockpit context**（repo 外、無任何單一事業記憶的沙箱），一切靠注入的資料包推理。這樣既有全局視角、又不破壞既有的工作區記憶隔離——這是「使用者本人的駕駛艙」這個被授權的綜觀角色，與會服務客戶場景的工作區 agent 分離。

## 5. 新增元件

**Server**
- `cockpitContext.ts` — `build(): CockpitContextPack`，從 DB + 各工作區記憶檔組跨工作區資料包（純資料彙整，不含 LLM）。
- `cockpitGenerator.ts` — `run(trigger): Promise<Briefing>`，組包 → 跑幕僚長 → 解析 → 存檔；掛 socket 進度。
- `cockpitScheduler`（比照 `learningScheduler.ts`）— 註冊每日 07:00 cron 觸發 `cockpitGenerator.run("daily")`。
- `routes/cockpit.ts` — `GET /api/cockpit`（回最新簡報 + 產生時間）、`POST /api/cockpit/refresh`（手動重生，若上次 <10 分鐘內則回既有並提示）。

**DB**
- `cockpit_briefings` 表：`id, date(YYYY-MM-DD), content_json, raw, status('ok'|'parse_failed'|'error'), created_at`。

**Client**
- `CockpitPanel.tsx` — 設為預設落地 view；渲染四區塊、每項 discuss/act 鈕、頂部「上次更新時間」+「🔄 再想一次」。
- App.tsx：預設 `view` 改為 cockpit；左側新增「🧭 駕駛艙」入口。

## 6. 簡報資料結構（schema）

```
Briefing {
  date: string,
  generatedAt: number,
  sections: Section[]
}
Section {
  kind: "decisions" | "new_items" | "status" | "learning",
  title: string,
  items: Item[]
}
Item {
  title: string,
  body: string,                 // 幕僚長的說明/建議（markdown）
  workspaceId?: string,         // 有 = 展開討論切到該工作區的 PM；無 = 跟幕僚長聊
  discussSeed?: string,         // 展開討論時預填的脈絡 prompt
  action?: {                    // 僅 learning 區塊才有
    type: "approve" | "reject",
    proposalIds: string[]       // 供「照建議處理」呼叫 bulk-approve|reject
  }
}
```

幕僚長被要求輸出一段 fenced ```json 符合上述 schema；generator 擷取解析。解析失敗 → 存 raw、status=parse_failed、前端顯示 raw markdown 並提示「格式待修」，不留白。

## 7. 學習治理 triage

- `cockpitContext` 會把所有 pending 提案（id / agent / kind / 內容）放進資料包。
- 幕僚長依既有判準 triage（例如：貼合實際用途的內容手藝→建議批准；與使用者用途不符的→建議駁回），把建議寫進 `learning` 區塊的 `action`。
- 前端「照建議處理」→ 依 `action.type` 呼叫既有 `/api/learning/proposals/bulk-approve`（可帶 asScope）或 `bulk-reject`，成功後從簡報移除該項並提示。
- 使用者可先「展開討論」跟幕僚長辯，再決定要不要照建議處理。

## 8. 錯誤處理

- generator 失敗（agent 逾時/錯誤/解析失敗）→ **保留上一份簡報**，前端顯示上次更新時間 + 錯誤註記，不留白。
- 某工作區無資料 → 略過該工作區，不報錯。
- 手動 refresh 節流：距上次 <10 分鐘 → 直接回既有簡報並提示，避免重複燒 token。
- bulk-approve/reject 部分失敗 → 回報成功/失敗筆數，簡報只移除成功處理的。

## 9. 測試策略

- `cockpitContext.build`：單元測試，用假 DB/記憶資料驗證資料包組出正確欄位、空工作區被略過。
- `cockpit_briefings` 存取：store 測試。
- `cockpitGenerator`：注入假 agent runner（比照 `dispatchRunner.test.ts`），驗證解析成功/失敗兩路徑、失敗時保留上一份。
- 路由 `GET/POST /api/cockpit`：比照 `app.test.ts` 用 ephemeral port + fetch。
- schema 解析：合法 JSON、含雜訊的 JSON、非 JSON 三種輸入。

## 10. 開放問題

- 幕僚長 triage 的判準是否要可設定（目前先硬編既有邏輯，之後可抽成設定）。
- 「各事業近況」是否要引用當日排程週報（若當天沒跑排程則用最近一份）——MVP 用「最近一份」。
