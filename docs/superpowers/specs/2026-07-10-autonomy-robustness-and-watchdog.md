# 自主性強化：無人值守強韌性地基 + 常駐看守任務

- 狀態：設計已確認（使用者選「① + ② 一條龍打通」，2026-07-10）。直接進入實作到綠。
- 範圍：agency-dashboard（server + client + DB）
- 背景：往 OpenClaw / Hermes 式「丟個目標自己持續做」推進。來源＝2026-07-10 兩份 Fable 前瞻評估（功能軸 + 強韌性軸）交叉出的結論。
- 對標路線圖：`2026-06-16-autonomy-roadmap.md`。本輪＝把階段一自走做到「無人值守跑得住」（強韌性地基）＋落地階段二本體（常駐看守）。

## 核心依賴（為何強韌性必須先做）

Fable A 的旗艦功能「常駐看守任務」＝讓 PM 真正無人值守跑。Fable B 明確結論：**「第一梯隊四項（F1–F4）修完之前，不建議把 balanced 自走放到真正無人值守跑隔夜。」** 故序：批次①（F1–F4）→ 批次②（常駐看守 + D1 + G1）。

---

## 批次① 強韌性地基（branch `feat/autonomy-robustness`）

> 全部附 Fable B 查證的 file:line（2026-07-10 main=1af30e7 為基準，實作時以現碼為準）。

### F1 — 瞬時錯誤 = 整個 run 永久死亡（🔴 最優先）
- **現況**：`agentSession.ts:324-326` 每個 stderr chunk 都 emit `error`；`routes/autonomy.ts:45-49` sendTurn onEvent 見非 busy 的 error 就 `fail()` → `autonomyRunner.ts:209-212` `finalize(error)`。`resumeRun` 只認 `status==="paused"`（`autonomyRunner.ts:333`）→ error run 無續跑路徑。PM 回合不走 backgroundLimiter（`backgroundLimiter.ts:16-17`），rate-limit 期間照打 → 超 `SEND_TURN_TIMEOUT_MS`(6min, `routes/autonomy.ts:24`) → run 死。**rate-limit 風暴 = 自走團滅**。
- **修法**：sendTurn 錯誤分類——timeout / busy / rate-limit（暫時性）→ 轉 `paused` + loop 層自動重試 2–3 次（指數退避）；真錯（明確失敗）才 `error`。`resumeRun` 放寬接受 error 狀態。
- **順修 F11**：`autonomyRunner.ts:191-194` `clearPendingInjection` 在 sendTurn 前執行，該回合拋錯則插話蒸發 → 移到成功後再清，或失敗時保留。
- **驗收**：模擬 stderr 雜訊 / 逾時 / rate-limit 事件，run 不進 error 而是重試後續跑；重試上限用盡才 error；插話在失敗回合不遺失。量級 0.5–1 天。

### F2 — tsx watch / 重啟 = 自走全轉 paused 無自動續跑；預算時鐘停機照扣（🔴）
- **現況**：`index.ts:332` `pauseRunningRunsOnBoot` 全 active→paused、pending superseded（`autonomyRunner.ts:320-329`）；`resumeRun` 唯一呼叫點是 HTTP route（`routes/autonomy.ts:138`）→ 無自動 resume。預算跨重啟**不歸零**（`deadline_at` 絕對時戳，`store/autonomy.ts:41`；step_count 持久化），問題是**停機期間時鐘照走** → resume 秒死 `budget_exhausted`（`autonomyRunner.ts:84`）。
- **修法**：(a) boot 自動 resume 非 `paused_for_input` 的 paused run（env opt-in，如 `AUTONOMY_AUTO_RESUME`）；(b) resume 時把停機時長展延進 deadline（或 wall-budget 改累計消耗制）；(c) 加 `resume_count` 上限欄位，防重啟迴圈裡壞 run 反覆自動重跑。
- **驗收**：模擬 boot，active run 自動續跑；停機 N 分鐘後 deadline 對應後延；resume 次數達上限則停在 paused 等人。量級 1–2 天。

### F3 — execute 同步逾時 → 子代理照跑、台帳記 failed、PM 被教重派 → 重複副作用（🔴）
- **現況**：自走 execute 同步等 10 分鐘（`routes/autonomy.ts:23`）；`dispatchRunner.ts:204,211` 逾時不回收子程序（交 TTL）→ 副作用續跑；`ledgerFinish` 以 `ok:status==="ok"` 記 failed（`:264-268`）；dispatchGuide 教 PM「首選退回重做」（`sessions.ts:417`）→ LLM 層重派 = 同件做兩次（重複上架/發文/下單）。逾時子 session 之後真完成也沒補記台帳。
- **修法（二選一，傾向殺乾淨）**：
  - (A) 逾時直接 `stop()` 殺子程序，回饋 note 語意誠實標「已中止、未完成」；或
  - (B) 保留但回饋 note 明示「⚠️ 該同事仍在執行中，禁止立即重派同一任務；先等台帳更新」＋掛完成監聽補寫台帳。
  - 決策：**採 (A) 殺乾淨**——風險較低、語意最誠實、避免重複副作用；除非實作發現深聊接手需求（本路徑無）。
