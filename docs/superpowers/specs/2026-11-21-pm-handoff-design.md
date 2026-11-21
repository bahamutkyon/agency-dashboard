# 專案經理一句話交接 設計

日期：2026-11-21　狀態：使用者已確認設計（方案 A＋C）

## 1. 問題

現有交接（`server/src/sessionHandoff.ts`，2026-11-17 方案 D2）只在按「＋ 開新話題」時帶入上一場：

- 有閒置摘要時帶「停在哪」一句話（`sessionDigest.ts`，上限 80 字）
- 沒有時帶最後一則專案經理回覆前 300 字

實測（`server/data/store.db`，33 場專案經理對話）：中位數 6 則／約 5 千字，**p90 102 則／約 4.4 萬字**，最長 212 則。長對話才需要交接，但只帶走不到 1%；已決定的事、進行中的交辦、待拍板事項都會遺失。`handoff_from` 至今使用次數 0。

使用者目前的手動流程：請專案經理整理交接 md → 開新對話貼給下一個接手。本設計把這個流程自動化。

## 2. 目標 / 非目標

目標：
- 使用者說「交接」（或按鈕）→ 專案經理寫完整交接單 → 自動開新對話並切過去，新對話帶入完整交接單。
- 對話過長時用 UI 提示主動提醒交接（不花 token）。

非目標（YAGNI）：
- 不做跨工作區交接、不串接多代交接（新對話只帶上一場）。
- 不另開一次性模型讀逐字稿（方案②），失敗時不自動退回別的產生方式。
- 不匯出 md 檔到磁碟（交接單存 DB，介面可看可改）。

## 3. 方案

採 **① 專案經理自己寫**：它在原 session 中擁有完整上下文（含派工回報、工具結果），品質最好；成本＝一次專案經理回合。

## 4. 設計

### 4.1 觸發
- **自然語言**：派工手冊（`routes/sessions.ts` 的 PM 指引）加一段：使用者表達要交接／換新對話／整理交接時，輸出 HANDOFF 區塊。由 PM 判斷意圖，伺服器不做關鍵字比對。
- **按鈕**：專案經理對話頂部加「🔁 交接」，送出固定訊息「請整理交接，換到新對話繼續」。

### 4.2 交接單格式
```
=== HANDOFF ===
🎯 目標：
✅ 已決定：
🔄 進行中：
⏭️ 下一步：
❓ 等你拍板：
📎 重要資料：
=== END HANDOFF ===
```
- 新檔 `server/src/handoffParser.ts`：`parseHandoff(text): string | null`，取區塊內文、trim；空內容回 null；超過 **2000 字**（以字元計，`[...s]`）截斷並加「…（已截斷）」。欄位缺漏不視為錯誤（PM 可能某欄確實沒有內容）。
- 多個區塊只取最後一個。

### 4.3 偵測與開新對話
- 位置：`agentManager.ts` 處理 assistant 訊息處，與 GOAL_UPDATE / FOLLOWUP 同一道 gate（**只認 `agents-orchestrator` 且有 workspaceId**；子 agent 輸出可能照抄外部內容，不得觸發）。
- 自動化 session（標題符合 `sessionDigest.ts` 的 `AUTOMATED`：排程／批次／workflow／受派／外包）不觸發。
- 偵測到後呼叫新函式 `performHandoff(fromId, doc)`（新檔 `server/src/handoffService.ts`）：
  1. `setHandoffDoc(fromId, doc)`：sessions 表新欄 `handoff_doc TEXT`、`handed_off_to TEXT`（`dbSchema.ts` 既有欄位遷移清單加入）。
  2. 用與 `POST /orchestrator` 相同的方式開新 PM 對話（同工作區、同 project），帶 `handoffFrom=fromId`。把現在 route 內「組 standing prompt + 開 session」抽成共用函式，route 與 handoffService 共用，避免兩份邏輯漂移。
  3. 舊對話：`handed_off_to=newId`，狀態設 `done`（state_source=auto），stoppedAt＝「已交接到新對話」。
  4. socket emit `session:handoff { fromId, toId, toTitle }`。
