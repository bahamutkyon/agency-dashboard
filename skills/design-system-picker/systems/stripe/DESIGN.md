# 受 Stripe 啟發的設計系統

> 類別：Fintech & Crypto
> 支付基礎建設。標誌性的紫色漸層，字重 300 的優雅。

## 1. 視覺主題與氛圍

Stripe 的網站堪稱金融科技設計的黃金標竿 — 一套能同時呈現技術感與奢華感、精準與溫度的系統。頁面以乾淨的白色畫布（`#ffffff`）開場，搭配深海軍藍標題（`#061b31`）與標誌性的 Stripe 紫（`#533afd`），紫色同時是品牌的定錨與互動強調。它不是企業軟體那種冰冷臨床的紫，而是一抹飽和的紫羅蘭，讀來自信且高端。整體印象就像由一家頂級字型鑄造廠重新設計過的金融機構。

客製的 `sohne-var` 可變字型是 Stripe 視覺識別的核心。每個文字元素都啟用 OpenType 的 `"ss01"` 樣式集，修改了某些字元的形狀，營造出鮮明的幾何、現代感。Display 尺寸（48px–56px）下，sohne-var 以字重 300 呈現 — 這在標題上是極為輕盈的字重，創造出一種空靈、近乎耳語般的權威感。這恰恰是「粗體大 hero 標題」慣例的反命題；Stripe 的標題彷彿不需要喊叫。負字距（56px 時為 -1.4px，48px 時為 -0.96px）將文字壓縮成密實、工程感十足的區塊。較小尺寸下系統同樣使用字重 300，並按比例放鬆字距，金融資料則透過 `"tnum"` 取得等寬數字。

真正讓 Stripe 與眾不同的是它的陰影系統。多數網站使用單層或扁平陰影，Stripe 卻採用多層、帶藍調的陰影：標誌性的 `rgba(50,50,93,0.25)` 與 `rgba(0,0,0,0.1)` 組合出冷色調、近乎大氣的深度 — 像是元素懸浮在暮色天空裡。主陰影色（50,50,93）的藍灰底調直接呼應海軍紫的品牌調色板，連層次感都帶著品牌氣息。

**主要特徵：**
- sohne-var 全文啟用 OpenType `"ss01"` — 這套客製樣式集定義了品牌的字形
- 字重 300 是標誌性的標題字重 — 輕、自信、反慣例
- Display 尺寸採負字距（56px 時 -1.4px，並隨尺寸縮小逐步放鬆）
- 多層藍調陰影 `rgba(50,50,93,0.25)` — 連深度都是品牌色
- 標題使用深海軍藍（`#061b31`）而非黑 — 溫暖、高端、符合金融質感
- 保守的圓角（4px–8px） — 沒有藥丸形、沒有過於銳利的造型
- Ruby（`#ea2261`）與 Magenta（`#f96bee`）作為漸層與裝飾強調
- `SourceCodePro` 作為等寬字型搭檔，用於程式碼與技術標籤

## 2. 配色系統與角色

### Primary
- **Stripe Purple**（`#533afd`）：主要品牌色，CTA 背景、連結文字、互動高亮。一抹飽和的藍紫色，撐起整套系統的定錨。
- **Deep Navy**（`#061b31`）：`--hds-color-heading-solid`。主要標題色。不是黑也不是灰，而是非常深的藍色，為文字增添溫度與深度。
- **Pure White**（`#ffffff`）：頁面背景、卡片表面、深色背景上的按鈕文字。

### 品牌與深色
- **Brand Dark**（`#1c1e54`）：`--hds-color-util-brand-900`。深靛藍用於深色區塊、頁尾背景與沉浸式品牌時刻。
- **Dark Navy**（`#0d253d`）：`--hds-color-core-neutral-975`。最深的中性色 — 帶藍底調的近黑，提供最大深度但不刺眼。

### 強調色
- **Ruby**（`#ea2261`）：`--hds-color-accentColorMode-ruby-icon-solid`。溫暖的紅粉色，用於圖示、警示與強調元素。
- **Magenta**（`#f96bee`）：`--hds-color-accentColorMode-magenta-icon-gradientMiddle`。鮮豔的粉紫色，用於漸層與裝飾性高光。
- **Magenta Light**（`#ffd7ef`）：`--hds-color-util-accent-magenta-100`。Magenta 主題卡片與徽章的染色表面。

