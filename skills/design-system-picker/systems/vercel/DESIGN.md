# 取自 Vercel 的設計系統

> 分類：Developer Tools
> 前端部署。黑白精準、Geist 字體。

## 1. 視覺主題與氛圍

Vercel 的網站是「讓開發者基礎建設變得隱形」的視覺論文——一個克制到接近哲學的設計系統。頁面幾乎全是白（`#ffffff`）配近黑（`#171717`）文字，做出像畫廊一樣的空無，每個元素都要掙得自己的像素。這不是裝飾性極簡；是工程原則式極簡。Geist 設計系統對待介面就像 compiler 對待程式碼——剝掉每一個不必要的 token，只留下結構。

客製字型家族 Geist 是皇冠上的寶石。Geist Sans 在 Display 尺寸用激進的負字距（-2.4px 到 -2.88px），做出感覺被壓縮、急切、工程化的標題——像被 minified 上線的程式碼。在內文尺寸字距放鬆，但幾何精準仍在。Geist Mono 補上整個系統，作為程式碼、終端機輸出、技術標籤的 monospace 搭擋。兩款字體都全域啟用 OpenType `"liga"`（連字），加一層耐看的字型細節。

讓 Vercel 從其他單色設計系統脫穎而出的，是「shadow-as-border」哲學。Vercel 不用傳統 CSS border，而用 `box-shadow: 0px 0px 0px 1px rgba(0,0,0,0.08)`——零偏移、零模糊、1px 擴散的陰影，做出像 border 的線條卻沒有 box model 的副作用。這手法讓 border 存在於陰影層，能做出更平順的 transition、不會被圓角裁切、視覺重量比傳統 border 更輕。整套深度系統建立在多層陰影堆疊上，每一層有自己的角色：一層做 border、一層做柔軟浮起、一層做環境光深度。

**關鍵特徵：**
- Geist Sans 在 Display 用極端負字距（-2.4px 到 -2.88px）——文字像被壓縮的基礎建設
- Geist Mono 用於程式碼和技術標籤，全域啟用 OpenType `"liga"`
- shadow-as-border 手法：通篇用 `box-shadow 0px 0px 0px 1px` 取代傳統 border
- 多層陰影堆疊做細膩深度（一個宣告裡同時有 border + 浮起 + 環境光）
- 近純白畫布配 `#171717` 文字——不是純黑，做出微對比的柔軟
- 工作流情境的點綴色：Ship Red（`#ff5b4f`）、Preview Pink（`#de1d8d`）、Develop Blue（`#0a72ef`）
- Focus ring 系統用 `hsla(212, 100%, 48%, 1)`——飽和藍給無障礙
- 膠囊徽章（9999px）配染色背景做狀態指示

## 2. 配色系統與角色

### 主色
- **Vercel Black**（`#171717`）：主要文字、標題、深色表面背景。不是純黑——略帶暖度，避免刺眼。
- **Pure White**（`#ffffff`）：頁面背景、卡片表面、深底上的按鈕文字。
- **True Black**（`#000000`）：次要使用，`--geist-console-text-color-default`，用於特定 console/程式碼情境。

### 工作流點綴色
- **Ship Red**（`#ff5b4f`）：`--ship-text`，「ship to production」工作流步驟——暖、急切的珊瑚紅。
- **Preview Pink**（`#de1d8d`）：`--preview-text`，preview 部署工作流——鮮明的洋紅。
- **Develop Blue**（`#0a72ef`）：`--develop-text`，development 工作流——明亮、聚焦的藍。

### Console / 程式碼色
- **Console Blue**（`#0070f3`）：`--geist-console-text-color-blue`，語法高亮藍。
- **Console Purple**（`#7928ca`）：`--geist-console-text-color-purple`，語法高亮紫。
- **Console Pink**（`#eb367f`）：`--geist-console-text-color-pink`，語法高亮粉。

### 互動色
- **Link Blue**（`#0072f5`）：主要連結色，含底線裝飾。
- **Focus Blue**（`hsla(212, 100%, 48%, 1)`）：`--ds-focus-color`，互動元素 focus ring。
- **Ring Blue**（`rgba(147, 197, 253, 0.5)`）：`--tw-ring-color`，Tailwind ring utility。

