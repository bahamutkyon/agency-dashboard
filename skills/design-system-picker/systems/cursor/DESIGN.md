# 取自 Cursor 的設計系統

> 分類：Developer Tools
> AI 優先的程式編輯器。俐落深色介面、漸層點綴。

## 1. 視覺主題與氛圍

Cursor 的網站把暖色極簡和編輯器優雅揉在一起。整個體驗鋪在暖色 off-white 畫布（`#f2f1ed`）上，配深暖棕色文字（`#26251e`）——不是純黑、不是中性灰，而是帶黃底色的深暖近黑，讓人聯想到舊紙、油墨、手作。這份暖意滲透每個表面：背景靠向奶油色（`#e6e5e0`、`#ebeae5`），邊框用 `oklab` 色彩空間融成透明暖色覆蓋，連錯誤狀態（`#cf2d56`）都帶暖意，不是臨床冷紅。結果感覺更像精緻印刷品，而不是科技網站。

客製字體 CursorGothic 是字型上的招牌——一款 gothic sans-serif，在 Display 尺寸用激進的負字距（72px 時 -2.16px），做出壓縮、工程感的氛圍。第二個聲音是 jjannon serif（帶 OpenType `"cswh"` contextual swash alternates），為內文和編輯式段落提供文學氣息。monospace 聲音由 berkeleyMono 擔當——精緻的編碼字體，把行銷網站和 Cursor 作為程式編輯器的核心身分串連起來。這套三字型系統（gothic display、serif body、mono code）讓 Cursor 擁有開發者工具裡最豐富的字型色盤之一。

邊框系統特別有辨識度——Cursor 用 `oklab()` 色彩空間定邊框顏色，套用不同 alpha（0.1、0.2、0.55）的暖棕色，做出感覺有機而非機械的邊框。招牌邊框色 `oklab(0.263084 -0.00230259 0.0124794 / 0.1)` 不是簡單的 rgba 值，而是知覺均勻色，能在不同背景上維持視覺一致。

**關鍵特徵：**
- CursorGothic 在 Display 帶激進負字距（72px 時 -2.16px、36px 時 -0.72px），標題被壓縮
- jjannon serif 內文配 OpenType `"cswh"`（contextual swash alternates）
- berkeleyMono 用於程式碼和技術標籤
- 暖色 off-white 背景（`#f2f1ed`）取代純白——整套系統都向暖色偏
- 主要文字色 `#26251e`（帶黃底色的暖近黑）
- 點綴橘 `#f54e00` 用於品牌強調和連結
- oklab 空間邊框搭配多個 alpha，做出知覺均勻的邊處理
- 膠囊形元素用極端圓角（33.5M px，等同於完全膠囊）
- 8px 基礎間距系統，含細微的 sub-8px 增量（1.5px、2px、2.5px、3px、4px、5px、6px）

## 2. 配色系統與角色

### 主色
- **Cursor Dark**（`#26251e`）：主要文字、標題、深色 UI 表面。帶明顯黃褐底色的暖近黑——整套系統的定義色。
- **Cursor Cream**（`#f2f1ed`）：頁面背景、主要表面。不是白，是設定整個暖色基調的奶油色。
- **Cursor Light**（`#e6e5e0`）：次要表面、按鈕背景、卡片填色。略暖、略深的奶油色。
- **Pure White**（`#ffffff`）：少量使用，做最強對比元素和特定表面高光。
- **True Black**（`#000000`）：極少使用，特定程式碼／console 情境。

### 點綴
- **Cursor Orange**（`#f54e00`）：品牌點綴，`--color-accent`。鮮明的紅橘色，用於主要 CTA、active 連結、品牌時刻。暖而急切。
- **Gold**（`#c08532`）：次要點綴，暖金色用於高級或強調情境。

### 語意色
- **Error**（`#cf2d56`）：`--color-error`。暖緋紅，不是冷紅。
- **Success**（`#1f8a65`）：`--color-success`。低彩度的青綠，偏暖。

### Timeline / 特色色
- **Thinking**（`#dfa88f`）：AI timeline「思考中」狀態的暖桃色。
- **Grep**（`#9fc9a2`）：搜尋／grep 操作的柔鼠尾草綠。
- **Read**（`#9fbbe0`）：讀取檔案操作的柔藍。
- **Edit**（`#c0a8dd`）：編輯操作的柔薰衣草。