### 互動
- **Primary Purple**（`#533afd`）：主要連結色、active 狀態、選取元素。
- **Purple Hover**（`#4434d4`）：主要元素 hover 時的較深紫色。
- **Purple Deep**（`#2e2b8c`）：`--hds-color-button-ui-iconHover`。深紫色用於圖示 hover 狀態。
- **Purple Light**（`#b9b9f9`）：`--hds-color-action-bg-subduedHover`。柔和的淡紫色用於低調的 hover 背景。
- **Purple Mid**（`#665efd`）：`--hds-color-input-selector-text-range`。範圍選擇器與輸入高亮色。

### 中性階
- **Heading**（`#061b31`）：主要標題、導覽文字、強調標籤。
- **Label**（`#273951`）：`--hds-color-input-text-label`。表單標籤、次要標題。
- **Body**（`#64748d`）：次要文字、描述、說明。
- **Success Green**（`#15be53`）：狀態徽章、成功指示器（背景／邊框配 0.2–0.4 alpha）。
- **Success Text**（`#108c3d`）：成功徽章的文字色。
- **Lemon**（`#9b6829`）：`--hds-color-core-lemon-500`。警告與重點強調。

### 表面與邊框
- **Border Default**（`#e5edf5`）：卡片、分隔線與容器的標準邊框色。
- **Border Purple**（`#b9b9f9`）：按鈕與輸入框 active／selected 狀態的邊框。
- **Border Soft Purple**（`#d6d9fc`）：低調的紫調邊框，用於次要元素。
- **Border Magenta**（`#ffd7ef`）：粉色調邊框，用於 magenta 主題元素。
- **Border Dashed**（`#362baa`）：拖放區與佔位元素的虛線邊框。

### 陰影色
- **Shadow Blue**（`rgba(50,50,93,0.25)`）：標誌色 — 藍調的主要陰影色。
- **Shadow Dark Blue**（`rgba(3,3,39,0.25)`）：更深的藍調陰影，用於浮起元素。
- **Shadow Black**（`rgba(0,0,0,0.1)`）：第二層陰影，用於強化深度。
- **Shadow Ambient**（`rgba(23,23,23,0.08)`）：柔和環境陰影，用於細微浮起。
- **Shadow Soft**（`rgba(23,23,23,0.06)`）：最微弱的環境陰影，用於輕度抬升。

## 3. 字型系統

### 字型家族
- **Primary**：`sohne-var`，fallback：`SF Pro Display`
- **Monospace**：`SourceCodePro`，fallback：`SFMono-Regular`
- **OpenType 功能**：所有 sohne-var 文字全域啟用 `"ss01"`；財務資料與說明文字的等寬數字使用 `"tnum"`。

### 層級

