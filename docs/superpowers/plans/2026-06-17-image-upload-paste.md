# 圖片上傳（拖/貼）+ 自動 OCR 實現計劃

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推薦）或 superpowers:executing-plans 逐任務實現此計劃。步驟使用複選框（`- [ ]`）語法來跟蹤進度。

**目標：** 讓使用者用拖放或 Ctrl+V 貼上把圖片（含截圖）丟給 PM/任何 agent，並自動以 Read 工具 OCR。

**架構：** 純前端。`useFileUpload` 新增貼上處理 + 改 OCR 提示語；`ChatWindow` 根層接 onPaste；`Composer` 加常駐提示。拖放與後端上傳/OCR 機制沿用不動。

**技術棧：** React + TypeScript（Vite）。

> **測試說明：** 涉及瀏覽器剪貼簿/拖放互動，不寫單元測試（既有 useFileUpload 無測試、handlePaste 與 handleFiles/上傳網路耦合），以 `tsc -b` + 真瀏覽器 e2e 驗證。

---

## 檔案結構
- 修改 `client/src/hooks/useFileUpload.ts`：加 `handlePaste`、改圖片 OCR 提示語、return 加 `handlePaste`。
- 修改 `client/src/components/ChatWindow.tsx`：解構 `handlePaste`，根 `<div>` 加 `onPaste`。
- 修改 `client/src/components/Composer.tsx`：輸入列下方加常駐提示。

---

### 任務 1：useFileUpload 加貼上 + OCR 提示語

**文件：** 修改 `client/src/hooks/useFileUpload.ts`

- [ ] **步驟 1：import 加 ClipboardEvent 型別**

第 1 行：
```ts
import { useState, type Dispatch, type RefObject, type SetStateAction, type ClipboardEvent } from "react";
```

- [ ] **步驟 2：改圖片 OCR 提示語**

第 46 行（圖片分支）由：
```ts
            additions.push(`請看這張圖片:${path}`);
```
改為：
```ts
            additions.push(`請用 Read 工具讀取這張圖片（讀出其中所有文字）:${path}`);
```

- [ ] **步驟 3：新增 handlePaste（在 handleFiles 定義之後、return 之前）**

```ts
  /** Ctrl+V 貼上：只攔截剪貼簿中的圖片，走同一條上傳路徑；純文字貼上不干擾。 */
  const handlePaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imgs: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) imgs.push(f);
      }
    }
    if (imgs.length > 0) {
      e.preventDefault();
      void handleFiles(imgs);
    }
  };
```

- [ ] **步驟 4：return 加 handlePaste**

把 `return { dragActive, setDragActive, uploading, handleFiles };` 改為：
```ts
  return { dragActive, setDragActive, uploading, handleFiles, handlePaste };
```

- [ ] **步驟 5：型別檢查**

運行：`cd client && npx tsc -b`
預期：零錯誤（handlePaste 此時尚未被 ChatWindow 使用，但 hook 自身編譯通過；若有「未使用」嚴格警告才需等任務 2，一般 noUnusedLocals 不檢查 return 物件屬性，應通過）。

- [ ] **步驟 6：Commit**
```bash
git add client/src/hooks/useFileUpload.ts
git commit -m "feat(upload): paste-to-upload images + auto-OCR prompt wording"
```
（結尾加 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`）

---

### 任務 2：ChatWindow 接 onPaste

**文件：** 修改 `client/src/components/ChatWindow.tsx`（第 170 行解構、第 182-193 根 div）

- [ ] **步驟 1：解構 handlePaste**

第 170 行：
```ts
  const { dragActive, setDragActive, uploading, handleFiles, handlePaste } = useFileUpload(setInput, inputRef);
```

- [ ] **步驟 2：根 div 加 onPaste**

在根 `<div className="flex flex-col h-full relative" ...>` 的事件屬性中（onDrop 之後）加一行 `onPaste={handlePaste}`：
```tsx
    <div
      className="flex flex-col h-full relative"
      onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
      }}
      onPaste={handlePaste}
    >
```

- [ ] **步驟 3：型別檢查**

運行：`cd client && npx tsc -b`
預期：零錯誤。

- [ ] **步驟 4：Commit**
```bash
git add client/src/components/ChatWindow.tsx
git commit -m "feat(upload): wire onPaste on chat container for image paste"
```
（結尾加 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`）

---

### 任務 3：Composer 常駐提示

**文件：** 修改 `client/src/components/Composer.tsx`（第 67-120 的 `<div className="flex gap-2">…</div>` 之後）

- [ ] **步驟 1：在輸入列下方加提示**

在 `<div className="flex gap-2"> … </div>`（textarea + 按鈕那塊，結束於第 120 行）之後、外層 `</div>`（第 121 行）之前，加：
```tsx
      <div className="text-[11px] text-zinc-500 mt-1">
        💡 可拖曳或貼上圖片/截圖（上限 10MB），可多張 + 文字一起送
      </div>
```

- [ ] **步驟 2：型別檢查 + 全套測試**

運行：`cd client && npx tsc -b && npx vitest run`
預期：tsc 零錯；vitest 全綠（不動既有測試）。

- [ ] **步驟 3：Commit**
```bash
git add client/src/components/Composer.tsx
git commit -m "feat(upload): show drag/paste hint under composer"
```
（結尾加 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`）

---

### 任務 4：真瀏覽器 e2e 驗證

**文件：** 無；Playwright（主目錄 dashboard，HMR）。

- [ ] **步驟 1**：開 PM → 輸入框下方有常駐提示「💡 可拖曳或貼上圖片…」。
- [ ] **步驟 2 拖放**：模擬拖一張含文字 PNG 到 PM → 輸入框出現「請用 Read 工具讀取這張圖片…:路徑」。
- [ ] **步驟 3 貼上**：用 browser_evaluate 模擬 paste（建 image File、ClipboardEvent 含 clipboardData.items）dispatch 到 textarea → 輸入框同樣出現上傳提示行。
- [ ] **步驟 4 OCR**：送出 → PM 用 Read 讀出圖中文字（中英數）。
- [ ] **步驟 5（可選）多圖**：連拖兩張 → 兩行提示都進輸入框。

---

## 自檢結果

**規格覆蓋度：** §3.1 貼上 → 任務 1(handlePaste)+任務 2(onPaste)；§3.2 提示 → 任務 3；§3.3 OCR 措辭 → 任務 1 步驟 2；§5 驗證 → 任務 4。全覆蓋。

**佔位符掃描：** 無 TODO/待定；程式碼步驟皆含完整碼。

**類型一致性：** `handlePaste`（useFileUpload 定義、return、ChatWindow 解構與 onPaste 使用）一致；`ClipboardEvent` 取自 react；`handleFiles` 沿用既有。