### 表面級距
- **Surface 100**（`#f7f7f4`）：最淺的按鈕/卡片表面，幾乎沒染色。
- **Surface 200**（`#f2f1ed`）：主要頁面背景。
- **Surface 300**（`#ebeae5`）：按鈕預設背景，細微強調。
- **Surface 400**（`#e6e5e0`）：卡片背景、次要表面。
- **Surface 500**（`#e1e0db`）：第三層按鈕背景，較深強調。

### 邊框色
- **Border Primary**（`oklab(0.263084 -0.00230259 0.0124794 / 0.1)`）：標準邊框，oklab 空間裡 10% 的暖棕色。
- **Border Medium**（`oklab(0.263084 -0.00230259 0.0124794 / 0.2)`）：強調邊框，20% 暖棕。
- **Border Strong**（`rgba(38, 37, 30, 0.55)`）：強邊框、表格分隔線。
- **Border Solid**（`#26251e`）：完全不透明深色邊框，最強對比。
- **Border Light**（`#f2f1ed`）：搭配頁面背景的淺邊框。

### 陰影與深度
- **Card Shadow**（`rgba(0,0,0,0.14) 0px 28px 70px, rgba(0,0,0,0.1) 0px 14px 32px, oklab(0.263084 -0.00230259 0.0124794 / 0.1) 0px 0px 0px 1px`）：重浮起卡片，配暖色 oklab 邊框環。
- **Ambient Shadow**（`rgba(0,0,0,0.02) 0px 0px 16px, rgba(0,0,0,0.008) 0px 0px 8px`）：浮動元素的細微環境光暈。

## 3. 字型系統

### 字型家族
- **Display / 標題**：`CursorGothic`，fallback：`CursorGothic Fallback, system-ui, Helvetica Neue, Helvetica, Arial`
- **內文 / 編輯式**：`jjannon`，fallback：`Iowan Old Style, Palatino Linotype, URW Palladio L, P052, ui-serif, Georgia, Cambria, Times New Roman, Times`
- **程式碼 / 技術**：`berkeleyMono`，fallback：`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New`
- **UI / 系統**：`system-ui`，fallback：`-apple-system, Segoe UI, Helvetica Neue, Arial`
- **Icons**：`CursorIcons16`（14px 和 12px 的 icon 字型）
- **OpenType 特性**：jjannon 內文用 `"cswh"`、CursorGothic 按鈕／caption 用 `"ss09"`

### 層級

| 角色 | 字型 | 大小 | 字重 | 行高 | 字距 | 說明 |
|------|------|------|------|------|------|------|
| Display Hero | CursorGothic | 72px (4.50rem) | 400 | 1.10（緊） | -2.16px | 最大壓縮，hero 宣言 |
| Section Heading | CursorGothic | 36px (2.25rem) | 400 | 1.20（緊） | -0.72px | 特色章節、CTA 標題 |
| Sub-heading | CursorGothic | 26px (1.63rem) | 400 | 1.25（緊） | -0.325px | 卡片標題、子章節 |
| Title Small | CursorGothic | 22px (1.38rem) | 400 | 1.30（緊） | -0.11px | 較小標題、列表標題 |
| Body Serif | jjannon | 19.2px (1.20rem) | 500 | 1.50 | normal | 編輯式內文，含 `"cswh"` |
| Body Serif SM | jjannon | 17.28px (1.08rem) | 400 | 1.35 | normal | 標準內文、描述 |
| Body Sans | CursorGothic | 16px (1.00rem) | 400 | 1.50 | normal/0.08px | UI 內文 |
| Button Label | CursorGothic | 14px (0.88rem) | 400 | 1.00（緊） | normal | 主按鈕文字 |
| Button Caption | CursorGothic | 14px (0.88rem) | 400 | 1.50 | 0.14px | 次按鈕，含 `"ss09"` |
| Caption | CursorGothic | 11px (0.69rem) | 400-500 | 1.50 | normal | 小 caption、metadata |
| System Heading | system-ui | 20px (1.25rem) | 700 | 1.55 | normal | 系統 UI 標題 |
| System Caption | system-ui | 13px (0.81rem) | 500-600 | 1.33 | normal | 系統 UI 標籤 |
| System Micro | system-ui | 11px (0.69rem) | 500 | 1.27（緊） | 0.048px | 大寫微標籤 |
| Mono Body | berkeleyMono | 12px (0.75rem) | 400 | 1.67（寬） | normal | 程式碼區塊 |
| Mono Small | berkeleyMono | 11px (0.69rem) | 400 | 1.33 | -0.275px | 行內程式碼、terminal |
| Lato Heading | Lato | 16px (1.00rem) | 600 | 1.33 | normal | Lato 章節標題 |
| Lato Caption | Lato | 14px (0.88rem) | 400-600 | 1.33 | normal | Lato caption |
| Lato Micro | Lato | 12px (0.75rem) | 400-600 | 1.27（緊） | 0.053px | Lato 小標籤 |

