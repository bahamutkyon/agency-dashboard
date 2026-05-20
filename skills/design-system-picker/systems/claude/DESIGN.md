# 取自 Claude（Anthropic）的設計系統

> 分類：AI & LLM
> Anthropic 的 AI 助理。暖陶土橘色點綴，乾淨的編輯式版面。

## 1. 視覺主題與氛圍

Claude 的介面像是一間被重新詮釋成產品頁的文藝沙龍——溫暖、不疾不徐、帶點安靜的書卷氣。整個體驗鋪在一張羊皮紙色調的畫布上（`#f5f4ed`），刻意讓人聯想到優質紙張的觸感，而不是數位介面。當大多數 AI 產品頁都往冷調、未來感靠攏時，Claude 反其道而行，散發出人味般的溫度，像是這個 AI 自己就有不錯的居家品味。

最具代表性的招牌動作，是 Anthropic 自家的客製 serif 字體 Anthropic Serif——中等字重、字身寬裕的 serif，讓每一行標題都帶有書名般的厚度。搭配陶土橘（`#c96442`）、黑、霧綠色調的手繪感插畫，整套視覺語言講的是「一個有想法的夥伴」，而不是「一把厲害的工具」。serif 標題在 1.10–1.30 之間呼吸，緊但不擠，閱讀節奏更像散文而非掃過產品頁。

真正讓 Claude 與眾不同的是它的暖色中性色盤。每一個灰都帶黃褐底色（`#5e5d59`、`#87867f`、`#4d4c48`）——整個系統找不到一絲冷藍灰。邊框用奶油色（`#f0eee6`、`#e8e6dc`），陰影用暖色透明黑，連最深的表面（`#141413`、`#30302e`）也帶有一絲幾乎察覺不到的橄欖暖度。這種色彩一致性，讓空間感覺有人住過、值得信任。

**關鍵特徵：**
- 羊皮紙色畫布（`#f5f4ed`），喚起紙張而非螢幕的感受
- 客製 Anthropic 字型家族：標題用 Serif、UI 用 Sans、程式碼用 Mono
- 陶土橘品牌色（`#c96442`）——溫暖、土壤感、刻意不科技
- 全暖色中性色——每一個灰都帶黃褐底色
- 有機、編輯式插畫，取代典型科技風 icon
- ring-based 陰影系統（`0px 0px 0px 1px`），不用實線邊框就做出邊框感的深度
- 雜誌般的節奏：寬鬆的章節間距，serif 主導的層級

## 2. 配色系統與角色

### 主色
- **Anthropic Near Black**（`#141413`）：主要文字色，也是深色主題的表面色——不是純黑，而是帶橄欖暖度的深色，對眼睛較友善。是各大科技品牌中最暖的「黑」。
- **Terracotta Brand**（`#c96442`）：核心品牌色——燒製過的橘棕，用在主要 CTA 按鈕、品牌時刻、招牌點綴。刻意土壤感、刻意不科技。
- **Coral Accent**（`#d97757`）：品牌色的較淺、較暖變體，用在文字點綴、深色背景上的連結、次要強調。

### 次色與點綴
- **Error Crimson**（`#b53333`）：深而暖的紅，用於錯誤狀態——嚴肅但不刺眼。
- **Focus Blue**（`#3898ec`）：標準藍，用在輸入框 focus ring——整個系統唯一的冷色，純粹為了無障礙考量。

### 表面與背景
- **Parchment**（`#f5f4ed`）：主要頁面背景——帶黃綠底色的暖奶油色，像泛黃的紙。整個設計的情感地基。
- **Ivory**（`#faf9f5`）：最淺的表面——用在卡片和 Parchment 背景上的浮起容器。乍看幾乎沒差別，卻能堆出細微的層次。
- **Pure White**（`#ffffff`）：保留給特定按鈕表面和需要最高對比的元素。
- **Warm Sand**（`#e8e6dc`）：按鈕背景和顯眼的互動表面——明顯偏暖的淺灰。
- **Dark Surface**（`#30302e`）：深色主題容器、導覽邊框、深色浮起元素——暖炭灰。
- **Deep Dark**（`#141413`）：深色主題頁面背景與主要深色表面。

### 中性色與文字
- **Charcoal Warm**（`#4d4c48`）：淺暖色表面上的按鈕文字——明亮底色配深色文字的首選。
- **Olive Gray**（`#5e5d59`）：次要內文——明顯偏暖的中深灰。
- **Stone Gray**（`#87867f`）：第三層文字、註腳、減弱的 metadata。
- **Dark Warm**（`#3d3d3a`）：深色連結、強調的次要文字。
- **Warm Silver**（`#b0aea5`）：深色表面上的文字——暖羊皮紙底色的淺灰。