| 角色 | 字型 | 大小 | 字重 | 行高 | 字距 | 功能 | 備註 |
|------|------|------|--------|-------------|----------------|----------|-------|
| Display Hero | sohne-var | 56px（3.50rem） | 300 | 1.03（緊） | -1.4px | ss01 | 最大尺寸，耳語般的權威 |
| Display Large | sohne-var | 48px（3.00rem） | 300 | 1.15（緊） | -0.96px | ss01 | 次級 hero 標題 |
| Section Heading | sohne-var | 32px（2.00rem） | 300 | 1.10（緊） | -0.64px | ss01 | 特色區塊標題 |
| Sub-heading Large | sohne-var | 26px（1.63rem） | 300 | 1.12（緊） | -0.26px | ss01 | 卡片標題、子區塊 |
| Sub-heading | sohne-var | 22px（1.38rem） | 300 | 1.10（緊） | -0.22px | ss01 | 較小的區塊標題 |
| Body Large | sohne-var | 18px（1.13rem） | 300 | 1.40 | normal | ss01 | 特色描述、導引文字 |
| Body | sohne-var | 16px（1.00rem） | 300–400 | 1.40 | normal | ss01 | 標準閱讀文字 |
| Button | sohne-var | 16px（1.00rem） | 400 | 1.00（緊） | normal | ss01 | 主要按鈕文字 |
| Button Small | sohne-var | 14px（0.88rem） | 400 | 1.00（緊） | normal | ss01 | 次要／緊湊按鈕 |
| Link | sohne-var | 14px（0.88rem） | 400 | 1.00（緊） | normal | ss01 | 導覽連結 |
| Caption | sohne-var | 13px（0.81rem） | 400 | normal | normal | ss01 | 小標籤、metadata |
| Caption Small | sohne-var | 12px（0.75rem） | 300–400 | 1.33–1.45 | normal | ss01 | 附註說明、時間戳 |
| Caption Tabular | sohne-var | 12px（0.75rem） | 300–400 | 1.33 | -0.36px | tnum | 財務資料、數字 |
| Micro | sohne-var | 10px（0.63rem） | 300 | 1.15（緊） | 0.1px | ss01 | 微型標籤、座標標記 |
| Micro Tabular | sohne-var | 10px（0.63rem） | 300 | 1.15（緊） | -0.3px | tnum | 圖表資料、小數字 |
| Nano | sohne-var | 8px（0.50rem） | 300 | 1.07（緊） | normal | ss01 | 最小的標籤 |
| Code Body | SourceCodePro | 12px（0.75rem） | 500 | 2.00（寬鬆） | normal | — | 程式碼區塊、語法 |
| Code Bold | SourceCodePro | 12px（0.75rem） | 700 | 2.00（寬鬆） | normal | — | 粗體程式碼、關鍵字 |
| Code Label | SourceCodePro | 12px（0.75rem） | 500 | 2.00（寬鬆） | normal | uppercase | 技術標籤 |
| Code Micro | SourceCodePro | 9px（0.56rem） | 500 | 1.00（緊） | normal | ss01 | 極小的程式碼註記 |

### 原則
- **以輕字重為招牌**：Display 尺寸的字重 300 是 Stripe 最具辨識度的字型選擇。當別人都用 600–700 在搶眼球，Stripe 卻把輕盈當作奢華 — 文字自信到不需要重量就能有權威。
- **ss01 全面啟用**：`"ss01"` 樣式集是不可妥協的設定。它修改了特定字元（很可能是 `a`、`g`、`l` 的替代造型），為所有 sohne-var 文字營造更現代、幾何感的氣質。
- **兩種 OpenType 模式**：`"ss01"` 用於 display／內文，`"tnum"` 用於財務資料中的等寬數字。兩者從不重疊 — 段落中的數字用 ss01，資料表中的數字用 tnum。
- **字距漸進收緊**：字距隨尺寸按比例收緊：56px -1.4px，48px -0.96px，32px -0.64px，26px -0.26px，16px 以下為 normal。
- **兩種字重的簡潔**：主要使用 300（內文與標題）與 400（UI／按鈕）。主字型完全沒有 bold（700） — SourceCodePro 則以 500／700 區分程式碼對比。

## 4. 元件與模式

### 按鈕

**Primary Purple**
- 背景：`#533afd`
- 文字：`#ffffff`
- Padding：8px 16px
- 圓角：4px
- 字型：16px sohne-var 字重 400，`"ss01"`
- Hover：背景變 `#4434d4`
- 用途：主要 CTA（「Start now」、「Contact sales」）

**Ghost / Outlined**
- 背景：透明
- 文字：`#533afd`
- Padding：8px 16px
- 圓角：4px
- 邊框：`1px solid #b9b9f9`
- 字型：16px sohne-var 字重 400，`"ss01"`
- Hover：背景變 `rgba(83,58,253,0.05)`
- 用途：次要動作

**Transparent Info**
- 背景：透明
- 文字：`#2874ad`
- Padding：8px 16px
- 圓角：4px
- 邊框：`1px solid rgba(43,145,223,0.2)`
- 用途：三級／資訊類動作