### 原則
- **gothic 壓縮做衝擊**：CursorGothic 在 Display 尺寸用 72px 時 -2.16px 字距，往下逐步放鬆：36px 時 -0.72px、26px 時 -0.325px、22px 時 -0.11px、16px 以下回到 normal。這個 tracking 做出精準工程感。
- **serif 給靈魂**：jjannon 提供文學溫度。`"cswh"` 特性加入 contextual swash alternates，給內文書法感的質地。
- **三種字型聲音**：Gothic（display/UI）、serif（編輯式/內文）、mono（程式碼/技術）。各自服務不同溝通目的。
- **字重克制**：CursorGothic 幾乎只用 400，靠尺寸和 tracking 拉階層，不靠字重。system-ui 元件用 500-700 做功能強調。

## 4. 元件樣式

### 按鈕

**Primary（暖色表面）**
- 背景：`#ebeae5`（Surface 300）
- 文字：`#26251e`（Cursor Dark）
- Padding：10px 12px 10px 14px
- 圓角：8px
- 輪廓：無
- Hover：文字切到 `var(--color-error)`（`#cf2d56`）
- Focus 陰影：`rgba(0,0,0,0.1) 0px 4px 12px`
- 用途：主要操作、主 CTA

**Secondary Pill**
- 背景：`#e6e5e0`（Surface 400）
- 文字：`oklab(0.263 / 0.6)`（60% 暖棕）
- Padding：3px 8px
- 圓角：完全膠囊（33.5M px）
- Hover：文字切到 `var(--color-error)`
- 用途：tag、篩選器、次要操作

**Tertiary Pill**
- 背景：`#e1e0db`（Surface 500）
- 文字：`oklab(0.263 / 0.6)`（60% 暖棕）
- 圓角：完全膠囊
- 用途：active 篩選狀態、已選 tag

**Ghost（透明）**
- 背景：`rgba(38, 37, 30, 0.06)`（6% 暖棕）
- 文字：`rgba(38, 37, 30, 0.55)`（55% 暖棕）
- Padding：6px 12px
- 用途：第三層操作、dismiss 按鈕

**Light Surface**
- 背景：`#f7f7f4`（Surface 100）或 `#f2f1ed`（Surface 200）
- 文字：`#26251e` 或 `oklab(0.263 / 0.9)`（90%）
- Padding：0px 8px 1px 12px
- 用途：dropdown trigger、細微互動元素

### 卡片與容器
- 背景：`#e6e5e0` 或 `#f2f1ed`
- Border：`1px solid oklab(0.263 / 0.1)`（10% 暖棕）
- 圓角：8px（標準）、4px（緊湊）、10px（強調）
- 陰影：浮起卡片用 `rgba(0,0,0,0.14) 0px 28px 70px, rgba(0,0,0,0.1) 0px 14px 32px`
- Hover：陰影加深

### 輸入與表單
- 背景：透明或表面色
- 文字：`#26251e`
- Padding：8px 8px 6px（textarea）
- Border：`1px solid oklab(0.263 / 0.1)`
- Focus：border 切到 `oklab(0.263 / 0.2)` 或點綴橘

### 導覽
- 暖奶油色背景上的乾淨水平導覽
- Cursor 文字標左對齊（約 96x24px）
- 連結：14px CursorGothic 或 system-ui，字重 500
- CTA 按鈕：暖色表面配 Cursor Dark 文字
- Tab 導覽：底部邊框 `1px solid oklab(0.263 / 0.1)`，active tab 有區別

### 圖片處理
- 程式編輯器截圖用 `1px solid oklab(0.263 / 0.1)` 邊框
- 圓角：標準 8px
- AI 對話/timeline 截圖主導特色章節
- hero 圖片背後用暖漸層或純奶油色背景

### 招牌元件

**AI Timeline**
- 垂直 timeline 顯示 AI 操作：thinking（桃）、grep（鼠尾草）、read（藍）、edit（薰衣草）
- 每一步用對應的語意色配對應文字
- 用垂直線串連
- Cursor「AI 優先寫程式」的核心視覺隱喻

**程式編輯器預覽**
- 深色編輯器截圖配暖奶油邊框
- 程式碼文字用 berkeleyMono
- 語法高亮用 timeline 配色