- **順修 F6**：子程序 crash（close code≠0）只 emit `status:error` 無 result（`agentSession.ts:341-344`），dispatch waiter 只認 delta/message/result（`dispatchRunner.ts:115-119`）→ 呆等滿逾時才記 timeout、且被分進「不重試」桶。修：onEvent 加 `status` 監聽，見 error/closed → `finish("error")` 讓既有重試接手（`dispatchRunner.retry.test.ts` 骨架現成）。
- **驗收**：execute 逾時後子程序確實被殺（或明確標仍在跑禁重派）；crash 立即歸類 error 並觸發重試而非白等。量級 0.5–1.5 天。

### F4 — 失控 busy 子代理無硬殺開關；timeout 後 limiter 低估併發（🔴）
- **現況**：`reclaimSubprocess` 只收 idle（`agentManager.ts:241`）；execute 30 分硬逾時只還槽不殺（`dispatchRunner.ts:353-354`）、scheduler 30 分保底同樣（`scheduler.ts:150-151`）→ 工具無限迴圈子 agent 可連跑數小時燒額度無人殺。consult/execute 逾時後槽已釋放程序還在 → 實際併發可超 `BG_CONCURRENCY`，`backgroundLimiterStats` 看不到影子程序。
- **修法**：busy watchdog——busy 連續 > 閾值（如 45 分）→ `stop()`（`--resume` 恢復無感）；**誤殺防護**：僅殺「無前端 observer / 非使用者深聊」的 session。limiter 統計加「已還槽仍存活」影子計數並經 `/api/system/limiter` 曝光。
- **驗收**：模擬 busy 超閾值→被 stop；有 observer 的深聊 session 不被殺；影子計數正確。量級 1 天。

### 批次① 非目標
- F5/F7/F8/F9/F10/F12/F13 屬第二三梯隊，本批不做（除 F6 併入 F3、F11 併入 F1）。

---

## 批次② 常駐看守 + 快贏（branch `feat/persistent-watchdog`，依賴①）

### 缺口A — 常駐看守任務（階段二本體）⭐
- **為何**：現在自走只能 UI 手動起（`routes/autonomy.ts:100-111`），cron 只是無條件送一次 prompt 無判斷層（`scheduler.ts:107-155`），且排程 session 不是 PM（dispatchGuide+catalog 只在 `POST /orchestrator` 注入）。缺「醒來→查狀態→判斷→才動手」。
- **要做**：看守任務實體（DB 表 + store + routes + scheduler + 前端面板/日誌）：
  1. cron 觸發 → 組**狀態包**（該工作區 active goals + open outcomes + 在途/失敗 delegations + 上次看守結論）。
  2. 跑**便宜評估回合**（haiku/sonnet，一次性或短 session）：「有沒有值得動手的事？」輸出結構化判斷。
  3. 判定值得 → 升級成帶 **balanced 政策 + 預算**的 autonomy run（複用 `startRun`，吃批次① F1–F4 的護欄）。
  4. 結束寫**看守日誌** + Telegram 推播。
  - **護欄**：overlap guard（仿 `learningScheduler.ts:16-17,52-55` running set）、每日看守額度上限、quiet hours。
- **驗收**：cron fire→組包→評估→（有事才）起 balanced run→日誌+推播；重疊被擋；額度/quiet hours 生效；無事時零昂貴動作。

#### 缺口A 具體設計決策（2026-07-10 鎖定，實作照此，別重新發明）

**DB（`dbSchema.ts` BASE_SCHEMA 加表 + migration idempotent）**
- `watchtower_tasks`：`id TEXT PK`、`workspace_id TEXT`、`name TEXT`、`cron TEXT`（Asia/Taipei）、`enabled INTEGER DEFAULT 1`、`quiet_hours TEXT`（如 `"22-8"`，空=無）、`daily_quota INTEGER DEFAULT 3`（每日最多升級成 run 的次數）、`last_fired_at INTEGER`、`last_conclusion TEXT`、`created_at`、`updated_at`。
- `watchtower_logs`：`id TEXT PK`、`task_id TEXT`、`workspace_id TEXT`、`fired_at INTEGER`、`decision TEXT`（`act`/`skip`/`quiet`/`quota`/`overlap`/`error`）、`reason TEXT`、`run_id TEXT`（升級成 autonomy run 時綁定，否則 null）、`created_at`。

