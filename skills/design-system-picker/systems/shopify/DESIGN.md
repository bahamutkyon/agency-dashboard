# 受 Shopify 啟發的設計系統

> 類別：E-Commerce & Retail
> 電商平台。深色為主的電影感，霓虹綠強調，超細字型。

## 1. 視覺主題與氛圍

Shopify.com 是一座暗夜為主的數位劇場 — 一個把自家電商平台像院線首映一樣搬上舞台的網站。整段體驗在一片近黑的表面上展開，這些黑帶著一絲若有似無的深森林綠（`#02090A`、`#061A1C`、`#102620`），營造出一種夜行氛圍，讓人覺得不像 SaaS 行銷頁，反而像是科技發表會上的精品產品揭幕。這層暗不是冰冷或公司化的暗，而是奢華體驗那種溫暖、包覆感的暗，就像坐在一座被燈光調暗的觀眾席最前排。

字型是無可爭議的主角。NeueHaasGrotesk — 一個 Helvetica 的精緻後裔 — 以驚人的字重（330–400）出現在 96px 的巨大尺寸上，標題就像用光線蝕刻而非用墨水印出。`ss03` OpenType 功能讓字形多了一份獨特的個性，將 Shopify 的字型與一般 Helvetica 用法區別開來。Display 層之下，Inter Variable 以手術刀般的精度處理內文，採用同樣不尋常的可變字重（420、450、550），這些字重活在傳統字重檔位之間。如此精準，正暗示著一家對細節錙銖必較的公司。

色彩使用極為克制。主要強調色是 Shopify 霓虹綠（`#36F4A4`） — 一抹電光薄荷綠，只出現在 focus 環與重點高亮上，像是在暗色畫布上閃爍的生物發光訊號。較柔和的綠色染色（Aloe `#C1FBD4`、Pistachio `#D4F9E0`）提供環境氛圍。深色表面上唯一能擔當主角的文字色是白色；以鋅色為基底的中性階（`#A1A1AA` 到 `#3F3F46`）處理那些較安靜的資訊層級。最終結果，是一套讓電商科技讀起來像來自科幻未來的設計。

**主要特徵：**
- 暗夜為主的設計，帶有深森林青綠的底調（不是純黑）
- 超細的 display 字型（字重 330）以巨大尺寸（96px）呈現，營造空靈的存在感
- 霓虹綠（`#36F4A4`）是黑暗中唯一的高能量強調色
- 完整藥丸形按鈕（9999px 圓角）是主要的互動造型
- 多層、多階段的 box shadow 創造攝影般的深度
- 產品截圖嵌進深色 UI 情境，與周遭暗色融為一體
- 鋅色基底的中性階用於文字階層 — 在暖色與冷色之間取得平衡

## 2. 配色系統與角色

### Primary

- **Shopify White**（`#FFFFFF`）：深色表面上的主要文字、按鈕填色、高對比元素
- **Shopify Black**（`#000000`）：body 背景、白色按鈕上的文字、最大對比的基底（--color-shade-100）

### 次要與強調

- **Neon Green**（`#36F4A4`）：標誌性的強調色 — focus 環、互動高亮、active 狀態指示。電光感的生物發光
- **Aloe**（`#C1FBD4`）：柔綠染色，用於裝飾性背景、氛圍卡片（--color-aloe-10）
- **Pistachio**（`#D4F9E0`）：最淺的綠色染色，用於細微的表面差異化（--color-pistachio-10）

### 表面與背景

- **Void**（`#000000`）：根頁面背景 — 純黑以達最大深度
- **Deep Teal**（`#02090A`）：卡片表面、內容容器 — 帶綠底調的近黑
- **Dark Forest**（`#061A1C`）：帶有明顯綠色個性的區塊背景
- **Forest**（`#102620`）：浮起的深色表面、header 背景 — 最溫暖的暗色
- **Dark Card Border**（`#1E2C31`）：深色表面上的卡片邊框，細微的邊界界定