**Neutral Ghost**
- 背景：透明（`rgba(255,255,255,0)`）
- 文字：`rgba(16,16,16,0.3)`
- Padding：8px 16px
- 圓角：4px
- Outline：`1px solid rgb(212,222,233)`
- 用途：停用或低調的動作

### 卡片與容器
- 背景：`#ffffff`
- 邊框：`1px solid #e5edf5`（標準）或 `1px solid #061b31`（深色強調）
- 圓角：4px（緊湊）、5px（標準）、6px（舒適）、8px（特色）
- 陰影（標準）：`rgba(50,50,93,0.25) 0px 30px 45px -30px, rgba(0,0,0,0.1) 0px 18px 36px -18px`
- 陰影（環境）：`rgba(23,23,23,0.08) 0px 15px 35px 0px`
- Hover：陰影加強，通常會加上藍調層

### 徽章／Tag／Pill
**中性 Pill**
- 背景：`#ffffff`
- 文字：`#000000`
- Padding：0px 6px
- 圓角：4px
- 邊框：`1px solid #f6f9fc`
- 字型：11px 字重 400

**成功徽章**
- 背景：`rgba(21,190,83,0.2)`
- 文字：`#108c3d`
- Padding：1px 6px
- 圓角：4px
- 邊框：`1px solid rgba(21,190,83,0.4)`
- 字型：10px 字重 300

### 輸入框與表單
- 邊框：`1px solid #e5edf5`
- 圓角：4px
- Focus：`1px solid #533afd` 或紫色光環
- 標籤：`#273951`，14px sohne-var
- 文字：`#061b31`
- Placeholder：`#64748d`

### 導覽
- 白底乾淨水平導覽，sticky 並帶 backdrop blur
- 品牌字標靠左
- 連結：sohne-var 14px 字重 400，文字色 `#061b31`，啟用 `"ss01"`
- 圓角：導覽容器 6px
- CTA：紫色按鈕靠右（「Sign in」、「Start now」）
- 行動裝置：漢堡選單，按鈕 6px 圓角

### 裝飾元素
**虛線邊框**
- `1px dashed #362baa`（紫）用於佔位／拖放區
- `1px dashed #ffd7ef`（magenta）用於 magenta 主題的裝飾邊框

**漸層強調**
- Hero 裝飾使用 Ruby 到 magenta 的漸層（`#ea2261` 到 `#f96bee`）
- 品牌深色區塊使用 `#1c1e54` 背景配白色文字

## 5. 間距與佈局

### 間距系統
- 基準單位：8px
- 刻度：1px、2px、4px、6px、8px、10px、11px、12px、14px、16px、18px、20px
- 重點：刻度在小尺寸端非常密集（4–12 每 2px 一階），反映 Stripe 對於財務資料介面的精準導向

### Grid 與容器
- 最大內容寬度：約 1080px
- Hero：單欄置中，padding 大方，配上輕字重標題
- 特色區塊：特色卡片採 2–3 欄 grid
- 滿版深色區塊使用 `#1c1e54` 背景營造品牌沉浸感
- 程式碼／儀表板預覽以卡片承載，配上藍調陰影

### 留白哲學
- **精準的間距**：與極簡系統那種大片空蕩不同，Stripe 採用有節制、有目的的留白。每一道間隙都是經過深思的字型決策。
- **資料密集，外框寬鬆**：財務資料顯示（表格、圖表）密集排列，但圍繞它們的 UI chrome 則寬鬆有度。這營造出一種「受控密度」 — 就像一份排得整整齊齊的試算表，被裱在漂亮的相框裡。
- **區塊節奏**：白色區塊與深色品牌區塊（`#1c1e54`）交替出現，創造戲劇化的明暗節奏，避免單調又不引入額外的色彩。

### 圓角刻度
- Micro（1px）：細緻元素、微小圓角
- 標準（4px）：按鈕、輸入框、徽章、卡片 — 主力
- 舒適（5px）：標準卡片容器
- 寬鬆（6px）：導覽、較大的互動元素
- 大型（8px）：特色卡片、hero 元素
- 複合：`0px 0px 6px 6px` 用於下緣圓角容器（tab 面板、下拉選單頁尾）

## 6. 深度與層次

