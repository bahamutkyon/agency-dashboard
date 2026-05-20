# 取自 Ollama 的設計系統

> 分類：AI & LLM
> 在本機跑 LLM。Terminal 優先、單色極簡。

## 1. 視覺主題與氛圍

Ollama 的介面把激進極簡主義推到極致——一片純白的空無，內容浮在上面，沒有裝飾、沒有陰影、沒有顏色。設計哲學和產品本身一致：去掉所有不必要的東西，只留下這把工具本身。這是 Dieter Rams 式物件的數位版——每個像素都得掙得自己的位置，而設計的「沒有」本身就是設計。

整個頁面只活在純灰階裡。介面裡完全沒有彩色——沒有品牌藍、沒有點綴綠、沒有語意紅。唯一存在的「顏色」就是純黑（`#000000`）到純白（`#ffffff`）之間的灰階，做出一個單色環境，讓使用者對「開放模型」的心智模型不被品牌色觀點染色。Ollama 的羊駝吉祥物用簡單黑色線稿呈現，是整個介面唯一的插畫——而且它自己也是單色的。

讓 Ollama 與眾不同的是 SF Pro Rounded（Apple 的圓潤系統字體）配上全是膠囊形（互動元素一律 9999px 圓角）的幾何語言。圓潤字形 + 圓潤按鈕 + 圓潤容器，組成一致的「柔軟語言」，讓開發者 CLI 工具顯得平易近人，而不是高冷難搞。這是有溫度的極簡——不是冷冰冰的瑞士格線極簡，而是邊角都真的被磨圓的那種。

**關鍵特徵：**
- 純白畫布，零彩色——徹底灰階
- SF Pro Rounded 標題，帶有明顯的 Apple 式柔軟感
- 二元 border-radius 系統：12px（容器）或 9999px（所有互動元素）
- 零陰影——深度只靠背景色變化和邊框
- 所有互動元素都是膠囊形（按鈕、tab、輸入框、tag）
- Ollama 羊駝是唯一插畫——黑色線稿，沒有顏色
- 極致內容克制——首頁短、聚焦、不擁擠

## 2. 配色系統與角色

### 主色
- **Pure Black**（`#000000`）：主要標題、主連結、最深的文字色。唯一一個「敢」抓眼球的色。
- **Near Black**（`#262626`）：淺色表面上的按鈕文字、次要標題字重。
- **Darkest Surface**（`#090909`）：可能的最深表面——和純黑幾乎分不出來，用在頁尾或深色容器。

### 表面與背景
- **Pure White**（`#ffffff`）：主要頁面背景——不是 off-white、不是奶油色，就是純白。次要操作的按鈕表面也用它。
- **Snow**（`#fafafa`）：和白色之間最細微的表面區別——用在章節背景和幾乎沒浮起的容器。
- **Light Gray**（`#e5e5e5`）：按鈕背景、邊框、主要的包覆色。中性色裡的主力。

### 中性色與文字
- **Stone**（`#737373`）：次要內文、頁尾連結、減弱內容。主要的「muted」色調。
- **Mid Gray**（`#525252`）：強調過的次要文字，比 Stone 略深。
- **Silver**（`#a3a3a3`）：第三層文字、placeholder、深度減弱的 metadata。
- **Button Text Dark**（`#404040`）：白色表面按鈕的專用文字色。

### 語意與點綴
- **Ring Blue**（`#3b82f6` 50%）：整個系統**唯一**的非灰色——Tailwind 預設 focus ring，只為了鍵盤無障礙存在，正常互動流程裡看不到。
- **Border Light**（`#d4d4d4`）：略深的灰，用在白色表面按鈕的邊框。

### 漸層系統
- **無。** Ollama 完全不用漸層。視覺分區靠純色色塊和 1px 邊框。這是刻意、近乎哲學的設計選擇。

## 3. 字型系統

### 字型家族
- **Display**：`SF Pro Rounded`，fallback：`system-ui, -apple-system, system-ui`
- **內文 / UI**：`ui-sans-serif`，fallback：`system-ui, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji`
- **Monospace**：`ui-monospace`，fallback：`SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New`