### 語意與點綴
- **Border Cream**（`#f0eee6`）：淺色主題的標準邊框——幾乎看不見的奶油色，做出最輕的包覆感。
- **Border Warm**（`#e8e6dc`）：強調用邊框、分隔線、淺色表面上的明顯包覆。
- **Border Dark**（`#30302e`）：深色表面的標準邊框——維持暖色基調。
- **Ring Warm**（`#d1cfc5`）：按鈕 hover/focus 狀態的陰影 ring 色。
- **Ring Subtle**（`#dedc01`）：較淺互動表面的次要 ring 變體。
- **Ring Deep**（`#c2c0b6`）：active/pressed 狀態的更深 ring。

### 漸層系統
- 傳統意義上，Claude 是**無漸層**設計。深度與視覺層次來自暖色表面之間的相互襯托、有機插畫、明暗章節的交替。暖色色盤本身就形成一種「漸層」效果，視線在 cream → sand → stone → charcoal → black 的章節間移動。

## 3. 字型系統

### 字型家族
- **標題**：`Anthropic Serif`，fallback：`Georgia`
- **內文 / UI**：`Anthropic Sans`，fallback：`Arial`
- **程式碼**：`Anthropic Mono`，fallback：`Arial`

*備註：這些都是客製字體。對外部實作來說，Georgia 可作為 serif 替代，system-ui/Inter 可作為 sans 替代。*

### 層級

| 角色 | 字型 | 大小 | 字重 | 行高 | 字距 | 說明 |
|------|------|------|------|------|------|------|
| Display / Hero | Anthropic Serif | 64px (4rem) | 500 | 1.10（緊） | normal | 最大衝擊力，書名般的存在感 |
| Section Heading | Anthropic Serif | 52px (3.25rem) | 500 | 1.20（緊） | normal | 章節錨點 |
| Sub-heading Large | Anthropic Serif | 36–36.8px (~2.3rem) | 500 | 1.30 | normal | 次要章節標記 |
| Sub-heading | Anthropic Serif | 32px (2rem) | 500 | 1.10（緊） | normal | 卡片標題、特色名稱 |
| Sub-heading Small | Anthropic Serif | 25–25.6px (~1.6rem) | 500 | 1.20 | normal | 較小的章節標題 |
| Feature Title | Anthropic Serif | 20.8px (1.3rem) | 500 | 1.20 | normal | 小型特色標題 |
| Body Serif | Anthropic Serif | 17px (1.06rem) | 400 | 1.60（寬） | normal | serif 內文（編輯式段落） |
| Body Large | Anthropic Sans | 20px (1.25rem) | 400 | 1.60（寬） | normal | 引言段落 |
| Body / Nav | Anthropic Sans | 17px (1.06rem) | 400–500 | 1.00–1.60 | normal | 導覽連結、UI 文字 |
| Body Standard | Anthropic Sans | 16px (1rem) | 400–500 | 1.25–1.60 | normal | 標準內文、按鈕文字 |
| Body Small | Anthropic Sans | 15px (0.94rem) | 400–500 | 1.00–1.60 | normal | 緊湊內文 |
| Caption | Anthropic Sans | 14px (0.88rem) | 400 | 1.43 | normal | metadata、描述 |
| Label | Anthropic Sans | 12px (0.75rem) | 400–500 | 1.25–1.60 | 0.12px | 徽章、小型標籤 |
| Overline | Anthropic Sans | 10px (0.63rem) | 400 | 1.60 | 0.5px | 全大寫上標籤 |
| Micro | Anthropic Sans | 9.6px (0.6rem) | 400 | 1.60 | 0.096px | 最小文字 |
| Code | Anthropic Mono | 15px (0.94rem) | 400 | 1.60 | -0.32px | 行內程式碼、終端機 |

### 原則
- **serif 撐場面，sans 做事**：Anthropic Serif 承擔所有標題內容，統一中等字重（500），讓每個標題都有出版品般的份量。Anthropic Sans 處理所有功能性 UI 文字——按鈕、標籤、導覽——安靜而有效率。
- **serif 只用單一字重**：所有 Anthropic Serif 標題都用字重 500——不加粗、不變細。這讓所有標題大小都保持一致的「嗓音」，像同一位作者寫出每一行標題。
- **內文寬鬆行高**：多數內文用 1.60 行高——比典型科技網站（1.4–1.5）寬鬆不少，閱讀體驗更接近書本而不是儀表板。
- **標題緊但不壓迫**：標題行高 1.10–1.30 雖緊，卻不會讓人喘不過氣。serif 字形需要 sans 不需要的呼吸空間。
- **小型標籤的微字距**：小尺寸 sans 文字（12px 以下）刻意加上字距（0.12px–0.5px），在小尺寸下維持辨識度。