### 中性與文字（鋅色階）

- **Shade-30**（`#D4D4D8`）：最淺的中性色，深色背景上幾乎看不見的邊框（--color-shade-30）
- **Muted Text**（`#A1A1AA`）：次要文字、metadata、描述 — 那個低聲的嗓音
- **Shade-50**（`#71717A`）：三級文字、時間戳、最不重要的資訊（--color-shade-50)
- **Shade-60**（`#52525B`）：停用文字、裝飾性中性色（--color-shade-60）
- **Shade-70**（`#3F3F46`）：細微分隔線、幾乎看不見的 UI 邊界（--color-shade-70）
- **Light Border**（`#E4E4E7`）：淺色表面的邊框（極少出現 — 只在淺色模式的對話框）

### 語意與強調

- **Link Muted**（`#9797A2`）：低調的連結文字，帶底線
- **Link Sage**（`#9DABAD`）：青綠染色的低調連結
- **Link Lavender**（`#BDBDCA`）：較淺的連結變體
- **Link Mint**（`#99B3AD`）：綠色染色的連結變體，用於主題區塊

### 漸層系統

- **Dark Teal Wash**：放射狀漸層，中心 `#102620` 漸至邊緣 `#02090A` — 用於產品展示後方
- **Green Atmospheric**：低調的綠色染色環境漸層，用於 hero 區塊後方，創造深度而不顯色塊
- **Spotlight**：聚焦的亮區漸至黑色 — 創造主題演講式的舞台燈光

## 3. 字型系統

### 字型家族

**Display：** NeueHaasGrotesk（Helvetica 的精緻後裔，可變字型）
- Fallback：Helvetica、Arial、sans-serif
- OpenType 功能：`ss03`（stylistic set 3 — 獨特的字形替代）
- 可用字重：330、360、400、500、750（可變）
- 用於所有標題、hero 文字與大型 display 元素

**Body：** Inter-Variable
- Fallback：Helvetica、Arial、sans-serif
- OpenType 功能：`ss03`
- 可用字重：400、420、450、500、550（可變）
- 用於內文、連結、按鈕、UI 元素

**Mono：** ui-monospace
- Fallback：SFMono-Regular、Menlo、Monaco、Consolas、Liberation Mono、Courier New
- 用於程式碼片段、資料標籤、技術內容

### 層級

| 角色 | 大小 | 字重 | 行高 | 字距 | 備註 |
|------|------|--------|-------------|----------------|-------|
| Display XL | 96px | 400 | 1.00 | — | NeueHaasGrotesk，hero 標題，「ss03」 |
| Display XL Bold | 90.74px | 750 | 1.00 | 4.54px | NeueHaasGrotesk，強調 display |
| Display XL Tracked | 96px | 400 | 1.00 | 2.4px | NeueHaasGrotesk，寬字距 display |
| Display Light | 96px | 330 | 0.96 | — | NeueHaasGrotesk，空靈 display |
| Heading 1 | 70px | 330 | 1.00 | — | NeueHaasGrotesk，區塊標題 |
| Heading 2 | 55px | 330 | 1.16 | — | NeueHaasGrotesk，次級區塊 |
| Heading 3 | 48px | 330 | 1.14 | — | NeueHaasGrotesk，特色標題 |
| Heading 4 | 32px | 360 | 1.14 | 0.32px | NeueHaasGrotesk，卡片標題 |
| Heading 5 | 28px | 500 | 1.28 | 0.42px | NeueHaasGrotesk，小型標題 |
| Heading 6 | 24px | 400 | 1.14 | 0.36px | NeueHaasGrotesk，次要標題 |
| Body Large | 20px | 500 | 1.40 | 0.3px | NeueHaasGrotesk / Inter，導引段落 |
| Body | 18px | 400 | 1.56 | — | Inter-Variable，標準內文 |
| Body Medium | 18px | 550 | 1.56 | — | Inter-Variable，強調內文 |
| Body Small | 16px | 400 | 1.50 | — | Inter / NeueHaasGrotesk，緊湊內文 |
| Body Small Medium | 16px | 420 | 1.50 | — | Inter-Variable，輕度強調 |
| Button | 16px | 400 | 1.50 | — | NeueHaasGrotesk，CTA 文字 |
| Nav Link | 18px | 500 | 1.25 | 0.72px | NeueHaasGrotesk，導覽項目 |
| Caption | 14px | 500 | 1.49 | 0.28px | NeueHaasGrotesk / Inter，metadata |
| Caption Medium | 14px | 550 | 1.49 | 0.28px | Inter-Variable，強調 caption |
| Overline | 15.36px | 400 | 1.50 | 1.54px | NeueHaasGrotesk，寬字距標籤 |
| Micro | 13px | 500 | 1.50 | -0.13px | Inter，緊字距小字 |
| Label | 12px | 400 | 1.20 | 0.72px | Inter，全大寫標籤 |
| Code | 16px | 400 | 1.50 | — | ui-monospace，全大寫，程式碼區塊 |
| Code Small | 12px | 400 | 1.33 | — | ui-monospace，全大寫，inline code |