### 中性級距
- **Gray 900**（`#171717`）：主要文字、標題、導覽文字。
- **Gray 600**（`#4d4d4d`）：次要文字、描述。
- **Gray 500**（`#666666`）：第三層文字、弱化連結。
- **Gray 400**（`#808080`）：placeholder、disabled 狀態。
- **Gray 100**（`#ebebeb`）：邊框、卡片輪廓、分隔線。
- **Gray 50**（`#fafafa`）：細微表面染色、內陰影高光。

### 表面與覆蓋
- **Overlay Backdrop**（`hsla(0, 0%, 98%, 1)`）：`--ds-overlay-backdrop-color`，modal/dialog 背幕。
- **Selection Text**（`hsla(0, 0%, 95%, 1)`）：`--geist-selection-text-color`，文字選取高亮。
- **Badge Blue Bg**（`#ebf5ff`）：膠囊徽章背景，染色藍表面。
- **Badge Blue Text**（`#0068d6`）：膠囊徽章文字，深一點的藍以保可讀。

### 陰影與深度
- **Border Shadow**（`rgba(0, 0, 0, 0.08) 0px 0px 0px 1px`）：招牌——取代傳統 border。
- **Subtle Elevation**（`rgba(0, 0, 0, 0.04) 0px 2px 2px`）：卡片的最小浮起。
- **Card Stack**（`rgba(0,0,0,0.08) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 2px, rgba(0,0,0,0.04) 0px 8px 8px -8px, #fafafa 0px 0px 0px 1px`）：完整多層卡片陰影。
- **Ring Border**（`rgb(235, 235, 235) 0px 0px 0px 1px`）：tab 和圖片用的淺灰 ring-border。

## 3. 字型系統

### 字型家族
- **主要**：`Geist`，fallback：`Arial, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol`
- **Monospace**：`Geist Mono`，fallback：`ui-monospace, SFMono-Regular, Roboto Mono, Menlo, Monaco, Liberation Mono, DejaVu Sans Mono, Courier New`
- **OpenType 特性**：所有 Geist 文字全域啟用 `"liga"`；特定 caption 啟用 `"tnum"` 做表格數字。

### 層級

| 角色 | 字型 | 大小 | 字重 | 行高 | 字距 | 說明 |
|------|------|------|------|------|------|------|
| Display Hero | Geist | 48px (3.00rem) | 600 | 1.00–1.17（緊） | -2.4px 到 -2.88px | 最大壓縮、看板級衝擊力 |
| Section Heading | Geist | 40px (2.50rem) | 600 | 1.20（緊） | -2.4px | 特色章節標題 |
| Sub-heading Large | Geist | 32px (2.00rem) | 600 | 1.25（緊） | -1.28px | 卡片標題、子章節 |
| Sub-heading | Geist | 32px (2.00rem) | 400 | 1.50 | -1.28px | 較輕的子標題 |
| Card Title | Geist | 24px (1.50rem) | 600 | 1.33 | -0.96px | 特色卡片 |
| Card Title Light | Geist | 24px (1.50rem) | 500 | 1.33 | -0.96px | 次要卡片標題 |
| Body Large | Geist | 20px (1.25rem) | 400 | 1.80（寬） | normal | 引言、特色描述 |
| Body | Geist | 18px (1.13rem) | 400 | 1.56 | normal | 標準閱讀文字 |
| Body Small | Geist | 16px (1.00rem) | 400 | 1.50 | normal | 標準 UI 文字 |
| Body Medium | Geist | 16px (1.00rem) | 500 | 1.50 | normal | 導覽、強調文字 |
| Body Semibold | Geist | 16px (1.00rem) | 600 | 1.50 | -0.32px | 強標籤、active 狀態 |
| Button / Link | Geist | 14px (0.88rem) | 500 | 1.43 | normal | 按鈕、連結、caption |
| Button Small | Geist | 14px (0.88rem) | 400 | 1.00（緊） | normal | 緊湊按鈕 |
| Caption | Geist | 12px (0.75rem) | 400–500 | 1.33 | normal | metadata、tag |
| Mono Body | Geist Mono | 16px (1.00rem) | 400 | 1.50 | normal | 程式碼區塊 |
| Mono Caption | Geist Mono | 13px (0.81rem) | 500 | 1.54 | normal | 程式碼標籤 |
| Mono Small | Geist Mono | 12px (0.75rem) | 500 | 1.00（緊） | normal | `text-transform: uppercase`、技術標籤 |
| Micro Badge | Geist | 7px (0.44rem) | 700 | 1.00（緊） | normal | `text-transform: uppercase`、極小徽章 |