## 4. 元件樣式

### 按鈕

**Warm Sand（次要）**
- 背景：Warm Sand（`#e8e6dc`）
- 文字：Charcoal Warm（`#4d4c48`）
- Padding：0px 12px 0px 8px（不對稱——icon 優先的版面）
- 圓角：舒適（8px）
- 陰影：ring-based（`#e8e6dc 0px 0px 0px 0px, #d1cfc5 0px 0px 0px 1px`）
- 主力按鈕——溫暖、低調、清楚是可點擊的

**White Surface**
- 背景：Pure White（`#ffffff`）
- 文字：Anthropic Near Black（`#141413`）
- Padding：8px 16px 8px 12px
- 圓角：大方圓（12px）
- Hover：背景切到次要色
- 乾淨、浮起的按鈕，適用於淺色表面

**Dark Charcoal**
- 背景：Dark Surface（`#30302e`）
- 文字：Ivory（`#faf9f5`）
- Padding：0px 12px 0px 8px
- 圓角：舒適（8px）
- 陰影：ring-based（`#30302e 0px 0px 0px 0px, ring 0px 0px 0px 1px`）
- 反轉版本，做深色貼淺底的強調

**Brand Terracotta**
- 背景：Terracotta Brand（`#c96442`）
- 文字：Ivory（`#faf9f5`）
- 圓角：8–12px
- 陰影：ring-based（`#c96442 0px 0px 0px 0px, #c96442 0px 0px 0px 1px`）
- 主要 CTA——整個系統唯一帶彩色的按鈕

**Dark Primary**
- 背景：Anthropic Near Black（`#141413`）
- 文字：Warm Silver（`#b0aea5`）
- Padding：9.6px 16.8px
- 圓角：大方圓（12px）
- Border：細實線 Dark Surface（`1px solid #30302e`）
- 用於深色主題表面

### 卡片與容器
- 背景：淺色表面用 Ivory（`#faf9f5`）或 Pure White（`#ffffff`）；深色表面用 Dark Surface（`#30302e`）
- Border：淺色用細實線 Border Cream（`1px solid #f0eee6`）；深色用 `1px solid #30302e`
- 圓角：標準卡片舒適圓（8px）；強調卡片大方圓（16px）；hero 容器與嵌入媒體極圓（32px）
- 陰影：浮起內容用低語式（`rgba(0,0,0,0.05) 0px 4px 24px`）
- Ring 陰影：互動卡片狀態用 `0px 0px 0px 1px` 模式
- 章節邊框：列表項目分隔用 `1px 0px 0px`（只在頂部）

### 輸入與表單
- 文字：Anthropic Near Black（`#141413`）
- Padding：1.6px 12px（垂直非常緊湊）
- Border：標準暖色邊框
- Focus：ring 帶 Focus Blue（`#3898ec`）邊色——整個系統唯一的冷色時刻
- 圓角：大方圓（12px）

### 導覽
- 固定頂部導覽，暖色背景
- Logo：Anthropic Near Black 的 Claude 文字標
- 連結：Near Black（`#141413`）、Olive Gray（`#5e5d59`）、Dark Warm（`#3d3d3a`）混用
- 導覽邊框：`1px solid #30302e`（深色）或 `1px solid #f0eee6`（淺色）
- CTA：Terracotta Brand 按鈕或 White Surface 按鈕
- Hover：文字切到前景主色，無底線

### 圖片處理
- 顯示 Claude 對話介面的產品截圖
- 媒體採用寬鬆 border-radius（16–32px）
- 嵌入式影片播放器帶圓角
- 深色 UI 截圖在暖色淺底上形成對比
- 概念性章節用有機、手繪感插畫

### 招牌元件

**模型比較卡片**
- Opus 4.5、Sonnet 4.5、Haiku 4.5 排在乾淨的卡片網格裡
- 每個模型一張帶邊框的卡片，含名稱、描述、能力徽章
- 項目之間用 Border Warm（`#e8e6dc`）分隔

**有機插畫**
- 陶土橘、黑、霧綠的手繪感向量插畫
- 抽象、概念性，不是字面意義的產品示意圖
- 主要視覺人格——沒有其他 AI 公司用這種風格