**定價卡片**
- 暖色表面背景，帶邊框容器
- 功能列表用 jjannon serif，可讀性更好
- CTA 按鈕用點綴橘或主深色樣式

## 5. 版面原則

### 間距系統
- 基本單位：8px
- 細級距：1.5px、2px、2.5px、3px、4px、5px、6px（sub-8px 用於微調）
- 標準級距：8px、10px、12px、14px（從擷取資料推得）
- 延伸級距（推測）：16px、24px、32px、48px、64px、96px
- 值得注意：細粒度 sub-8px 增量用於 icon／文字精準對齊

### 網格與容器
- 內容最大寬度：約 1200px
- Hero：置中單欄，上 padding 寬鬆（80-120px）
- 特色章節：2-3 欄卡片網格
- 全寬章節用暖奶油或略深背景
- 文件和設定頁用側邊欄版面

### 留白哲學
- **暖負空間**：奶油色背景讓留白帶有溫度和質地，不是冷白極簡。大片空白感覺溫馨而非臨床。
- **壓縮文字、開放版面**：CursorGothic 標題的激進負字距被周圍寬鬆邊距平衡。文字密；空間呼吸。
- **章節變化**：交替表面色（cream → 較淺 cream → cream）做細微章節區隔，沒有刺眼的邊界。

### 圓角級距
- 微（1.5px）：細節元素
- 小（2px）：行內元素、code span
- 中（3px）：小容器、行內徽章
- 標準（4px）：卡片、圖片、緊湊按鈕
- 舒適（8px）：主按鈕、卡片、選單
- 強調（10px）：較大容器、強調卡片
- 完全膠囊（33.5M px / 9999px）：膠囊按鈕、tag、徽章

## 6. 深度與層次

| 層級 | 處理 | 用途 |
|------|------|------|
| Flat (Level 0) | 無陰影 | 頁面背景、文字區塊 |
| Border Ring (Level 1) | `oklab(0.263 / 0.1) 0px 0px 0px 1px` | 標準卡片/容器邊框（暖 oklab） |
| Border Medium (Level 1b) | `oklab(0.263 / 0.2) 0px 0px 0px 1px` | 強調邊框、active 狀態 |
| Ambient (Level 2) | `rgba(0,0,0,0.02) 0px 0px 16px, rgba(0,0,0,0.008) 0px 0px 8px` | 浮動元素、細微光暈 |
| Elevated Card (Level 3) | `rgba(0,0,0,0.14) 0px 28px 70px, rgba(0,0,0,0.1) 0px 14px 32px, oklab 環` | modal、popover、浮起卡片 |
| Focus | `rgba(0,0,0,0.1) 0px 4px 12px` 按鈕 focus | 互動 focus 回饋 |

**陰影哲學**：Cursor 的深度系統有兩個核心想法。第一，邊框用知覺均勻的 oklab 色彩空間而非 rgba，確保暖棕邊框在不同背景上看起來一致。第二，浮起陰影用誇張的模糊值（28px、70px）配中等不透明度（0.14、0.1），做出擴散、氛圍式的浮起，不是硬邊 drop shadow。卡片不是「飄」在頁面上——而是頁面為它們輕輕讓出了空間。

### 裝飾性深度
- 暖奶油表面變化做出細微色調深度，不用陰影
- oklab 邊框在 10% 和 20% 之間做出一個邊定義光譜
- 沒有刺眼的分隔線——章節分區靠背景色調和間距

## 7. 互動與動效

### Hover 狀態
- 按鈕：文字色切到 `--color-error`（`#cf2d56`）——有辨識度的暖緋紅，發出可互動的訊號
- 連結：色彩切到點綴橘（`#f54e00`），或加上 `rgba(38, 37, 30, 0.4)` 的底線
- 卡片：hover 時陰影加深（ambient → elevated）

### Focus 狀態
- 陰影 focus：`rgba(0,0,0,0.1) 0px 4px 12px`，以深度做 focus 指示
- 邊框 focus：`oklab(0.263 / 0.2)`（20% 邊框）給輸入／表單 focus
- 所有 focus 狀態保持暖色基調——沒有冷藍 focus ring

### Transitions
- 顏色 transition：text/background 變色用 150ms ease
- 陰影 transition：層次變化用 200ms ease
- Transform：細微 scale 或 translate 做互動回饋

## 8. RWD 行為