### 原則

Shopify 的字型是可變字型精準度的教科書範例。Display 層幾乎完全活在字重 330–400 — 那是輕到彷彿能漂浮在深色背景上的羽量級文字，看起來像投射出的光線。這與多數 SaaS 網站採用的粗重路線完全相反：當別人都在喊，Shopify 卻以大尺寸低聲耳語。96px 標題搭配字重 330 創造了一種龐然體積與纖細筆畫並存的悖論，既宏偉又脆弱。`ss03` OpenType 功能啟動了一套樣式集，賦予特定字元（很可能是 `a`、`g` 與某些數字）更精緻的造型，讓 Shopify 的字型與標準 Helvetica Neue 用法區別開來。Inter Variable 以手術刀般的精度處理 body 層，用 420 與 550 這類介於傳統檔位之間的字重 — 每段文字都剛好擁有它需要的視覺重量。

## 4. 元件與模式

### 按鈕

**Primary（白色填色）**
- 背景：White（`#FFFFFF`）
- 文字：Black（`#000000`）
- 邊框：2px solid 透明
- 圓角：完整藥丸（9999px）
- Padding：12px 26px 12px 16px（不對稱 — 右側 padding 較多以求視覺平衡）
- Hover：微微降低不透明度或背景變化
- Focus：2px `#36F4A4`（霓虹綠）外環
- Transition：all 200ms ease

**Secondary（Ghost／Outlined）**
- 背景：透明
- 文字：White（`#FFFFFF`）
- 邊框：2px solid White（`#FFFFFF`）
- 圓角：完整藥丸（9999px）
- Padding：12px 26px 12px 16px
- Hover：填為白底配黑色文字
- Focus：2px `#36F4A4` 外環

**Badge／Tag（中性填色）**
- 背景：`rgba(255, 255, 255, 0.2)`（霧面玻璃感）
- 文字：White（`#FFFFFF`）
- 邊框：無
- 圓角：細微圓角（4px）
- Padding：12px 16px
- 字型：16px regular

### 卡片與容器

- 背景：深色頁面使用 Deep Teal（`#02090A`）
- 邊框：1px solid `#1E2C31`（Dark Card Border） — 幾乎看不見的邊界
- 圓角：標準卡片 8px、特色卡片 12px、上緣圓角卡片 20px 20px 0 0
- 陰影：多層系統：
  - 靜止：`rgba(0,0,0,0.1) 0px 0px 0px 1px, rgba(0,0,0,0.1) 0px 2px 2px, rgba(0,0,0,0.1) 0px 4px 4px, rgba(0,0,0,0.1) 0px 8px 8px` 加上 `rgba(255,255,255,0.03) 0px 1px 0px inset`
  - 內陰影的白色高光在頂緣製造一抹微光