**明／暗章節交替**
- 頁面在 Parchment 淺色與 Near Black 深色章節之間交替
- 形成像書本翻章的閱讀節奏
- 每個章節感覺都像一個獨立的空間

## 5. 版面原則

### 間距系統
- 基本單位：8px
- 級距：3px、4px、6px、8px、10px、12px、16px、20px、24px、30px
- 按鈕 padding：不對稱（0px 12px 0px 8px）或對稱（8px 16px）
- 卡片內距：約 24–32px
- 章節垂直間距：寬鬆（主要章節之間估計 80–120px）

### 網格與容器
- 容器最大寬度：約 1200px，置中
- Hero：置中，編輯式版面
- 特色章節：單欄或 2–3 欄卡片網格
- 模型比較：乾淨的 3 欄網格
- 為強調而打破容器寬度的全寬深色章節

### 留白哲學
- **編輯式節奏**：每個章節像雜誌跨頁那樣呼吸——寬鬆的上下邊距製造自然的閱讀停頓。
- **serif 驅動的韻律**：serif 標題建立的是文學節奏，需要比 sans-serif 設計更多留白。
- **內容島嶼法**：章節在明暗環境間交替，為每則訊息建立獨立的「房間」。

### 圓角級距
- 銳利（4px）：最小型行內元素
- 微圓（6–7.5px）：小按鈕、次要互動元素
- 舒適圓（8–8.5px）：標準按鈕、卡片、容器
- 大方圓（12px）：主要按鈕、輸入框、導覽元素
- 很圓（16px）：強調容器、影片播放器、tab 列
- 高度圓（24px）：標籤類元素、強調容器
- 最大圓（32px）：hero 容器、嵌入媒體、大卡片

## 6. 深度與層次

| 層級 | 處理 | 用途 |
|------|------|------|
| Flat (Level 0) | 無陰影、無 border | Parchment 背景、行內文字 |
| Contained (Level 1) | `1px solid #f0eee6`（淺）或 `1px solid #30302e`（深） | 標準卡片、章節 |
| Ring (Level 2) | `0px 0px 0px 1px` ring 陰影，使用暖色灰 | 互動卡片、按鈕、hover 狀態 |
| Whisper (Level 3) | `rgba(0,0,0,0.05) 0px 4px 24px` | 浮起特色卡片、產品截圖 |
| Inset (Level 4) | `inset 0px 0px 0px 1px` at 15% opacity | active/pressed 按鈕狀態 |

**陰影哲學**：Claude 用**暖色 ring 陰影**而非傳統 drop shadow 來傳達深度。招牌的 `0px 0px 0px 1px` 模式做出像 border 的光暈，但比實際 border 更柔——是裝成 border 的陰影，或是技術上算陰影的 border。即使出現 drop shadow，也都極其輕柔（0.05 不透明度、24px 模糊）——幾乎看不見的浮起，暗示飄浮而非投射。

### 裝飾性深度
- **明／暗交替**：最強烈的深度效果來自 Parchment（`#f5f4ed`）與 Near Black（`#141413`）章節的交替——整個章節透過改變環境光位準來切換層次。
- **暖色 ring 光暈**：按鈕和卡片的互動狀態使用符合暖色色盤的 ring 陰影——絕不冷調或通用灰。

## 7. Do's 與 Don'ts

### Do
- 主要淺色背景一律用 Parchment（`#f5f4ed`）——這個暖奶油色調就是 Claude 的人格
- 所有標題都用 Anthropic Serif 字重 500——單一字重的一致性是刻意的
- Terracotta Brand（`#c96442`）只用在主要 CTA 和最高訊號強度的品牌時刻
- 所有中性色都要暖——每個灰都要有黃褐底色
- 互動元素狀態用 ring 陰影（`0px 0px 0px 1px`），不要用 drop shadow
- 守住 editorial 的 serif/sans 階層——標題用 serif，UI 用 sans
- 內文行高放寬到 1.60，做出文學閱讀感
- 淺色／深色章節交替，建立章節般的頁面節奏
- 按鈕、卡片用寬鬆 border-radius（12–32px），讓感覺柔軟、好親近