| 層級 | 處理方式 | 用途 |
|-------|-----------|-----|
| Flat（Level 0） | 無陰影 | 頁面背景、inline 文字 |
| Ambient（Level 1） | `rgba(23,23,23,0.06) 0px 3px 6px` | 細微卡片浮起、hover 提示 |
| Standard（Level 2） | `rgba(23,23,23,0.08) 0px 15px 35px` | 標準卡片、內容面板 |
| Elevated（Level 3） | `rgba(50,50,93,0.25) 0px 30px 45px -30px, rgba(0,0,0,0.1) 0px 18px 36px -18px` | 特色卡片、下拉選單、popover |
| Deep（Level 4） | `rgba(3,3,39,0.25) 0px 14px 21px -14px, rgba(0,0,0,0.1) 0px 8px 17px -8px` | 對話框、懸浮面板 |
| Ring（可及性） | `2px solid #533afd` outline | 鍵盤 focus 光環 |

**陰影哲學**：Stripe 的陰影系統建立在「色彩深度」原則上。多數設計系統使用中性灰或黑色陰影，Stripe 的主陰影色（`rgba(50,50,93,0.25)`）卻是一抹深藍灰，呼應品牌的海軍色調。這樣的陰影不僅製造深度，更帶來品牌氛圍。多層手法把這層藍調陰影與另一層純黑色陰影（`rgba(0,0,0,0.1)`）以不同偏移量配對，創造出視差般的深度 — 帶品牌色的陰影離元素較遠，中性陰影離元素較近。負 spread 值（-30px、-18px）確保陰影不會橫向超出元素範圍，讓層次感維持垂直且受控。

### 裝飾性深度
- 深色品牌區塊（`#1c1e54`）透過背景對比創造沉浸式深度
- Hero 裝飾使用 ruby 到 magenta 的漸層覆蓋
- 陰影色 `rgba(0,55,112,0.08)`（`--hds-color-shadow-sm-top`）用於 sticky 元素的上緣陰影

## 7. Do's and Don'ts

### Do
- 所有文字使用 sohne-var 並啟用 `"ss01"` — 樣式集本身就是品牌
- 所有標題與內文使用字重 300 — 輕盈就是標誌
- 所有浮起元素使用藍調陰影（`rgba(50,50,93,0.25)`）
- 標題使用 `#061b31`（深海軍藍）而非 `#000000` — 那份溫度有差
- 圓角保持在 4px–8px — 保守的圓角是刻意設計
- 任何表格／財務數字顯示使用 `"tnum"`
- 多層陰影：藍調陰影遠、中性陰影近，形成深度視差
- 主要互動／CTA 使用 `#533afd` 紫色

### Don't
- 不要在 sohne-var 標題用 600–700 字重 — 300 才是品牌嗓音
- 不要在卡片或按鈕用大圓角（12px+、藥丸形） — Stripe 講究保守
- 不要用中性灰陰影 — 永遠帶藍色（`rgba(50,50,93,...)`）
- 不要在 sohne-var 文字上省略 `"ss01"` — 那些替代字形定義了個性
- 不要在標題用純黑（`#000000`） — 永遠用 `#061b31` 深海軍藍
- 不要在互動元素用暖色（橘、黃） — 紫色才是主色
- 不要在 display 尺寸採用正字距 — Stripe 採緊湊字距
- 不要把 magenta／ruby 強調色用在按鈕或連結上 — 那些只用於裝飾／漸層

## 8. 響應式行為

### 斷點
| 名稱 | 寬度 | 主要變化 |
|------|-------|-------------|
| Mobile | <640px | 單欄、縮小的標題尺寸、堆疊卡片 |
| Tablet | 640–1024px | 2 欄 grid、適中 padding |
| Desktop | 1024–1280px | 完整佈局、3 欄特色 grid |
| Large Desktop | >1280px | 內容置中並有寬鬆邊距 |

### 觸控目標
- 按鈕採用舒適的 padding（垂直 8px–16px）
- 導覽連結 14px 並有足夠間距
- 徽章水平 padding 至少 6px 以利點擊
- 行動裝置導覽切換鈕採 6px 圓角