- Hover：陰影擴張，卡片可能稍微提亮
- Transition：box-shadow 300ms ease、transform 200ms ease

### 輸入框與表單

- 背景：透明或 Dark Forest（`#061A1C`）
- 文字：White（`#FFFFFF`）
- 邊框：1px solid `#3F3F46`（Shade-70）
- 圓角：8px
- Padding：12px 16px
- Focus：2px solid `#36F4A4`（霓虹綠 focus 環）
- Placeholder：Shade-50（`#71717A`）
- Transition：border-color 200ms ease

### 導覽

- 背景：透明（覆於暗色 hero 上方），捲動後變為 Forest（`#102620`）
- 高度：約 64px
- 左側：Shopify 字標 logo（SVG，暗底白字）
- 中央／右側：18px/500 NeueHaasGrotesk 導覽連結，白色，字距 0.72px
- CTA：白色藥丸按鈕「Start for free」（右側）
- 次要 CTA：白色邊框的 ghost 按鈕
- Hover：連結轉為 Muted Text（`#A1A1AA`）或出現底線
- 行動裝置：漢堡選單、全螢幕暗色遮罩
- Transition：捲動時 background 300ms ease

### 圖像處理

- 產品截圖：嵌入深色 UI 情境，與周遭暗色融合
- 後台介面預覽：呈現於深色背景，搭配細微卡片邊框
- 比例：多樣 — hero 圖像偏寬（接近 16:9），特色圖則彈性處理
- 所有圖像齊邊嵌入深色容器 — 無亮色邊框或外框
- 懶載入搭配深色佔位表面

### 信任指標

- 重要統計醒目陳列：「15+」（年）、「150M+」（買家）
- 數字以 NeueHaasGrotesk 的 display 尺寸呈現
- 合作夥伴／開發者生態系統強調區塊
- 深色主題客戶見證融入頁面流程

## 5. 間距與佈局

### 間距系統

基準單位：8px

| Token | 值 | 用途 |
|-------|-------|-----|
| space-1 | 4px | 緊湊的 inline 間距 |
| space-2 | 8px | 基準單位、icon 間距 |
| space-3 | 12px | 卡片 padding、緊湊邊距 |
| space-4 | 16px | 標準元素 padding |
| space-5 | 24px | 卡片間距、區塊 padding |
| space-6 | 28px | 中型區塊間距 |
| space-7 | 32px | 區塊分隔 |
| space-8 | 36px | 大型 padding |
| space-9 | 40px | 主要區塊 padding |
| space-10 | 64px | Hero 區塊 padding、大型間距 |

### Grid 與容器

- 最大容器寬度：約 1280px（置中）
- Hero：滿版、邊到邊的深色背景配中央文字
- 特色區塊：2 欄佈局，文字搭配產品截圖
- 統計區塊：水平佈局搭配大型數字
- 水平 padding：桌面 64px、平板 32px、行動裝置 16px
- Grid gap：主要內容區塊間 24–32px

### 留白哲學

Shopify 的留白策略是戲劇化的。區塊之間用 80px 到 120px 的純黑空間隔開，營造出簡報般的節奏，而不是網頁的節奏。每個內容區塊都是 keynote 式捲動中的一張「投影片」。區塊內間距較緊密、較有目的，在巨大空寂之中創造焦點密度。宏觀層面的留白與微觀層面的精準對比，正是這個網站電影感節奏的來源。

### 圓角刻度

| 值 | 情境 |
|-------|---------|
| 4px | Tag、徽章、微型元素 |
| 8px | 標準卡片、輸入框、影片容器 |
| 12px | 特色卡片、圖像容器、按鈕（非藥丸） |
| 20px | 上緣圓角卡片（20px 20px 0 0）、對話框 header |
| 340px | 大型圓角裝飾元素 |
| 9999px | 藥丸按鈕、藥丸徽章、導覽元素 |

