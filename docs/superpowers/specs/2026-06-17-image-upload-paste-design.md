# 圖片上傳（拖/貼）+ 自動 OCR Spec

> 狀態：設計（已批准，2026-06-17）。純前端。讓使用者方便地把圖片（尤其截圖）丟給 PM/任何 agent，並自動辨識其中文字。
> 下一步：本 spec 經審查後 → writing-plans。

## 1. 背景與動機

使用者要「把圖片直接拉到對話框上傳，方便、可多圖配文字」，主要場景是讀平台後台/訂單截圖。實測發現：
- **拖放其實已可用**（`ChatWindow` 根層 onDrop → `useFileUpload.handleFiles`，實測拖一張 PNG 確實上傳成功）。
- **但問題在**：(a) 沒有可見提示，使用者不知道能拖（虛線提示只在拖曳中才出現）；(b) 圖片上傳的提示語是「請看這張圖片:路徑」、沒明講「用 Read」，所以 agent 不一定自動 OCR，感覺像沒成功。
- OCR 能力本身**已驗證可用**（agent 用 Read 工具讀圖，中文+英數+金額皆正確）。

## 2. 範圍

- **只動前端**：`client/src/hooks/useFileUpload.ts`、`client/src/components/ChatWindow.tsx`、`client/src/components/Composer.tsx`。
- **不動**：後端 /upload 端點、agentSession、OCR 機制（沿用 Read 工具）。
- 不做：圖片縮圖預覽（未來再議，YAGNI）。

## 3. 設計

### 3.1 貼上（Ctrl+V）支援
在 `useFileUpload` 新增 `handlePaste(e: React.ClipboardEvent)`：
- 從 `e.clipboardData.items` 取出 `kind === "file" && type.startsWith("image/")` 的項目，`getAsFile()` 收集成 `File[]`。
- 若有圖片：`e.preventDefault()` 後呼叫既有 `handleFiles(files)`（沿用同一條上傳路徑）。
- 無圖片（純文字貼上）：不攔截，讓預設貼上行為照常。
在 `ChatWindow` 根 `<div>`（已有 onDrop 那個）加 `onPaste={handlePaste}`——paste 事件會從聚焦的 textarea 冒泡到此容器，與 onDrop 放同層、一致。

### 3.2 可見提示
在 `Composer` 的輸入列下方加一行常駐小提示（靜態文字，無新 prop）：
`💡 可拖曳或貼上圖片/截圖（上限 10MB），可多張 + 文字一起送`
樣式：`text-[11px] text-zinc-500 mt-1`（低調、不搶眼）。

### 3.3 自動 OCR（提示語）
`useFileUpload` 第 46 行，圖片分支的字串由：
`請看這張圖片:${path}`
改為：
`請用 Read 工具讀取這張圖片（讀出其中所有文字）:${path}`
（與既有檔案分支「請用 Read 工具讀取這個檔案:${path}」一致；讓 agent 拖/貼圖進來就穩定 OCR。）

## 4. 邊界 / 一致性
- 多圖：`handleFiles` 既有行為是每個檔案各自 append 一行進輸入框 → 多圖 + 使用者文字可一起送出，無需改動。
- 貼上的截圖檔名可能為空 → 後端 /upload 的 `safe` 變空字串、filename 退為 `${ts}_`，仍可正常存檔（可接受）。
- handlePaste 只攔截「含圖片」的貼上；純文字/程式碼貼上不受影響。
- 拖放維持現狀（已驗證可用），本案只新增貼上 + 提示 + OCR 措辭。

## 5. 測試 / 驗證
- `cd client && npx tsc -b` 零錯；`npx vitest run` 全綠（不動既有測試；useFileUpload 若無測試則不新增，屬瀏覽器互動行為，靠 e2e）。
- 真瀏覽器 e2e（主目錄 dashboard，HMR）：
  1. 開 PM → 看到輸入框下方常駐提示「可拖曳或貼上圖片…」。
  2. **拖放**一張含文字的圖到 PM → 輸入框出現「請用 Read 工具讀取這張圖片…:路徑」→ 送出 → PM 用 Read 讀出文字。
  3. **貼上**：把圖片放到剪貼簿（或用 evaluate 模擬 clipboard paste）→ 在輸入框 Ctrl+V → 同樣上傳 + 出現 Read 提示。
  4. 多圖：連拖兩張 → 兩行提示都進輸入框，可加文字一起送。
