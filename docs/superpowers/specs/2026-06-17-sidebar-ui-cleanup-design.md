# 側欄 UI 整理 Spec（功能鈕分層 + 分類收摺 + CTA 層次）

> 狀態：設計（已批准，2026-06-17）。純前端，承接 PM 聊天 UI 整理（已合併 main）後的側欄優化（原審視清單 #3#4#5）。
> 下一步：本 spec 經審查後 → writing-plans。

## 1. 背景與動機

左側 `AgentSidebar` 資訊密度過高造成視覺雜亂：
- 11 個功能鈕擠成 grid，日常用與罕用的 AI 治理類混在一起；`⚠️ Legacy 重審` 長期掛警告圖示很吵。
- 19 個分類 chip 永遠全展開，鋪 5 行。
- 3 個飽和漸層 CTA 同等份量，主入口不突出。

目標：降低側欄雜亂、突出主入口，把罕用功能收起但保留可達性。

## 2. 範圍

- **只動一個檔**：`client/src/components/AgentSidebar.tsx`。
- **不動**：agent 清單、搜尋框、react-window 虛擬化、其他元件、`App.tsx` 傳入的 props（11 個 `onOpen*` callback 全保留，只是改變呈現位置）。
- 純展示層 + 兩個本地 UI 狀態（摺疊開關），無資料/邏輯改動。

## 3. 設計

### 3.1 功能鈕分層（#3）
現況：11 個鈕在一個 `grid grid-cols-3`（第 165-254 行）。

改為：
- **常用 6 個**維持 `grid grid-cols-3` 一直顯示，順序：排程、歷史、筆記、模板、活動、設定（對應 `onOpenSchedules`/`onOpenHistory`/`onOpenNotes`/`onOpenTemplates`/`onOpenActivity`/`onOpenSettings`）。
- **進階 5 個**收進摺疊：新增一個寬度滿版的切換列「⋯ 進階 ▸」（展開時 ▾），點擊切換本地狀態 `showAdvanced`（預設 false）。展開時於其下以 `grid grid-cols-3` 顯示：學習、能力學習、自主進修、記憶編輯、Legacy 重審（對應 `onOpenLearning`/`onOpenCapabilityLearning`/`onOpenAutonomousStudy`/`onOpenMemoryEditor`/`onOpenLegacyReview`）。
- 五個進階鈕的既有樣式/title/圖示保留（Legacy 重審維持 amber 警示樣式，但因預設收起，平常不再干擾視覺）。

### 3.2 分類 chip 收摺（#4）
現況：「全部」+ 19 個分類 chip 永遠展開（第 266-286 行）。

改為：
- 預設收起。新增切換列：未選分類時顯示「🔖 篩選部門 ▸」；已選某分類時顯示「🔖 篩選：{label} ✕」，點 ✕ 清除分類（`setCat(null)`），點標籤本身展開/收合。本地狀態 `showFilters`（預設 false）。
- 展開時（`showFilters === true`）顯示原本的「全部 (N)」+ 所有分類 chip（樣式不變）。點任一 chip 後保持既有行為（`setCat`）。
- 搜尋框維持在切換列上方、不變（找 agent 主要靠搜尋）。

### 3.3 CTA 視覺層次（#5）
現況：3 個鈕都是飽和漸層、同等份量（第 138-164 行）。

改為：
- 「找專案經理討論」(`onAskOrchestrator`)：維持現有漸層 + `shadow-lg`（主入口，最醒目）。
- 「批次同題」(`onOpenBatch`)、「自動接力」(`onOpenWorkflows`)：降為次級——改用素色 `bg-zinc-800 hover:bg-zinc-700 text-zinc-200`，移除綠/橘漸層；維持滿版 + 圖示 + 文字 + `data-tour` 屬性與 title。

## 4. 邊界 / 一致性
- 三處摺疊/分層皆為純前端本地狀態，重新整理回預設（進階收起、分類收起）。可接受。
- 所有既有 callback props（`onOpen*`、`onAskOrchestrator`、`onPick` 等）與 `data-tour` 屬性保留，不破壞 OnboardingTour 與 App 串接。
- `categories`/`agents`/`liveAgentIds`/`sessionCounts` 等 props 與虛擬清單邏輯不動。

## 5. 測試 / 驗證
- `cd client && npx tsc -b` 零錯。
- 若 `AgentSidebar` 有測試檔則一併跑綠（探索未見，實作時確認；如無則略）。`cd client && npx vitest run` 全綠不回歸。
- 真瀏覽器 e2e：(a) 側欄預設只見 3 CTA（主入口突出）+ 常用 6 鈕 + 「⋯ 進階 ▸」+ 「🔖 篩選部門 ▸」+ 搜尋 + agent 清單，明顯比現在乾淨；(b) 點「進階」展開出 5 個治理鈕；(c) 點「篩選部門」展開出分類 chip、選一個後收合顯示「🔖 篩選：X ✕」、按 ✕ 清除；(d) 三個 CTA 視覺層次分明（主入口漸層、另兩個素色）。