*備註：SF Pro Rounded 是 Apple 系統字體——在 macOS/iOS 上呈現圓端字形，其他平台 fallback 到系統 sans-serif。*

### 層級

| 角色 | 字型 | 大小 | 字重 | 行高 | 字距 | 說明 |
|------|------|------|------|------|------|------|
| Display / Hero | SF Pro Rounded | 48px (3rem) | 500 | 1.00（緊） | normal | 最大衝擊力，圓端字形 |
| Section Heading | SF Pro Rounded | 36px (2.25rem) | 500 | 1.11（緊） | normal | 特色章節標題 |
| Sub-heading | SF Pro Rounded / ui-sans-serif | 30px (1.88rem) | 400–500 | 1.20（緊） | normal | 卡片標題、特色名稱 |
| Card Title | ui-sans-serif | 24px (1.5rem) | 400 | 1.33 | normal | 中度強調的標題 |
| Body Large | ui-sans-serif | 18px (1.13rem) | 400–500 | 1.56 | normal | Hero 描述、按鈕文字 |
| Body / Link | ui-sans-serif | 16px (1rem) | 400–500 | 1.50 | normal | 標準內文、導覽 |
| Caption | ui-sans-serif | 14px (0.88rem) | 400 | 1.43 | normal | metadata、描述 |
| Small | ui-sans-serif | 12px (0.75rem) | 400 | 1.33 | normal | 最小 sans-serif 文字 |
| Code Body | ui-monospace | 16px (1rem) | 400 | 1.50 | normal | 行內程式碼、指令 |
| Code Caption | ui-monospace | 14px (0.88rem) | 400 | 1.43 | normal | 程式碼片段、次要 |
| Code Small | ui-monospace | 12px (0.75rem) | 400–700 | 1.63 | normal | tag、標籤 |

### 原則
- **Display 用圓潤體，內文用標準體**：SF Pro Rounded 用它招牌的圓端字形撐起 Display 標題；標準系統 sans 處理所有內文。圓潤字形本身就是品牌表達。
- **字重克制**：只有兩個字重重要——400（regular）給內文、500（medium）給標題。沒有粗、沒有細、沒有 black。這種極致克制呼應極簡哲學。
- **Display 緊、內文鬆**：標題壓到 1.0 行高，內文放鬆到 1.43–1.56。對比本身就拉出層級，不用靠字重對比。
- **monospace 是開發者身分**：程式碼區塊和終端機指令常常以主要內容出現，使用系統 monospace stack。

## 4. 元件樣式

### 按鈕

**Gray Pill（主要）**
- 背景：Light Gray（`#e5e5e5`）
- 文字：Near Black（`#262626`）
- Padding：10px 24px
- Border：細實線 Light Gray（`1px solid #e5e5e5`）
- 圓角：膠囊形（9999px）
- 主要操作按鈕——低調、灰階、永遠膠囊形

**White Pill（次要）**
- 背景：Pure White（`#ffffff`）
- 文字：Button Text Dark（`#404040`）
- Padding：10px 24px
- Border：細實線 Border Light（`1px solid #d4d4d4`）
- 圓角：膠囊形（9999px）
- 次要操作——視覺上比 Gray Pill 輕

**Black Pill（CTA）**
- 背景：Pure Black（`#000000`）
- 文字：Pure White（`#ffffff`）
- 圓角：膠囊形（9999px）
- 推測自「Create account」「Explore」按鈕
- 最強強調——黑底白字

### 卡片與容器
- 背景：Pure White 或 Snow（`#fafafa`）
- Border：需要時用細實線 Light Gray（`1px solid #e5e5e5`）
- 圓角：舒適圓（12px）——這是系統裡**唯一**的非膠囊圓角
- 陰影：**無**——任何元素都不加陰影
- Hover：可能是背景微微切換或邊框稍深

### 輸入與表單
- 背景：Pure White
- Border：`1px solid #e5e5e5`
- 圓角：膠囊形（9999px）——搜尋輸入框和表單欄位都是膠囊形
- Focus：Ring Blue（`#3b82f6` 50%）ring
- Placeholder：Silver（`#a3a3a3`）