## 6. 深度與層次

| 層級 | 處理方式 | 用途 |
|-------|-----------|-----|
| Base | 無陰影，深色表面 | 預設頁面背景 |
| Subtle | `rgba(0,0,0,0.1) 0px 0px 0px 1px` 加內陰影白色光 | 靜止卡片 |
| Medium | 多層：1px ring 加 2px 加 4px 加 8px 的陰影堆疊 | 浮起卡片、特色區塊 |
| High | `rgba(0,0,0,0.25) 0px 25px 50px -12px` | 對話框、下拉選單、遮罩層 |
| Focus | `0px 0px 0px 2px #36F4A4` | 鍵盤 focus 環（霓虹綠） |

Shopify 的陰影系統異常細膩。卡片不是用單一陰影，而是堆疊的多層手法：1px ring 用於邊界界定、2px/4px/8px 的漸進模糊模擬自然的光線衰減、再加一抹細緻的內陰影白光（`rgba(255,255,255,0.03)`）模擬從上方打光的玻璃表面。在深色背景上，陰影是從本已很暗的表面再變暗，因此陰影更像「環境光遮蔽」而非傳統的抬升 — 卡片看起來像稍微「陷入」表面，而非懸浮其上。

### 裝飾性深度

- **深青綠漸層**：hero 區塊與產品展示後方的放射狀環境染色
- **聚光效果**：中央亮區漸至黑色，創造 keynote 式的舞台燈光
- **邊緣光暈**：透過內陰影 box-shadow 在深色卡片上製造微微的淺色邊緣
- **綠色氛圍光環**：背景漸層中淡淡的綠色染色，呼應品牌強調色

## 7. Do's and Don'ts

### Do

- 用深青綠—黑的表面階層（Void → Deep Teal → Dark Forest → Forest）營造深度
- Display 字型維持字重 330–400 — 空靈的輕盈是設計的招牌
- 霓虹綠（`#36F4A4`）只用於 focus 狀態與關鍵強調 — 一律稀缺
- 主要 CTA 按鈕一律 9999px 圓角 — 完整藥丸不容妥協
- 卡片抬升用多層陰影系統 — 單層陰影看起來會很扁平
- 所有文字維持 `ss03` OpenType 功能 — 這是字型識別的一部分
- 內文使用 Inter Variable、標題使用 NeueHaasGrotesk — 不要互換角色
- 區塊間採用戲劇化間距（80px+）以營造電影般的節奏

### Don't

- 不要在深色背景上的文字使用純黑（#000000） — 只用白（#FFFFFF）
- 不要引入暖色（橘、紅、黃） — 配色嚴守冷色（綠、青、中性）
- 不要把 NeueHaasGrotesk 內文字重設超過 500 — 過重會破壞空靈感
- 不要把綠色強調用在大面積上 — 霓虹綠只用作小而精準的高光
- 互動元素不要使用銳利直角（0px 圓角） — 一切都要圓潤
- 不要加入亮色背景 — 深色主題是根本，不是選項
- 不要使用單層 box shadow — 堆疊手法才是這個系統
- 內文行高不要超過 1.56 — Shopify 的文字相對緊湊
- 同一尺寸／角色不要混用 NeueHaasGrotesk 與 Inter — 它們的字重刻度不同
- 標題不要使用負字距 — Shopify 標題使用中性或正字距

## 8. 響應式行為

### 斷點

| 名稱 | 寬度 | 主要變化 |
|------|-------|-------------|
| Mobile | <640px | 單欄、漢堡選單，display 文字縮為 48px，padding 16px |
| Tablet | 640–1024px | 開始出現 2 欄 grid，display 文字 70px，padding 32px |
| Desktop | 1024–1440px | 完整佈局、展開的導覽，96px display，padding 64px |
| Large Desktop | >1440px | 容器最大寬度置中，區塊間距增加 |