### 斷點
| 名稱 | 寬度 | 主要變化 |
|------|------|----------|
| Mobile | <600px | 單欄、padding 縮、導覽堆疊 |
| Tablet Small | 600-768px | 2 欄網格開始 |
| Tablet | 768-900px | 卡片網格擴展、側邊欄出現 |
| Desktop Small | 900-1279px | 完整版面成形 |
| Desktop | >1279px | 完整版面、內容最大寬 |

### 觸控目標
- 按鈕 padding 舒適（垂直 6px-14px、水平 8px-14px）
- 膠囊按鈕維持觸控友善尺寸，padding 3px-10px
- 導覽連結 14px，間距足夠觸控

### 收合策略
- Hero：72px CursorGothic → 36px → 26px 隨螢幕縮小，字距按比例調整
- 導覽：水平連結 → mobile 漢堡選單
- 特色卡片：3 欄 → 2 欄 → 單欄堆疊
- 程式編輯器截圖：維持長寬比，可能縮小但保留邊框處理
- Timeline 視覺化：水平 → 垂直堆疊
- 章節間距：80px+ → 48px → mobile 32px

### 圖片行為
- 編輯器截圖各尺寸維持暖色邊框
- AI timeline 從水平轉成垂直版面
- 產品截圖用響應式圖片，圓角一致
- 全寬 hero 圖片等比縮放

## 9. Agent Prompt 指南

### 快速色票
- 主要 CTA 背景：`#ebeae5`（暖奶油按鈕）
- 頁面背景：`#f2f1ed`（暖 off-white）
- 文字色：`#26251e`（暖近黑）
- 次要文字：`rgba(38, 37, 30, 0.55)`（55% 暖棕）
- 點綴：`#f54e00`（橘）
- 錯誤/hover：`#cf2d56`（暖緋紅）
- Success：`#1f8a65`（低彩度青）
- 邊框：`oklab(0.263084 -0.00230259 0.0124794 / 0.1)` 或 `rgba(38, 37, 30, 0.1)` 作為 fallback

### 元件 prompt 範例
- 「在 `#f2f1ed` 暖奶油背景上建立 hero 章節。標題用 CursorGothic 72px 字重 400、行高 1.10、字距 -2.16px、色 `#26251e`。副標用 jjannon 17.28px 字重 400、行高 1.35、色 `rgba(38,37,30,0.55)`。主要 CTA 按鈕（`#ebeae5` 底、8px 圓角、10px 14px padding），hover 文字切到 `#cf2d56`。」
- 「設計卡片：`#e6e5e0` 背景、邊框 1px solid rgba(38,37,30,0.1)、圓角 8px。標題用 CursorGothic 22px 字重 400、字距 -0.11px。內文用 jjannon 17.28px 字重 400、色 rgba(38,37,30,0.55)。連結用 `#f54e00` 點綴。」
- 「做膠囊 tag：`#e6e5e0` 背景、rgba(38,37,30,0.6) 文字、完全膠囊圓角（9999px）、padding 3px 8px、CursorGothic 14px 字重 400。」
- 「做導覽：sticky `#f2f1ed` 背景配 backdrop-filter blur。連結用 14px system-ui 字重 500、`#26251e` 文字。CTA 按鈕右對齊，`#ebeae5` 底、8px 圓角。底部邊框 1px solid rgba(38,37,30,0.1)。」
- 「設計 AI timeline 四步：Thinking（`#dfa88f`）、Grep（`#9fc9a2`）、Read（`#9fbbe0`）、Edit（`#c0a8dd`）。每步：14px system-ui 標籤 + 16px CursorGothic 描述 + 垂直連接線 rgba(38,37,30,0.1)。」

### 迭代指南
1. 一律用暖色調——背景 `#f2f1ed`、文字 `#26251e`，主要表面絕不用純白／純黑
2. CursorGothic 的字距隨字級變化：72px 時 -2.16px、36px 時 -0.72px、26px 時 -0.325px、16px 時 normal
3. 用 `rgba(38, 37, 30, alpha)` 作為 oklab 邊框的 CSS-相容 fallback
4. 三字型三聲音：CursorGothic（display/UI）、jjannon（編輯式）、berkeleyMono（程式碼）
5. 膠囊形（9999px 圓角）給 tag 和篩選器；8px 圓角給主按鈕和卡片
6. Hover 狀態用 `#cf2d56` 文字色——暖緋紅切換是招牌互動
7. 陰影用大模糊值（28px、70px），做擴散氛圍深度
8. Sub-8px 間距級距（1.5、2、2.5、3、4、5、6px）對 icon／文字微對齊非常關鍵