### 原則
- **壓縮就是身分**：Geist Sans 在 Display 用 -2.4px 到 -2.88px 字距——所有主流設計系統裡最激進的負字距。讓文字感覺被 _minified_，像為上線優化過的程式碼。字距隨尺寸縮小漸進放鬆：32px 時 -1.28px、24px 時 -0.96px、16px 時 -0.32px、14px 時 normal。
- **連字無所不在**：每個 Geist 文字元素都啟用 OpenType `"liga"`。連字不是裝飾——是結構，做出更緊、更有效率的字符組合。
- **三字重、嚴格分工**：400（內文/閱讀）、500（UI/互動）、600（標題/強調）。除了極小 micro 徽章外不用 bold（700）。這個窄字重區間讓階層靠尺寸和字距撐起來，不靠字重。
- **mono 是身分**：Geist Mono 大寫配 `"tnum"` 或 `"liga"`，扮演「開發者 console 嗓音」——緊湊技術標籤，把行銷網站和產品串連。

## 4. 元件樣式

### 按鈕

**Primary White（陰影邊框）**
- 背景：`#ffffff`
- 文字：`#171717`
- Padding：0px 6px（極簡——寬度跟著內容）
- 圓角：6px（微圓）
- 陰影：`rgb(235, 235, 235) 0px 0px 0px 1px`（ring-border）
- Hover：背景切到 `var(--ds-gray-1000)`（深色）
- Focus：`2px solid var(--ds-focus-color)` 輪廓 + `var(--ds-focus-ring)` 陰影
- 用途：標準次要按鈕

**Primary Dark（從 Geist 系統推得）**
- 背景：`#171717`
- 文字：`#ffffff`
- Padding：8px 16px
- 圓角：6px
- 用途：主要 CTA（「Start Deploying」「Get Started」）

**Pill Button / 徽章**
- 背景：`#ebf5ff`（染色藍）
- 文字：`#0068d6`
- Padding：0px 10px
- 圓角：9999px（完全膠囊）
- 字型：12px 字重 500
- 用途：狀態徽章、tag、特色標籤

**Large Pill（導覽）**
- 背景：透明或 `#171717`
- 圓角：64px–100px
- 用途：tab 導覽、章節選擇器

### 卡片與容器
- 背景：`#ffffff`
- Border：透過陰影——`rgba(0, 0, 0, 0.08) 0px 0px 0px 1px`
- 圓角：8px（標準）、12px（強調/圖片卡片）
- 陰影堆疊：`rgba(0,0,0,0.08) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 2px, #fafafa 0px 0px 0px 1px`
- 圖片卡片：`1px solid #ebebeb`，頂部 12px 圓角
- Hover：陰影微微加深

### 輸入與表單
- Radio：標準樣式，focus 帶 `var(--ds-gray-200)` 背景
- Focus 陰影：`1px 0 0 0 var(--ds-gray-alpha-600)`
- Focus 輪廓：`2px solid var(--ds-focus-color)`——一致的藍色 focus ring
- Border：透過陰影手法，不用傳統 border

### 導覽
- 白色乾淨水平導覽，sticky
- Vercel 文字標左對齊，262x52px
- 連結：Geist 14px 字重 500、`#171717` 文字
- Active：字重 600 或底線
- CTA：深色膠囊按鈕（「Start Deploying」「Contact Sales」）
- Mobile：漢堡選單收合
- 產品下拉含多層選單

### 圖片處理
- 產品截圖配 `1px solid #ebebeb` 邊框
- 頂部圓角圖片：`12px 12px 0px 0px` 圓角
- Dashboard/code 預覽截圖主導特色章節
- hero 圖片後面用柔漸層（多色粉彩）

### 招牌元件

**Workflow Pipeline**
- 三步水平 pipeline：Develop → Preview → Ship
- 每步有自己的點綴色：Blue → Pink → Red
- 用線/箭頭串連
- Vercel 核心價值主張的視覺隱喻

**信任條 / Logo 網格**
- 公司 logo（Perplexity、ChatGPT、Cursor 等）以灰階呈現
- 水平捲動或網格版面
- 用 `#ebebeb` 細邊框分隔

**指標卡片**
- 大數字（例如「10x faster」）
- 指標用 Geist 48px 字重 600
- 下方描述用灰色內文
- 陰影邊框卡片容器

## 5. 版面原則