### 觸控目標

- 最小觸控目標：44x44px（WCAG AAA）
- 藥丸按鈕：最低高度 48px，水平 padding 寬鬆
- 導覽連結：44px 觸控區
- 卡片表面：整張卡片可點擊（若已連結）

### 收合策略

- **導覽**：完整水平連結 → 在 1024px 以下變為漢堡選單；logo 與 CTA 按鈕保持可見
- **Hero 區塊**：96px display → 平板 70px → 行動裝置 48px；維持單欄置中
- **特色區塊**：2 欄文字加圖像 → 在 768px 以下堆疊為單欄
- **統計**：水平列 → 行動裝置上垂直堆疊
- **區塊 padding**：隨視窗縮窄 64px → 40px → 24px → 16px
- **卡片**：Grid → stack，在行動裝置上維持滿版寬度

### 圖像行為

- 產品截圖：在深色容器內響應式縮放，維持比例
- Hero 圖像：所有斷點下都滿版，懶載入搭配深色佔位
- 後台 UI 預覽：等比縮放，行動裝置上可能裁切
- 所有圖像使用 CDN（`cdn.shopify.com`）並搭配響應式 srcset

## 9. Agent 提示詞指南

### 快速配色參考

- 主要 CTA：Shopify White（`#FFFFFF`）
- 頁面背景：Void Black（`#000000`）
- 卡片表面：Deep Teal（`#02090A`）
- 區塊背景：Dark Forest（`#061A1C`）
- 浮起背景：Forest（`#102620`）
- 強調色：Neon Green（`#36F4A4`）
- 內文文字：White（`#FFFFFF`）
- 低調文字：Muted（`#A1A1AA`）
- 深色邊框：Dark Card Border（`#1E2C31`）

### 元件提示詞範例

- 「製作 hero 區塊：純黑（#000000）背景，96px/330 NeueHaasGrotesk 白色標題，20px/500 副標配色 #A1A1AA，兩顆藥丸按鈕：白色填色（9999px 圓角）與 2px 白邊框的 ghost 鈕。」
- 「設計特色卡片：Deep Teal（#02090A）底、1px #1E2C31 邊框、12px 圓角、多層陰影（1px ring 加 2px/4px/8px 模糊，10% 黑），內含 32px/360 白色標題與 18px/400 #A1A1AA 內文。」
- 「製作統計區塊：Dark Forest（#061A1C）底，96px/750 白色數字（NeueHaasGrotesk），16px/400 #A1A1AA 描述標籤，統計區塊之間留有寬鬆的 64px 間距。」
- 「製作 sticky 導覽：透明背景（捲動時轉為 #102620），左側白色 Shopify logo，18px/500 白色導覽連結配字距 0.72px，右側白色『Start for free』藥丸鈕。」
- 「設計 tag／徽章：rgba(255,255,255,0.2) 霧面玻璃背景、4px 圓角、12px 16px padding、白色 16px 文字 — 漂浮在深色卡片表面上。」

### 迭代指南

精修這套設計系統產出的畫面時：
1. 一次只專注於一個元件
2. 從本文件引用具體的色彩名稱與 hex 碼
3. 記住：這是一套**深色為主**的設計 — 淺色表面是例外、不是常態
4. Display 文字永遠要感覺輕盈（字重 330–400） — 看起來重了就要降字重
5. 霓虹綠（#36F4A4）很珍貴 — 只用於 focus 與強調，且要稀缺
6. 深色表面階層（黑 → 深青綠 → 深森林 → 森林）創造細微的深度
7. 陰影是多層的 — 單一 `box-shadow` 值無法捕捉 Shopify 的卡片感
8. 所有文字必須啟用 `ss03` OpenType 功能，以維持字型一致性