### 收合策略
- Hero：56px display → 行動裝置 32px，維持字重 300
- 導覽：水平連結加 CTA → 漢堡選單
- 特色卡片：3 欄 → 2 欄 → 單欄堆疊
- 深色品牌區塊：維持滿版處理，縮小內部 padding
- 財務資料表格：行動裝置水平捲動
- 區塊間距：64px+ → 行動裝置 40px
- 字型尺寸壓縮：hero 56px → 48px → 32px 隨斷點變化

### 圖像行為
- 儀表板／產品截圖在所有尺寸下都維持藍調陰影
- Hero 漸層裝飾在行動裝置上簡化
- 程式碼區塊維持 `SourceCodePro` 樣式，可水平捲動
- 卡片圖像維持一致的 4px–6px 圓角

## 9. Agent 提示詞指南

### 快速配色參考
- 主要 CTA：Stripe Purple（`#533afd`）
- CTA Hover：Purple Dark（`#4434d4`）
- 背景：Pure White（`#ffffff`）
- 標題文字：Deep Navy（`#061b31`）
- 內文：Slate（`#64748d`）
- 標籤文字：Dark Slate（`#273951`）
- 邊框：Soft Blue（`#e5edf5`）
- 連結：Stripe Purple（`#533afd`）
- 深色區塊：Brand Dark（`#1c1e54`）
- 成功：Green（`#15be53`）
- 裝飾強調：Ruby（`#ea2261`）、Magenta（`#f96bee`）

### 元件提示詞範例
- 「製作 hero 區塊：白色背景。標題 48px sohne-var 字重 300，行高 1.15，字距 -0.96px，顏色 #061b31，font-feature-settings 'ss01'。副標 18px 字重 300，行高 1.40，顏色 #64748d。紫色 CTA 按鈕（#533afd，4px 圓角，8px 16px padding，白色文字）與 ghost 按鈕（透明，1px solid #b9b9f9，#533afd 文字，4px 圓角）。」
- 「設計一張卡片：白底，1px solid #e5edf5 邊框，6px 圓角。陰影：rgba(50,50,93,0.25) 0px 30px 45px -30px, rgba(0,0,0,0.1) 0px 18px 36px -18px。標題 22px sohne-var 字重 300，字距 -0.22px，顏色 #061b31，'ss01'。內文 16px 字重 300，#64748d。」
- 「製作成功徽章：rgba(21,190,83,0.2) 背景，#108c3d 文字，4px 圓角，1px 6px padding，10px sohne-var 字重 300，邊框 1px solid rgba(21,190,83,0.4)。」
- 「製作導覽列：白色 sticky header 帶 backdrop-filter blur(12px)。連結 sohne-var 14px 字重 400，#061b31 文字，'ss01'。紫色 CTA『Start now』靠右（#533afd 背景，白色文字，4px 圓角）。導覽容器 6px 圓角。」
- 「設計深色品牌區塊：#1c1e54 背景，白色文字。標題 32px sohne-var 字重 300，字距 -0.64px，'ss01'。內文 16px 字重 300，rgba(255,255,255,0.7)。內部卡片用 rgba(255,255,255,0.1) 邊框，6px 圓角。」

### 迭代指南
1. 一律在 sohne-var 文字上啟用 `font-feature-settings: "ss01"` — 這是品牌的字型 DNA
2. 預設字重 300；只有按鈕／連結／導覽用 400
3. 陰影公式：`rgba(50,50,93,0.25) 0px Y1 B1 -S1, rgba(0,0,0,0.1) 0px Y2 B2 -S2`，其中 Y1／B1 較大（遠陰影），Y2／B2 較小（近陰影）
4. 標題色用 `#061b31`（深海軍藍），內文用 `#64748d`（slate），標籤用 `#273951`（深 slate）
5. 圓角維持在 4px–8px — 不用藥丸形或大圓角
6. 表格、圖表或財務顯示中的任何數字都用 `"tnum"`
7. 深色區塊用 `#1c1e54` — 不是黑、不是灰，而是深品牌靛藍
8. 程式碼用 SourceCodePro，12px／500，行高 2.00（為閱讀性刻意拉大）