### 間距系統
- 基本單位：8px
- 級距：1px、2px、3px、4px、5px、6px、8px、10px、12px、14px、16px、32px、36px、40px
- 值得注意：從 16px 跳到 32px——主要級距裡沒有 20px 或 24px

### 網格與容器
- 內容最大寬度：約 1200px
- Hero：置中單欄，上 padding 寬鬆
- 特色章節：2–3 欄卡片網格
- 全寬分隔用 `border-bottom: 1px solid #171717`
- 程式碼/dashboard 截圖：全寬或加邊框收在容器內

### 留白哲學
- **畫廊式空無**：章節之間用巨量垂直 padding（80px–120px+）。留白本身就是設計——它在說 Vercel 沒什麼要證明、沒什麼要遮掩。
- **壓縮文字、開放空間**：標題的激進負字距被周圍寬鬆留白平衡。文字密；周圍空間廣。
- **章節節奏**：白章節接白章節——章節之間沒有色彩變化。分隔只靠邊框（shadow-border）和間距。

### 圓角級距
- 微（2px）：行內程式碼片段、小型 span
- 微圓（4px）：小容器
- 標準（6px）：按鈕、連結、功能元素
- 舒適（8px）：卡片、列表項
- 圖片（12px）：強調卡片、圖片容器（頂部圓角）
- 大（64px）：tab 導覽膠囊
- XL（100px）：大型導覽連結
- 完全膠囊（9999px）：徽章、狀態膠囊、tag
- 圓形（50%）：選單切換、頭像容器

## 6. 深度與層次

| 層級 | 處理 | 用途 |
|------|------|------|
| Flat (Level 0) | 無陰影 | 頁面背景、文字區塊 |
| Ring (Level 1) | `rgba(0,0,0,0.08) 0px 0px 0px 1px` | 大多數元素的 shadow-as-border |
| Light Ring (Level 1b) | `rgb(235,235,235) 0px 0px 0px 1px` | tab、圖片用的較淺 ring |
| Subtle Card (Level 2) | Ring + `rgba(0,0,0,0.04) 0px 2px 2px` | 標準卡片，最小浮起 |
| Full Card (Level 3) | Ring + Subtle + `rgba(0,0,0,0.04) 0px 8px 8px -8px` + 內 `#fafafa` ring | 強調卡片、highlight 面板 |
| Focus（無障礙） | `2px solid hsla(212, 100%, 48%, 1)` 輪廓 | 所有互動元素的鍵盤 focus |

**陰影哲學**：Vercel 可能擁有現代網頁設計裡最精緻的陰影系統。它不是用 Material Design 傳統意義上的陰影做層次，而是用多值陰影堆疊，每一層有獨立的建築角色：一個做「border」（0px 擴散、1px），一個加環境柔軟（2px 模糊），一個處理距離深度（8px 模糊配負擴散），內 ring（`#fafafa`）做出細微高光，讓卡片像從內部「發光」。這種層次做法讓卡片感覺被建造，而不是飄著。

### 裝飾性深度
- Hero 漸層：hero 內容後面是柔柔的多色粉彩漸層（幾乎看不見、氛圍式的）
- 章節邊框：主要章節之間用 `1px solid #171717`（完整深色線）
- 沒有背景色變化——深度完全靠陰影堆疊和邊框對比

## 7. Do's 與 Don'ts

### Do
- Display 尺寸用 Geist Sans 配激進負字距（48px 時 -2.4px 到 -2.88px）
- 用 shadow-as-border（`0px 0px 0px 1px rgba(0,0,0,0.08)`）取代傳統 CSS border
- 所有 Geist 文字啟用 `"liga"`——連字是結構，不是選配
- 用三字重系統：400（內文）、500（UI）、600（標題）
- 工作流點綴色（Red/Pink/Blue）只用在工作流情境
- 卡片用多層陰影堆疊（border + 浮起 + 環境光 + 內高光）
- 色盤維持無彩——從 `#171717` 到 `#ffffff` 的灰階就是系統
- 主要文字用 `#171717` 而非 `#000000`——微暖度很重要

### Don't
- Geist Sans 不要用正字距——永遠是負或零
- 內文不要用字重 700（bold）——600 是上限，只給標題
- 卡片不要用傳統 CSS `border`——用 shadow-border 手法
- UI chrome 不要引入暖色（橘、黃、綠）
- 不要把工作流點綴色（Ship Red、Preview Pink、Develop Blue）當裝飾用
- 不要用重陰影（不透明度 > 0.1）——陰影系統是低語層級
- 內文字距不要加正值——Geist 就是設計來跑緊的
- 主要操作按鈕不要用膠囊圓角（9999px）——膠囊留給徽章/tag
- 卡片陰影不要省略內 `#fafafa` ring——那個內發光是讓系統運作的關鍵