### 導覽
- 乾淨水平導覽，元素極少
- Logo：Ollama 羊駝 icon + 文字標，黑色
- 連結：「Models」「Docs」「Pricing」黑色 16px、字重 400
- 搜尋列：膠囊形，含 placeholder
- 右側：「Sign in」連結 + 「Download」黑色膠囊 CTA
- 沒邊框、沒背景——導覽在白頁上是透明的

### 圖片處理
- Ollama 羊駝吉祥物是唯一插畫——白底黑色線稿
- 程式碼截圖／終端機輸出放在帶邊框的容器（12px 圓角）裡
- 整合 logo 以簡單 icon 排成網格
- 沒有照片、沒有漸層、沒有裝飾性圖片

### 招牌元件

**Tab 膠囊**
- 膠囊形 tab 選擇器（例如「Coding」｜「OpenClaw」）
- 啟用：Light Gray 背景；停用：透明
- 全部膠囊形（9999px）

**Model Tags**
- 小型膠囊 tag（例如「ollama」「launch」「claude」）
- Light Gray 背景，深色文字
- 瀏覽模型的主要方式

**Terminal 指令區塊**
- 顯示 `ollama run` 指令的 monospace 程式碼
- 樣式極簡——只是一個 12px 圓角的帶邊框容器
- 內建複製按鈕

**整合網格**
- 整合 logo 網格（Codex、Claude Code、OpenCode、LangChain 等）
- 每個都在帶邊框的膠囊或卡片裡，附 icon + 名稱
- 用分頁分類（Coding、Documents & RAG、Automation、Chat）

## 5. 版面原則

### 間距系統
- 基本單位：8px
- 級距：4px、6px、8px、9px、10px、12px、14px、16px、20px、24px、32px、40px、48px、88px、112px
- 按鈕 padding：10px 24px（所有按鈕一致）
- 卡片內距：約 24–32px
- 章節垂直間距：非常寬鬆（88px–112px）

### 網格與容器
- 容器最大寬度：約 1024–1280px，置中
- Hero：置中單欄配羊駝插畫
- 特色章節：2 欄版面（文字左、程式碼右）
- 整合網格：響應式多欄
- 頁尾：乾淨單列

### 留白哲學
- **空無即奢華**：頁面短到誇張，沒有任何特色章節久留——每個概念只給最低限度但夠用的空間。
- **內容密度刻意低**：當其他 AI 公司一個特色塞滿一個特色時，Ollama 講三件事（跑模型、跟 app 一起用、整合）就停手。
- **留白本身就是品牌**：純白、零裝飾的留白，傳達的是「這把工具會自己讓開」。

### 圓角級距
- 舒適圓（12px）：唯一的容器圓角——程式碼區塊、卡片、面板
- 膠囊形（9999px）：所有互動元素——按鈕、tab、輸入框、tag、徽章

*這套二元系統極端而獨特。沒有 4px、沒有 8px、沒有漸進的圓度。元素不是容器（12px）就是互動（膠囊）。*

## 6. 深度與層次

| 層級 | 處理 | 用途 |
|------|------|------|
| Flat (Level 0) | 無陰影、無 border | 頁面背景、大多數內容 |
| Bordered (Level 1) | `1px solid #e5e5e5` | 卡片、程式碼區塊、按鈕 |

**陰影哲學**：Ollama **零陰影**。這不是疏忽——是刻意決定。每個主流 AI 產品網站至少都有細微陰影；Ollama 的扁平、無陰影做法做出紙張般的體驗，元素純粹靠背景色和 1px 邊框區隔。深度透過**內容階層和字型字重**傳達，不是視覺堆疊。

## 7. Do's 與 Don'ts

### Do
- 頁面背景用純白（`#ffffff`）——絕不用 off-white 或奶油色
- 所有互動元素用膠囊形圓角（9999px）——按鈕、tab、輸入框、tag
- 所有非互動容器用 12px 圓角——程式碼區塊、卡片、面板
- 色盤嚴格灰階——除了藍色 focus ring 以外不要有彩色
- Display 標題用 SF Pro Rounded 字重 500——圓端字形就是品牌表達
- 維持零陰影——深度只靠邊框和背景色切換
- 內容密度保持低——每個章節呈現一個清楚的想法
- 終端機指令和程式碼用 monospace——它是主要內容，不是裝飾
- 所有按鈕都用 10px 24px padding 和膠囊形——一致性是絕對的