**store（`store/watchtower.ts`）**：CRUD tasks、`listEnabledTasks()`、`appendLog()`、`countActsToday(taskId, now)`（讀 logs 算今日 decision=act 次數，比對 daily_quota）、`updateLastFired/Conclusion`。工作區隔離：所有查詢帶 workspace_id。

**scheduler（`watchtowerScheduler.ts`，對齊 `scheduler.ts` + `learningScheduler.ts`）**
- 每個 enabled task 一條 node-cron（TZ Asia/Taipei）。啟動時 register、CRUD 變動 reschedule。
- **overlap guard**：模組級 `running = new Set<taskId>()`（仿 `learningScheduler` 的 running set）——fire 時若已在集合內 → log `overlap` 跳過。
- fire 流程（每步失敗都 log 對應 decision、絕不讓排程崩）：
  1. **quiet hours**：現在時刻落在 quiet_hours 內 → log `quiet`、return。
  2. **daily quota**：`countActsToday >= daily_quota` → log `quota`、return。
  3. **組狀態包**：呼叫 `buildWatchtowerContext(workspaceId)`（新檔或併入 `cockpitContext.ts` 風格）——取該工作區 active goals（上限）、open outcomes、在途/失敗 delegations、`last_conclusion`。**只讀該工作區資料，維持工作區隔離**。
  4. **便宜評估回合**：`runClaudeOneShot`，**model=haiku**（source 標 `watchtower`），要求結構化輸出：`{ shouldAct: boolean, reason: string, goal: string }`（goal = 若要動手，給 autonomy run 的目標句）。parse 防呆：解析失敗當 `shouldAct:false` + log error，不升級。
  5. **升級**：`shouldAct` → `startRun(sessionId?, workspaceId, goal, {}, deps, policy=balanced)`（**吃批次① F1–F4 護欄 + B2 execute 轉待批**）；log `act` + run_id；`updateLastConclusion`。推播「看守任務動手了」（notifier best-effort）。
  6. `shouldAct:false` → log `skip` + reason + updateLastConclusion（供下次狀態包參考）。
- **模型分級**：評估回合 haiku（便宜、高頻）；升級後的 autonomy run 沿用既有 balanced 政策模型。**別讓評估回合吃 opus**。

**routes（`routes/watchtower.ts`）**：tasks CRUD（workspace 走 `?workspace=`/`x-workspace` header，**對齊既有排程 API 慣例，不是 body**）、`GET /logs?taskId=`、`POST /:id/run-now`（手動觸發一次 fire，同 quota/quiet/overlap 檢查或帶 force 旗標略過——force 僅手動）。掛進 `index.ts` router 列 + 啟動 `watchtowerScheduler`。

**前端（`WatchtowerPanel.tsx`）**：列看守任務（新增/編輯 cron/quiet/quota/enable）、看 logs 時間軸（decision 有色標 + reason + 連到升級的 run）。加進側欄「經營」或「系統」組（照 §側欄 4 組折疊既有結構）。React.lazy 掛載。

**測試（TDD）**：store CRUD/quota 計數/工作區隔離；scheduler fire 的四道護欄（quiet/quota/overlap/正常升級）用注入式 deps（假 oneShot 回 shouldAct、假 startRun 記呼叫）；routes HTTP（照 `app.test.ts` 模式）。**驗收**：quiet/quota/overlap 各自擋下且 log 正確；shouldAct=false 不起 run；shouldAct=true 起 balanced run 並綁 run_id + 推播；無事時零昂貴動作（不誤升級）。

### D1 — 每步 goal 快照
- **現況**：goals 只在 session 建立時注入一次（`sessions.ts:474`），自走跑到第 15 步對的還是開場快照。
- **修法**：`autonomyRunner.loop()` 組 prompt 時附一行最新 active goal 快照（便宜、上限筆數）。量級 0.5–1 天。

### G1 — 聊天內一鍵起自走
- **現況**：階段一 spec §4.1 的 `[模式：自走]` 標記未實作，`startRun` 唯一入口是 UI 面板。
- **修法**：偵測 PM 輸出標記（orchestrator-only gate，仿 GOAL_UPDATE 身分鎖）→ 前端彈一鍵確認卡 → `startRun`。量級 0.5–1 天。

### 批次② 非目標 / YAGNI
- 階段三多 PM、子 agent 巢狀轉派、外部事件 webhook、G2 execute 放行中間檔（等 dogfood 批准頻率數據）、B 內生事件觸發（排第三梯隊，本輪不做，留下輪）。

---

## 執行慣例（照 HANDOFF §2）
- 每批 feature branch；子代理 TDD 逐項（先失敗測試再實作）；controller 驗證（server `tsc --noEmit`+`vitest run`、client `tsc -b`+`vitest run`、live curl）；高風險 Opus 終審；ff 合併回 main 刪 branch。
- commit/push 只在使用者明說時。commit 訊息繁中 + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 子代理設計已確認，直接實作到綠，不要停下來問（SendMessage 不可用）。