## 8. RWD 行為

### 斷點
| 名稱 | 寬度 | 主要變化 |
|------|------|----------|
| Mobile Small | <400px | 緊湊單欄、padding 最小 |
| Mobile | 400–600px | 標準 mobile、堆疊版面 |
| Tablet Small | 600–768px | 2 欄網格開始 |
| Tablet | 768–1024px | 完整卡片網格、padding 擴展 |
| Desktop Small | 1024–1200px | 標準 desktop 版面 |
| Desktop | 1200–1400px | 完整版面、內容最大寬 |
| Large Desktop | >1400px | 置中、邊距寬鬆 |

### 觸控目標
- 按鈕用舒適 padding（垂直 8px–16px）
- 導覽連結 14px，間距足夠
- 膠囊徽章水平 padding 10px，方便點擊
- Mobile 選單切換用 50% 圓角圓形按鈕

### 收合策略
- Hero：48px 縮小，按比例維持負字距
- 導覽：水平連結 + CTA → 漢堡選單
- 特色卡片：3 欄 → 2 欄 → 單欄堆疊
- 程式碼截圖：維持長寬比，可能水平捲動
- 信任條 logo：網格 → 水平捲動
- 頁尾：多欄 → 堆疊單欄
- 章節間距：80px+ → mobile 48px

### 圖片行為
- Dashboard 截圖各尺寸維持邊框處理
- Hero 漸層在 mobile 變柔/簡化
- 產品截圖用響應式圖片，圓角一致
- 全寬章節維持邊到邊處理

## 9. Agent Prompt 指南

### 快速色票
- 主要 CTA：Vercel Black（`#171717`）
- 背景：Pure White（`#ffffff`）
- 標題文字：Vercel Black（`#171717`）
- 內文：Gray 600（`#4d4d4d`）
- 邊框（陰影）：`rgba(0, 0, 0, 0.08) 0px 0px 0px 1px`
- 連結：Link Blue（`#0072f5`）
- Focus ring：Focus Blue（`hsla(212, 100%, 48%, 1)`）

### 元件 prompt 範例
- 「白底建立 hero 章節。標題用 Geist 48px 字重 600、行高 1.00、字距 -2.4px、色 #171717。副標 Geist 20px 字重 400、行高 1.80、色 #4d4d4d。深色 CTA 按鈕（#171717、6px 圓角、8px 16px padding）和 ghost 按鈕（白底、shadow-border rgba(0,0,0,0.08) 0px 0px 0px 1px、6px 圓角）。」
- 「設計卡片：白底、不用 CSS border。用陰影堆疊：rgba(0,0,0,0.08) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 2px, #fafafa 0px 0px 0px 1px。圓角 8px。標題 Geist 24px 字重 600、字距 -0.96px。內文 16px 字重 400、#4d4d4d。」
- 「做膠囊徽章：#ebf5ff 背景、#0068d6 文字、9999px 圓角、0px 10px padding、Geist 12px 字重 500。」
- 「做導覽：白色 sticky header。Geist 14px 字重 500 連結、#171717 文字。深色膠囊 CTA 『Start Deploying』右對齊。底部 shadow-border：rgba(0,0,0,0.08) 0px 0px 0px 1px。」
- 「設計顯示三步驟的工作流章節：Develop（文字色 #0a72ef）、Preview（#de1d8d）、Ship（#ff5b4f）。每步：Geist Mono 14px 大寫標籤 + Geist 24px 字重 600 標題 + 16px 字重 400 描述（#4d4d4d）。」

### 迭代指南
1. 一律用 shadow-as-border 取代 CSS border——`0px 0px 0px 1px rgba(0,0,0,0.08)` 是基礎
2. 字距隨字級變化：48px 時 -2.4px、32px 時 -1.28px、24px 時 -0.96px、14px 時 normal
3. 只用三字重：400（讀）、500（互動）、600（宣告）
4. 顏色是功能，絕不裝飾——工作流色（Red/Pink/Blue）只標 pipeline 階段
5. 卡片陰影裡的內 `#fafafa` ring 是讓 Vercel 卡片有細微內發光的關鍵
6. 技術標籤用 Geist Mono 大寫，其餘用 Geist Sans
