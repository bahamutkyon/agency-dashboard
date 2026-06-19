# PM 聊天 UI 整理 Spec（自主面板收摺 + 自走中聊天提示）

> 狀態：設計（已批准，2026-06-17）。純前端，承接 PM 自走迴圈（已合併 main `00c8f27`）後的 UX 優化。
> 下一步：本 spec 經審查後 → writing-plans。

## 1. 背景與動機

PM 自走功能上線後，e2e + UI 審視發現兩個影響日常使用的問題：
1. **PM 聊天頂部的「自主模式」面板永遠展開**，自帶一個目標輸入框，與底部聊天輸入框並存 → 使用者一開 PM 就看到兩個輸入框，搞不清楚該打哪個。
2. **自走進行中，底部聊天輸入框直接置灰**（沿用 session busy），沒有任何說明 → 使用者以為壞掉，不知道可用插話框或喊停。

目標：降低介面雜亂與誤解，讓「單純聊天」與「自走」兩種使用情境清楚分離、互不干擾。

## 2. 範圍

- **只動兩個前端檔**：`client/src/components/AutonomyPanel.tsx`、`client/src/components/ChatWindow.tsx`。
- **不動**：後端、autonomy API（start/stop/inject 端點）、session busy 機制、左欄功能鈕/分類 chip/CTA（#3#4#5 另案）。
- 純展示層，無資料模型/狀態機改動。

## 3. 設計

### 3.1 自主面板收摺（AutonomyPanel.tsx）
現況：`!run || TERMINAL.includes(run.status)`（閒置/終止）分支直接渲染「說明 + 目標 textarea + 開始按鈕」，永遠展開。

改為：
- 閒置/終止時，預設渲染**一行摺疊列**：`🎯 自走模式` + 展開指示（`▸`/`▾`）。點擊切換 `expanded`。
- `expanded === true` 時，於摺疊列下方顯示原本的目標 textarea + 「開始自主執行」按鈕（含原本的平衡說明文字）。
- 進行中的 run（非終止狀態）：維持現有完整面板（目標、狀態/步數、核可計畫、續跑、補充資訊、插話、喊停），不收摺。
- 狀態：在 `AutonomyPanel` 內新增 `const [expanded, setExpanded] = useState(false)`（預設收起）。
- 收尾乾淨：當偵測到 run 由「無/終止」轉為「進行中」時，把 `expanded` 設回 false（用 `useEffect` 監看 `run?.status`），確保跑完回到閒置時是收起的一行。

### 3.2 自走中聊天提示（ChatWindow.tsx）
現況：底部 `<Composer>` 的輸入隨 session `status`（busy）置灰，無說明。

改為：
- 當 `autonomyRun` 存在且非終止狀態時，在 `<Composer>` **上方**渲染一行提示橫條：`🎯 自走中…請用上方插話框跟它說話，或按「喊停」`。
- 樣式比照既有提示橫條（如 `autoInjectedNotes`/`summary` 那種 `px-4 py-2 border-b text-xs` 的薄橫條），用 emerald 色系與自走面板呼應。
- 條件：`autonomyRun && !TERMINAL_STATUSES.includes(autonomyRun.status)`（`TERMINAL_STATUSES = ["done","stopped","budget_exhausted","error"]`，與既有定義一致）。一般聊天的短暫 busy **不**顯示此橫條。
- Composer 本身不改（disabled 仍由 status 驅動）。

## 4. 錯誤處理 / 邊界
- 摺疊列在任何 run 狀態下都不應吃掉「進行中面板」——分支順序：先判進行中 run → 完整面板；否則 → 摺疊/展開的閒置面板。
- `expanded` 為純 UI 本地狀態，重新整理後回預設收起（可接受）。

## 5. 測試 / 驗證
- `cd client && npx tsc -b` 零錯。
- 既有 `client/src/components/AutonomyPanel.test.tsx`：若斷言依賴「閒置時目標 textarea 直接可見」，需更新為「先展開再出現」或改測摺疊列存在。修到綠。
- 真瀏覽器 e2e（worktree dev）：(a) 開 PM → 看到一行摺疊列、無第二個輸入框；(b) 點展開 → 出現目標框 → 開始自走；(c) 自走中 → 底部出現提示橫條、輸入框置灰有說明；(d) 跑完 → 回到收起的一行。