### Don't
- 不要引入任何彩色——沒有品牌藍、沒有點綴綠、沒有暖色調
- border-radius 不要落在 12px 到 9999px 之間——系統是二元的
- 任何元素都不要加陰影——扁平美學是刻意的
- 字重不要超過 500——沒有粗體、沒有 black
- 不要加除了羊駝以外的裝飾插畫
- 任何地方都不要用漸層——只有純色色塊和邊框
- 不要把版面搞複雜——最多兩欄，不要複雜網格
- 邊框不要超過 1px——包覆永遠是最輕的觸感
- 不要加 hover 動畫或 transition——互動該感覺是即時、直接的

## 8. RWD 行為

### 斷點
| 名稱 | 寬度 | 主要變化 |
|------|------|----------|
| Mobile | <640px | 單欄、全部堆疊、漢堡導覽 |
| Small Tablet | 640–768px | 間距微調 |
| Tablet | 768–850px | 開始出現 2 欄版面 |
| Desktop | 850–1024px | 標準版面、展開特色 |
| Large Desktop | 1024–1280px | 內容寬度最大 |

### 觸控目標
- 所有按鈕膠囊形，padding 寬鬆（10px 24px）
- 導覽連結 16px，舒適
- 最小觸控區輕鬆超過 44x44px

### 收合策略
- **導覽**：mobile 收成漢堡選單
- **特色章節**：2 欄 → 堆疊單欄
- **Hero 文字**：48px → 36px → 30px 漸進縮放
- **整合網格**：多欄 → 2 欄 → 單欄
- **程式碼區塊**：保留水平捲動

### 圖片行為
- 羊駝吉祥物等比縮放
- 程式碼區塊維持 monospace 排版
- 整合 icon 自動回流成較少欄數
- 不做藝術指導切換

## 9. Agent Prompt 指南

### 快速色票
- 主要文字：「Pure Black (#000000)」
- 頁面背景：「Pure White (#ffffff)」
- 次要文字：「Stone (#737373)」
- 按鈕背景：「Light Gray (#e5e5e5)」
- 邊框：「Light Gray (#e5e5e5)」
- 弱化文字：「Silver (#a3a3a3)」
- 深色文字：「Near Black (#262626)」
- 微表面：「Snow (#fafafa)」

### 元件 prompt 範例
- 「在純白 (#ffffff) 上建立 hero 章節，插畫置中放在標題上方。標題用 48px SF Pro Rounded 字重 500、行高 1.0、Pure Black (#000000) 文字。下方放一顆黑色膠囊 CTA（9999px 圓角、10px 24px padding）和一顆灰色膠囊按鈕。」
- 「設計一個程式碼區塊：12px border-radius，白底加 1px solid Light Gray (#e5e5e5) 邊框。終端機指令用 ui-monospace 16px。無陰影。」
- 「做一條 tab 列，tab 是膠囊形（9999px）。啟用 tab：Light Gray (#e5e5e5) 背景、Near Black (#262626) 文字；停用：透明背景、Stone (#737373) 文字。」
- 「做一個整合卡片網格。每張卡片是帶邊框的膠囊（9999px）或 12px 圓角的卡片，邊框 1px solid #e5e5e5，內含 icon + 名稱。Desktop 排 4 欄。」
- 「設計導覽列：透明背景、無邊框。Ollama logo 在左，3 個文字連結（Pure Black、16px、字重 400），中間放膠囊搜尋輸入框，右側是『Sign in』文字連結和『Download』黑色膠囊按鈕。」

### 迭代指南
1. 一次處理一個元件
2. 所有值都灰階——「Stone (#737373)」而不是「用個淺色」
3. 一律指定膠囊（9999px）或容器（12px）圓角——中間沒有
4. 陰影永遠是零——絕不加
5. 字重永遠 400 或 500——絕不粗體
6. 如果哪裡感覺太裝飾，就拿掉——對 Ollama 來說，少就是多