- 防重：同一場已有 `handed_off_to` 且新對話仍存在時，再次偵測到 HANDOFF → 更新交接單並沿用既有新對話，不重複開（PM 同回合重吐或使用者重按）。

### 4.4 帶入
- `buildHandoff(fromId)` 優先序：`handoff_doc`（source=`doc`）> 閒置摘要（`digest`）> 節錄（`excerpt`）。
- `handoffPromptBlock` 對 `doc` 用完整交接單，提示語改為「這是上一場專案經理寫給你的交接單，已決定的事不要重問」。
- 閒置回收後重新喚醒沿用現有保留機制（`routes/sessions.ts` 喚醒時重建 prompt）。
- 手動「＋ 開新話題」也走同一個 `buildHandoff`，所以寫過交接單的場次會自動帶完整版。

### 4.5 前端
- 收到 `session:handoff` 且目前開著 fromId → 自動切到 toId（`App.openHistorySession`）。
- `HandoffCard`：source=`doc` 時顯示完整交接單（預設展開、保留換行），新增「編輯」：textarea 修改後 `PUT /api/sessions/:id/handoff`（body `{ doc }`，寫回來源場次的 `handoff_doc`，並停掉新對話的程序，讓下一句話用新版 prompt 喚醒——與現有「不要帶入」同一做法）。**只在新對話還沒有使用者訊息時可編輯**（開聊後按鈕隱藏；要補充就直接在對話裡跟專案經理說），避免對話中途替換 prompt 的複雜度。
- 舊對話頂部顯示「已交接 → 新對話標題」連結。
- 交接失敗（使用者送出交接請求但 PM 回覆沒有合法 HANDOFF 區塊）：前端在按鈕觸發的那一回合結束後檢查，顯示「交接單沒有產生，再按一次」。自然語言觸發不做此檢查（無法確知使用者意圖）。

### 4.6 C：過長提醒
- 純前端判斷函式 `client/src/lib/handoffNudge.ts`：`shouldNudge({ messageCount, totalChars, dismissed, handedOff })`，門檻 **80 則或 30,000 字**。
- 對話頂部提示條：「這場已經很長（N 則），交接到新對話？［交接］［不用］」；［不用］寫 localStorage（以 sessionId 為 key），這場不再提醒；已交接的場次不提醒。
- 側欄既有 150 則提示（`AgentSidebar.tsx:186`）改用同一判斷函式。
- session 列表 API 需提供 totalChars（若目前沒有則加總計算回傳）。

## 5. 錯誤處理
- 解析失敗／空內容：不開新對話、不改舊對話，log 一行。
- 開新對話失敗：交接單已存，舊對話不標 done，emit `session:handoff_failed { fromId, error }`，前端顯示錯誤與重試。
- 所有偵測包 try/catch，不影響原本訊息存檔與串流（同 GOAL_UPDATE 模式）。

## 6. 測試
- `handoffParser`：正常、無區塊、空區塊、多區塊取最後、超長截斷。
- `handoffService`（server，打真 DB）：開新對話並帶 handoffFrom、舊對話 done＋handed_off_to、防重沿用、非 orchestrator／自動化 session 不觸發。
- `buildHandoff` 優先序 doc > digest > excerpt；`handoffPromptBlock` doc 版內容。
- `PUT /sessions/:id/handoff` 端點（`app.test.ts` 模式）。
- client：`shouldNudge` 門檻與 dismissed／handedOff；收到 `session:handoff` 切換；HandoffCard doc 顯示與編輯。
- 突變檢查：拿掉 gate／防重／優先序各自應讓對應測試轉紅。
- 實機：拿一場真實長對話說「交接」，確認自動切換、交接單完整、新對話不重問已決定事項。