### Don't
- 不要用冷藍灰——色盤全是暖色
- Anthropic Serif 不要用粗體（700+）——serif 字重最高就是 500
- 不要在 Terracotta 之外加入飽和色——色盤刻意低彩度
- 按鈕、卡片不要用銳利圓角（< 6px）——柔軟是品牌核心
- 不要用重 drop shadow——深度來自 ring 陰影和背景色切換
- 頁面背景不要用純白（`#ffffff`）——Parchment（`#f5f4ed`）或 Ivory（`#faf9f5`）都更暖
- 不要用幾何／科技風插畫——Claude 的插畫是有機、手繪感
- 內文行高不要低於 1.40——寬鬆間距支撐 editorial 的人格
- 不要用 monospace 排非程式碼內容——Anthropic Mono 只給程式碼用
- 標題不要混進 sans-serif——serif/sans 的分工就是字型識別

## 8. RWD 行為

### 斷點
| 名稱 | 寬度 | 主要變化 |
|------|------|----------|
| Small Mobile | <479px | 最小版面，全部堆疊，緊湊字級 |
| Mobile | 479–640px | 單欄、漢堡選單、縮小標題尺寸 |
| Large Mobile | 640–767px | 內容區略寬 |
| Tablet | 768–991px | 2 欄網格出現、導覽收斂 |
| Desktop | 992px+ | 完整多欄、展開導覽、hero 字級拉到最大（64px） |

### 觸控目標
- 按鈕用寬鬆 padding（垂直至少 8–16px）
- 導覽連結間距足夠拇指操作
- 卡片整體當作大型觸控目標
- 建議最小觸控區：44x44px

### 收合策略
- **導覽**：完整水平導覽在 mobile 收成漢堡選單
- **特色章節**：多欄 → 堆疊單欄
- **Hero 文字**：64px → 36px → ~25px 漸進縮放
- **模型卡片**：3 欄 → 垂直堆疊
- **章節 padding**：按比例縮小，但維持 editorial 節奏
- **插畫**：等比縮放，維持長寬比

### 圖片行為
- 產品截圖在圓角容器內等比縮放
- 插畫各尺寸維持品質
- 影片內嵌維持 16:9 並保留圓角
- 不同斷點不做藝術指導切換

## 9. Agent Prompt 指南

### 快速色票
- Brand CTA：「Terracotta Brand (#c96442)」
- 頁面背景：「Parchment (#f5f4ed)」
- 卡片表面：「Ivory (#faf9f5)」
- 主要文字：「Anthropic Near Black (#141413)」
- 次要文字：「Olive Gray (#5e5d59)」
- 第三層文字：「Stone Gray (#87867f)」
- 邊框（淺）：「Border Cream (#f0eee6)」
- 深色表面：「Dark Surface (#30302e)」

### 元件 prompt 範例
- 「在 Parchment (#f5f4ed) 上建立 hero 章節，標題用 64px Anthropic Serif 字重 500，行高 1.10，文字用 Anthropic Near Black (#141413)。副標用 Olive Gray (#5e5d59)，20px Anthropic Sans，行高 1.60。放一顆 Terracotta Brand (#c96442) CTA 按鈕，文字 Ivory，圓角 12px。」
- 「在 Ivory (#faf9f5) 上設計特色卡片，邊框 1px solid Border Cream (#f0eee6)，舒適圓角（8px）。標題用 Anthropic Serif 25px 字重 500，描述用 Olive Gray (#5e5d59) 16px Anthropic Sans。加 whisper 陰影 (rgba(0,0,0,0.05) 0px 4px 24px)。」
- 「在 Anthropic Near Black (#141413) 上建立深色章節，標題用 Ivory (#faf9f5) Anthropic Serif 52px 字重 500，內文用 Warm Silver (#b0aea5)。邊框用 Dark Surface (#30302e)。」
- 「做一顆按鈕：Warm Sand (#e8e6dc) 背景、Charcoal Warm (#4d4c48) 文字、圓角 8px、ring 陰影 (0px 0px 0px 1px #d1cfc5)，Padding 0px 12px 0px 8px。」
- 「設計三張卡片的模型比較網格，放在 Ivory 表面上。每張卡片頂部加 Border Warm (#e8e6dc) 邊框，模型名稱用 Anthropic Serif 25px，描述用 Olive Gray 15px Anthropic Sans。」

### 迭代指南
1. 一次處理一個元件
2. 指名色票——「用 Olive Gray (#5e5d59)」而不是「弄成灰的」
3. 一律指定暖色變體——別出現冷灰
4. serif vs sans 的角色要講清楚——「標題用 Anthropic Serif，標籤用 Anthropic Sans」
5. 陰影講 "ring shadow (0px 0px 0px 1px)" 或 "whisper shadow"——別用通用 "drop shadow"
6. 指定暖色背景——「在 Parchment (#f5f4ed) 上」或「在 Near Black (#141413) 上」
7. 插畫要有機、概念性——形容詞用「手繪感」
