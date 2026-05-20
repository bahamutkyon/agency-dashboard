# 受 Airbnb 啟發的設計系統

> 類別：E-Commerce & Retail
> 旅遊市集。溫暖珊瑚色強調、攝影驅動、圓潤的 UI。

## 1. 視覺主題與氛圍

Airbnb 的 2026 設計就像一本剛好做成 app 的旅遊雜誌 — 純淨的白色畫布上鋪滿滿版攝影，介面本身彷彿消失，讓房源照片自由呼吸。標誌性的 Rausch 珊瑚粉（`#ff385c`）用得克制卻無比鮮明：搜尋 CTA、active tab 指示、主要動作按鈕、偶爾出現的價格或願望清單愛心。除此之外，幾乎所有色彩都收斂在嚴謹的灰階裡，`#222222` 撐起頁面上幾乎每一行文字。

讓這套系統一眼就能認出是 Airbnb 的，是它對「內容」近乎信仰般的依賴。房源照片以 hero 規格展示，4:3 比例配上滿版圓角處理。類別切換透過 Homes／Experiences／Services 三段式 tab 完成，icon 是 3D 渲染的擬真插畫（斜頂房屋、熱氣球、服務鈴鐺） — 實體、觸感、近乎玩具般，搭配清爽俐落的 `Airbnb Cereal VF` 標籤。這是少數能讓 3D 渲染與純字型 UI 共存而不衝突的消費級產品。

最新的版面是 **Experiences** 產品線 — 同樣的外觀框架，但卡片密度更高、攝影更豐富，並有一張中央錨定的訂購面板搭配右側 sticky 定價欄。房源詳情頁（無論是住宿或體驗）遵循相同的範本：滿版 hero 圖像 grid → 浮在其上的圓角訂購卡（捲動時 sticky） → 設施 → 評論（Guest Favorite 獎項以大型置中的 `4.81` 評分配上桂冠葉飾呈現） → 地圖 → 房東檔案 → 揭露事項。不管訂的是一間房還是一場遊艇之旅，節奏始終一致。

**主要特徵：**
- Rausch 珊瑚粉（`#ff385c`）作為單一強調品牌色，只用於主要 CTA 與搜尋按鈕
- 滿版攝影採 4:3 / 16:9，搭配輕度圓角（14–20px），構成主要的視覺語彙
- 3D 渲染的類別 icon 搭配扁平字型 tab — 這是系統內唯一允許插畫的地方
- 圓形（`50%`）icon 按鈕（返回鍵、分享、收藏、輪播箭頭）散見於各處
- `Airbnb Cereal VF` 撐起每一個標籤，從 8px 法律附註到 28px 區塊標題 — 單一字型家族系統
- 產品分級的色彩編碼：Airbnb Plus（magenta `#92174d`）、Airbnb Luxe（深紫 `#460479`）、Airbnb（Rausch 珊瑚）
- Guest Favorite 獎項組合 — 在兩片桂冠葉之間置中一個巨大的評分數字，是這套系統最具辨識度的時刻之一
- Sticky 訂購面板，以「價格 → 日期 → 旅客」由上而下排列，桌面釘在右側欄、行動裝置變成底部錨定的「Reserve」橫條
- Sticky 底部行動裝置導覽（Explore／Wishlists／Log in），active 狀態帶 Rausch 染色

## 2. 配色系統與角色

### Primary
- **Rausch**（`#ff385c`）：品牌標誌珊瑚粉。CSS 變數 `--palette-bg-primary-core`。用於：主要「Reserve」按鈕、搜尋送出按鈕、active tab 底線、願望清單愛心填色、價格強調。整個頁面上能見度最高的單一顏色。

### 次要與強調
- **Deep Rausch**（`#e00b41`）：較飽和的變體。CSS 變數 `--palette-bg-tertiary-core`。用於按鈕的按壓／active 狀態與漸層的終點。
- **Plus Magenta**（`#92174d`）：CSS 變數 `--palette-bg-primary-plus`。Airbnb Plus 產品線的品牌色 — 一個高端、精選房源的服務。
- **Luxe Purple**（`#460479`）：CSS 變數 `--palette-bg-primary-luxe`。Airbnb Luxe 產品線的品牌色 — 別墅／莊園級的租賃服務。
- **Info Blue**（`#428bff`）：CSS 變數 `--palette-text-legal`。用於法律／資訊類連結（條款、隱私、揭露） — 系統內唯一的非單色連結色。

### 表面與背景
- **Canvas White**（`#ffffff`）：預設頁面背景。每張卡片、每個容器、每一頁詳情頁都從這裡開始。
- **Soft Cloud**（`#f7f7f7`）：低調的次表面染色，用於頁尾背景、地圖視圖外框，以及那些想稍微退一步的「其他」區塊。
- **Hairline Gray**（`#dddddd`）：無所不在的 1px 邊框色 — 分隔卡片、設施列、評論面板、頁尾欄位。是版面系統裡最辛勤的工作色。

### 中性與文字
- **Ink Black**（`#222222`）：CSS 變數 `--palette-text-primary`。系統的近黑色。每個標題、每段內文、每個導覽標籤、每個價格。佔頁面上約 90% 的文字。
- **Charcoal**（`#3f3f3f`）：CSS 變數 `--palette-text-focused`。用於 focus 狀態的輸入文字與略次一階的強調文案。
- **Ash Gray**（`#6a6a6a`）：CSS 變數 `--palette-bg-tertiary-hover`。次要標籤、城市名下的「Cottage rentals」副標題、低調的頁尾連結。
- **Mute Gray**（`#929292`）：CSS 變數 `--palette-text-link-disabled`。停用的按鈕與低優先級的 metadata。
- **Stone Gray**（`#c1c1c1`）：三級分隔線、icon 描邊、佔位頭像。

### 語意與強調
- **Error Red**（`#c13515`）：CSS 變數 `--palette-text-primary-error`。表單驗證錯誤、破壞性動作警示。
- **Deep Error**（`#b32505`）：CSS 變數 `--palette-text-secondary-error-hover`。錯誤狀態的按壓／active 變體。
- **Translucent Black**（`rgba(0, 0, 0, 0.24)`）：CSS 變數 `--palette-text-material-disabled`。Material 風格的停用標籤。

### 漸層系統
Airbnb 的品牌漸層出現得很節制，通常只用在字標與搜尋按鈕的品牌時刻：

```
linear-gradient(90deg, #ff385c 0%, #e00b41 50%, #92174d 100%)
```

這道珊瑚 → magenta 的掃光就是「品牌時刻」 — 從不用作整個表面，只用作窄窄的藥丸填色或 logo 處理。

## 3. 字型系統

### 字型家族
- **Airbnb Cereal VF**（主要也是唯一）：撐起整套系統的自家可變字重無襯線字型。Fallback（依序）：`Circular, -apple-system, system-ui, Roboto, Helvetica Neue, sans-serif`。

從擷取的 token 中觀察到的字重：500、600、700。沒有 400-regular — 系統的「body」字重是 500，讓每段文字都帶有一絲額外的密度，讀起來自信而有意志。

OpenType 功能：`salt`（stylistic alternates）用在緊湊的 11px 與 14px 600 字重標籤上 — 應該是為了更緊湊的數字與特殊字元造型。沒有觀察到 ligature 或分數數字功能。

### 層級

| 角色 | 大小 | 字重 | 行高 | 字距 | 備註 |
|------|------|--------|-------------|----------------|-------|
| Section Heading | 28px / 1.75rem | 700 | 1.43 | 0 | 「Inspiration for future getaways」— 頁面層級標題 |
| Subsection Heading | 22px / 1.38rem | 500 | 1.18 | -0.44px | 「What this place offers」、「Meet the hosts」— 內容分隔 |
| Card Title | 21px / 1.31rem | 700 | 1.43 | 0 | 評論面板標題、卡片主標 |
| Listing Title | 20px / 1.25rem | 600 | 1.20 | -0.18px | 「Small Group Yacht Tour, Unlimited Wine & Fruits」— 詳情頁的房源／體驗標題 |
| Subtitle Bold | 16px / 1.00rem | 600 | 1.25 | 0 | 房東名稱、城市名稱 |
| Body Medium | 16px / 1.00rem | 500 | 1.25 | 0 | 詳情頁的主要內文 |
| Button Large | 16px / 1.00rem | 500 | 1.25 | 0 | 「Reserve」、「Become a host」 |
| Button Default | 14px / 0.88rem | 500 | 1.29 | 0 | 標準按鈕標籤 |
| Link | 14px / 0.88rem | 500 | 1.43 | 0 | 導覽連結、頁尾連結 |
| Caption Medium | 14px / 0.88rem | 500 | 1.29 | 0 | Metadata、副標行（「Cottage rentals」、「Villa rentals」） |
| Caption Bold | 14px / 0.88rem | 600 | 1.43 | 0 | 啟用 `salt` — 數字統計、小字強調 |
| Caption Small | 13px / 0.81rem | 400 | 1.23 | 0 | 評論日期、微型 metadata |
| Micro Default | 12px / 0.75rem | 400 | 1.33 | 0 | 頁尾免責、法律小字 |
| Micro Bold | 12px / 0.75rem | 700 | 1.33 | 0 | 「NEW」藥丸標籤 |
| Badge Uppercase | 11px / 0.69rem | 600 | 1.18 | 0 | 啟用 `salt` — 緊湊的類別／狀態徽章 |
| Superscript | 8px / 0.50rem | 700 | 1.25 | 0.32px | 全大寫 — 價格附註、小數尾數 |

### 原則
- **一個家族，多種字重。** Airbnb Cereal VF 從 8px 法律附註到 28px 頁面標題全部包辦 — 視覺識別來自字型家族本身，而非字型混搭。
- **500 是新的 400。** 系統的「regular」字重是 500，讓每段內文比網頁預設多一點點自信質感。
- **負字距只用在 display 文字上。** 20px+ 的標題以 -0.18 到 -0.44px 收緊字距，呈現雕刻感；內文尺寸保持 0 字距以維持可讀性。
- **標題行高緊湊，內文寬鬆。** Display 文字行高 1.18–1.25（緊湊）；內文與說明文字放寬到 1.43，方便長文閱讀。
- **除了 8px 之外不用全大寫。** 系統內唯一的大寫轉換在 8px 上標 — 其他地方都用句首大寫加上細微字重變化來處理。

### 關於字型替代方案
Airbnb Cereal VF 是自家字型。最接近的開源替代是 **Circular Std**（仍是商業字型）或 **Inter**（免費，Google Fonts），display 尺寸下將字距減 -0.01em。要嚴格符合品牌精神，文件記錄的 fallback 鏈（`Circular, -apple-system, system-ui`）在 macOS/iOS 上會解析為 San Francisco，比例與 Cereal 相近，效果尚可接受。

## 4. 元件與模式

### 按鈕

**Primary CTA**（「Reserve」、「Search」、「Add dates」）
- 背景：Rausch `#ff385c`
- 文字：Canvas White `#ffffff`，Airbnb Cereal 500，16px
- Padding：垂直約 14px，水平 24px
- 圓角：8px（矩形）或 50%（圓形 icon 變體）
- 邊框：無
- Active／pressed：`transform: scale(0.92)` 加上 `0 0 0 2px` 的 2px `#222222` focus 光環

**Secondary Button**（「Become a host」、outlined 三級動作）
- 背景：`#ffffff`
- 文字：Ink Black `#222222`，Airbnb Cereal 500，14–16px
- Padding：10px 16px
- 圓角：20px（藥丸）或 8px（矩形）
- 邊框：1px solid Hairline Gray `#dddddd`

**Icon-Only 圓形按鈕**（返回鍵、分享、收藏、輪播控制）
- 背景：`#f2f2f2`（微微偏白）或白色加 1px 半透明黑色邊框
- Icon：`#222222` 描邊，16–20px
- 尺寸：直徑 32–44px
- 圓角：50%
- Active／pressed：`transform: scale(0.92)`；細微的 4px 白色光環 `0 0 0 4px rgb(255,255,255)`，用以在彩色照片背景上分離按鈕

**停用按鈕**
- 背景：`#f2f2f2`
- 文字：Stone Gray `#c1c1c1`
- 不透明度：0.5

**Pill Tab Button**（類別選擇「Homes / Experiences / Services」）
- 背景：透明
- 文字：Ink Black `#222222`，Airbnb Cereal 500，16px
- Padding：8px 14px
- Active 狀態：標籤下方 2px Ink Black 底線
- 標籤上方搭配 36–48px 的 3D 渲染插畫 icon

### 卡片與容器

**房源卡**（首頁 grid、搜尋結果）
- 背景：`#ffffff`
- 圓角：圖像 14px，文字直接置於下方透明背景上
- 圖像：4:3 比例，滿版，搭配相同的 14px 圓角
- Padding：外容器無；圖像與 metadata 列之間有 12px 間距
- 陰影：無 — 透過留白與照片本身的圓角來區隔
- Metadata 模式：第一行為城市／區域（16px 600）、第二行為距離／時長（14px 500 Ash Gray）、第三行為日期範圍、底部一行為價格附帶「per night」

**詳情頁訂購面板**（房源／體驗頁的右側 sticky）
- 背景：`#ffffff`
- 圓角：14–20px
- 邊框：1px solid Hairline Gray `#dddddd`
- 陰影：`rgba(0, 0, 0, 0.02) 0 0 0 1px, rgba(0, 0, 0, 0.04) 0 2px 6px 0, rgba(0, 0, 0, 0.1) 0 4px 8px 0` — 三層堆疊的低調抬升
- Padding：24px
- 寬度：約 370px，釘在視窗頂部下方 120–140px 處
- 內容：價格主標 → 日期挑選器 → 旅客下拉 → 主要 CTA →「You won't be charged yet」附註

**設施 Grid 卡**（房源詳情頁）
- 背景：`#ffffff`
- 邊框：列級別的 1px solid Hairline Gray `#dddddd`（不是每項都加）
- Padding：每個設施列垂直 16px
- Icon 加標籤模式：左側 24px 描邊 icon，右側 16px 500 字重標籤

**評論卡**（詳情頁中的單則評論）
- 背景：`#ffffff`，無邊框
- Padding：0（依賴 grid 間距）
- 內容：一列含 40px 圓形頭像、16px 600 字重姓名、14px 400 Ash Gray 日期，下方為 14px 500 內文段落

### 輸入框與表單

**搜尋列**（首頁主搜尋）
- 背景：`#ffffff`
- 邊框：1px solid Hairline Gray `#dddddd` 包覆三段（Where / When / Who）
- 圓角：32px（完整藥丸）
- 陰影：`rgba(0, 0, 0, 0.04) 0 2px 6px 0` — 細微的浮起感
- 結構：三段以纖細的垂直分隔線區隔，每段上方為 12px 500 標籤、下方為 14px 500 placeholder
- Submit：右端 Rausch 圓形 icon 按鈕，直徑 48px

**文字輸入**（一般表單）
- 背景：`#ffffff`
- 邊框：1px solid Hairline Gray `#dddddd`
- 圓角：8px
- Padding：14px 16px
- Focus：邊框切換為 Ink Black，並加上 `0 0 0 2px` 的黑色外環
- Error：邊框切換為 `#c13515`（Error Red），提示文字也用相同顏色

**日期挑選器**
- 行事曆 grid：7 欄，圓形（`50%`）日期儲存格寬 40–44px
- 已選範圍：Ink Black `#222222` 背景配白色數字
- 起始／結束錨點：較大的實心圓；中間日期使用 Soft Cloud `#f7f7f7` 染色

### 導覽

**桌面頂部導覽**
- 高度：約 80px
- 背景：`#ffffff`
- 左側：Airbnb 字標加 logo 組合，採 Rausch 色（102×32px）
- 中央：三段式類別選擇器（Homes / Experiences / Services），36–48px 3D icon 疊在 16px 500 標籤上方；active tab 帶 2px Ink Black 底線
- 右側：「Become a host」文字連結、32px 圓形地球（語言）、36px 漢堡頭像選單
- 底邊：1px solid Hairline Gray `#dddddd`

**行動裝置頂部導覽**
- 單列搜尋藥丸占滿寬度：「Start your search」placeholder 加上小型放大鏡 icon
- 下方：三段式類別選擇器持續存在（Homes / Experiences / Services） — 插畫 icon 縮小至約 28px
- 底部固定 tab bar：Explore（active 為 Rausch）／ Wishlists ／ Log in — 24px icon 配 12px 標籤

**房源詳情頁次要導覽**
- 捲動越過 hero 圖像後，會出現 sticky 的水平錨點連結（Photos · Amenities · Reviews · Location · Host）
- 高度：56px
- 底邊：1px solid Hairline Gray

### 圖像處理

- **主要比例**：首頁房源 grid 4:3，體驗 hero 16:9，頭像 1:1
- **圓角**：房源 grid 圖像 14px，詳情頁 hero 圖框 20px，頭像 `50%`
- **詳情頁圖像 grid**：五張照片 grid，左側單張大圖（占 50% 寬度），右側四張小圖排成 2×2，全部共用 20px 的外圓角容器
- **懶載入**：大量使用 `loading="lazy"` 並搭配模糊預覽
- **輪播**：圓形 32px 箭頭按鈕覆蓋在圖像上，垂直置中；點點指示器位於底邊上方 12px 處

### 招牌元件

**Guest Favorite 獎項組合**（高評分房源詳情頁醒目展示）
- 置中評分數字以 44–56px 700 字重呈現
- 兩片手繪 SVG 桂冠葉飾，分別位於左右兩側，高約 48px
- 下方：「Guest Favorite」標籤 12px 700 全大寫，字距 `0.32px`，以及短副標 14px 500 Ash Gray
- 滿版區塊，無容器邊框 — 直接坐落在白色畫布上

**三段式類別選擇器**（出現在所有瀏覽介面的頂部）
- 三個 tab：Homes / Experiences / Services
- 每個 tab：3D 渲染插畫 icon（約 48px 高）上方為 16px 500 標籤
- Experiences 與 Services 目前在 icon 右上角帶一顆小型海軍藍「NEW」藥丸（12px 700 白字配深藍底）
- Active tab：標籤下方 2px Ink Black 底線

**靈感城市 Grid**（首頁的「Inspiration for future getaways」）
- 桌面 6 欄目的地連結 grid，行動裝置 2 欄
- 每格：第一行 16px 600 城市名，第二行 14px 500 Ash Gray 租賃類型副標（「Cottage rentals」、「Villa rentals」）
- 無圖像 — 純文字 grid
- 上方以類別 tab 切換（Popular / Arts & culture / Beach / Mountains / Outdoors / Things to do / Travel tips & inspiration / Airbnb-friendly apartments） — active tab 帶 2px 底線並有字重變化

**Reserve Sticky 卡**（房源詳情頁）
- 桌面上隨使用者捲動越過 hero 後，固定於視窗頂部下方 120px 處
- 行動裝置上會收合為一條滿版底部橫條，顯示「From $X / night」與 Rausch「Reserve」藥丸
- 永遠顯示：價格主標 → 日期顯示 → 旅客選擇器 → Rausch CTA →「You won't be charged yet」免責聲明

**Experience Host 卡**（體驗詳情頁）
- 滿版圓角容器，頂部為 3:2 封面照
- 圓形 56px 房東頭像，半覆蓋在封面底邊
- 在重疊下方：房東姓名 16px 700、任職年資 14px 500 Ash Gray、小型 Rausch「Message host」藥丸按鈕
- 用作評論與設施／位置區塊之間的過場

**「Things to know」說明條**（房源詳情頁）
- 3 欄的規則／政策區塊（House rules、Safety & property、Cancellation policy）
- 每欄：頂部 icon、16px 600 標題、14px 500 Ash Gray 內文、Ink Black 底線的「Show more」連結
- 分隔：整條的上下緣有 1px Hairline Gray 邊框

## 5. 間距與佈局

### 間距系統
- **基準單位**：8px
- **擷取出的刻度**：2、3、4、5.5、6、8、10、11、12、15、16、18.5、22、24、32px — 細粒度，並有少數偏離 grid 的數值用於像素級的 icon 對齊
- **區塊 padding**：桌面上下約 48–64px，行動裝置 24–32px
- **卡片內部 padding**：訂購面板與大型卡片 24px，設施列 16px，房源卡 metadata 12px
- **房源卡之間的間隙**：桌面 24px，行動裝置 16px
- **堆疊文字列之間**：4–8px（非常緊湊 — 強化旅遊房源「資訊密集」的感受）

### Grid 與容器
- **最大內容寬度**：超寬螢幕 1760–1920px（Airbnb 比多數網站讓 grid 呼吸得更開）；多數詳情頁為 1280px
- **首頁房源 grid**：≥1760px 為 6 欄，≥1440px 為 5 欄，≥1128px 為 4 欄，≥800px 為 3 欄，≥550px 為 2 欄，以下為 1 欄
- **詳情頁**：2 欄非對稱 — 主內容約 58%，右側 sticky 訂購面板約 36%，間隙約 6%
- **頁尾**：3 欄 Support / Hosting / Airbnb

### 留白哲學
Airbnb 資訊密集但從不擁擠。留白被用來「分組」 — 房源卡之間有 24px 的間隙，讓每張照片各自獨立；但卡片下的 metadata 使用 4–8px 的間距，讓價格、城市、日期讀起來是一個整體。詳情頁訂購面板內部 padding 為 24px，但其中各列（日期選擇、旅客選擇、CTA）以 12px 堆疊 — 卡片與頁面之間的邊界承擔了主要的視覺分隔，而非內部內容。

### 圓角刻度
| 圓角 | 用途 |
|--------|-----|
| 4px | inline 錨點、tag chip |
| 8px | 文字按鈕、下拉選單、小型工具按鈕 |
| 14px | 房源卡圖像、一般內容容器、徽章 |
| 20px | 主要圓角按鈕（藥丸）、大型圖像、訂購面板 |
| 32px | 搜尋藥丸列、超大容器 |
| 50% | 所有圓形 icon 按鈕、所有頭像、願望清單愛心 — 系統招牌的圓形幾何 |

## 6. 深度與層次

| 層級 | 處理方式 | 用途 |
|-------|-----------|-----|
| 0 | 無陰影 | 房源卡、內文、純文字區塊 |
| 1 | `rgba(0, 0, 0, 0.08) 0 4px 12px` | Active／pressed icon 按鈕（如返回、分享、收藏） — 細微抬升表示互動 |
| 2 | `rgba(0, 0, 0, 0.02) 0 0 0 1px, rgba(0, 0, 0, 0.04) 0 2px 6px 0, rgba(0, 0, 0, 0.1) 0 4px 8px 0` | 訂購面板 sticky 卡、對話框、下拉選單 — 系統招牌的三層抬升 |
| Focus 光環 | `0 0 0 2px #222222` | Active 狀態按鈕、聚焦的搜尋輸入 |
| 白色分隔光環 | `rgb(255, 255, 255) 0 0 0 4px` | 疊在照片上的圓形按鈕 — 4px 白色光環將按鈕乾淨地從繽紛圖像背景中分離出來 |

陰影哲學：Airbnb 採用**多層堆疊陰影**而非單一陰影。三層的訂購面板陰影讀起來是一個整體的抬升，實際上是三層在不同 opacity／blur 下的陰影 — 在陰影邊緣產生細微的反鋸齒感，呈現高端而不沉重的質感。

### 裝飾性深度
- **以攝影代替深度**：系統重度依賴滿版攝影創造視覺深度；陰影與漸層用得節制，讓照片擔綱
- **桂冠葉組合**：Guest Favorite 獎項使用兩片 SVG 桂冠葉飾，讓原本扁平的評分數字有了一種儀式般、獎盃般的存在感
- **3D 渲染類別 icon**：Homes/Experiences/Services 的 icon 自帶柔和的內部光線與細微投影 — 是品牌唯一允許「立體」插畫的地方

## 7. Do's and Don'ts

### Do
- 把 Rausch `#ff385c` 保留給主要動作與 active tab 指示 — 不要用在裝飾性場合稀釋它。
- 讓攝影呼吸 — 4:3 裁切配 14–20px 圓角，不要加文字覆蓋、不要加漸層遮罩。
- Rausch 以下的每一層文字都用 Ink Black `#222222` — 這是系統的近黑色，永遠不要用真正的 `#000000`。
- 將三段式類別選擇器的 3D 插畫 icon 搭配扁平字型呈現 — 不要在同一介面內混用不同插畫風格。
- 用三層低不透明度陰影（約 2%、4%、10%）疊出招牌的訂購面板抬升。
- 卡片對卡片、列對列的分隔，一律用 Hairline Gray `#dddddd` 1px 邊框。
- 訂購面板桌面 sticky，行動裝置改為底部錨定的 reserve 橫條。
- Metadata 群組內用 4–8px、卡片之間用 24px — 資訊密度是刻意的。

### Don't
- 不要在 Rausch / Plus Magenta / Luxe Purple 的產品分級配色之外引入其他強調色。
- 不要在照片上放文字 — 圖說永遠放在圖像下方，不要疊上去。
- 不要用全大寫標籤，除了那唯一一個 8px 上標角色。
- 不要把 icon 按鈕的圓角設成 50% 以外的值 — 圓形是系統的招牌幾何。
- 不要為房源卡加 drop shadow — 它們坐落在白色畫布上，無需抬升。
- 不要用漸層背景 — 系統內唯一的漸層是字標上那道窄窄的 Rausch → magenta 掃光。
- 不要用 400-regular 字重 — Airbnb Cereal 的內文字重是 500。
- 不要把 Airbnb Cereal VF 換成別的 display 字型 — 系統刻意只用單一家族。

## 8. 響應式行為

### 斷點

Airbnb 從元件庫宣告了約 60 個斷點（設計階段的產物），但有意義的佈局切換發生在小得多的子集上：

| 名稱 | 寬度 | 主要變化 |
|------|-------|-------------|
| Ultra-wide | ≥1760px | 6 欄房源 grid，最大內容寬度 1760–1920px |
| Desktop XL | 1440–1759px | 5 欄 grid，導覽完整顯示，右側 sticky 訂購面板 |
| Desktop | 1128–1439px | 4 欄 grid，sticky 訂購面板持續存在 |
| Laptop | 1024–1127px | 3–4 欄 grid，類別導覽仍水平 |
| Tablet | 800–1023px | 3 欄 grid，全域搜尋可能收合為單列藥丸 |
| Small tablet | 550–799px | 2 欄 grid，訂購面板掉到滿版 inline 區塊 |
| Mobile | 375–549px | 單欄堆疊，底部固定 tab bar 出現（Explore / Wishlists / Log in） |
| Small mobile | <375px | 邊距縮為 16px，類別選擇器 icon 縮為約 28px |

### 觸控目標
所有互動元素達到或超過 44×44px。圓形 icon 按鈕家族特意維持 32–44px，並有 8–12px 擴充點擊區。Rausch 主要 Reserve 按鈕高度約 48px。三段式類別選擇器的點擊區是整個「標籤加 icon」矩形（通常每個 tab 約 64×80px）。

### 收合策略
- **導覽**：在平板以上的尺寸保留 Airbnb 字標加三段式選擇器；行動裝置上選擇器滑到搜尋藥丸下方，地球／頭像控制移至底部錨定的 tab bar。
- **搜尋列**：桌面為 Where / When / Who 三段藥丸加 Rausch 圓形 submit 按鈕；行動裝置收合為單列「Start your search」藥丸，點擊後開啟全螢幕搜尋面板。
- **訂購面板**：≥1128px 為右側 sticky；800–1127px 為主內容欄內 inline；<800px 為底部固定的「Reserve」藥丸。
- **房源 grid**：依斷點重排為 6 → 5 → 4 → 3 → 2 → 1 欄。
- **詳情頁圖像 grid**：桌面五張圖像（1 大加 4 小）；行動裝置變為滿版可滑動輪播配頁面點點指示器。
- **頁尾**：3 欄佈局在 <800px 收合為單欄堆疊。

### 圖像行為
- 全面採用 `loading="lazy"`，並用帶 `im_w=` 參數的 URL 提供模糊預覽縮圖
- 響應式圖像使用 Airbnb 的 `muscache.com` CDN，搭配 `im_w` 查詢參數依寬度遞送（`im_w=240`、`im_w=720`、`im_w=1200`、`im_w=2400`）
- 無 art-direction 裁切 — 同一張圖在不同斷點等比縮放
- 輪播會自動調整照片高度以維持 4:3 比例，無論來源比例為何

## 9. Agent 提示詞指南

### 快速配色參考
- 主要 CTA：「Rausch (#ff385c)」
- 頁面背景：「Canvas White (#ffffff)」
- 次表面：「Soft Cloud (#f7f7f7)」
- 標題／內文文字：「Ink Black (#222222)」
- 次要文字：「Ash Gray (#6a6a6a)」
- 邊框／分隔：「Hairline Gray (#dddddd)」
- 錯誤：「Error Red (#c13515)」
- 資訊連結：「Info Blue (#428bff)」
- Luxe 分級強調：「Luxe Purple (#460479)」
- Plus 分級強調：「Plus Magenta (#92174d)」

### 元件提示詞範例
- 「製作主要 Reserve 按鈕：Rausch (#ff385c) 背景，白色 Airbnb Cereal 500 字重 16px 標籤，padding 14px × 24px，8px 圓角，無陰影。Active／pressed 時加上 `transform: scale(0.92)` 與 2px Ink Black focus 光環（`0 0 0 2px #222222`）。」
- 「製作房源卡，4:3 滿版照片配 14px 圓角，外容器無陰影；圖像下方堆疊三列文字，每列 4px 間距：第一行城市名 16px 600 Ink Black，第二行租賃類型 14px 500 Ash Gray (#6a6a6a)，第三行價格區間 16px 500 Ink Black 配 14px『per night』後綴。」
- 「設計 sticky 訂購面板：白底，14px 圓角，1px Hairline Gray (#dddddd) 邊框，三層抬升陰影（`rgba(0,0,0,0.02) 0 0 0 1px, rgba(0,0,0,0.04) 0 2px 6px 0, rgba(0,0,0,0.1) 0 4px 8px 0`），24px padding，寬 370px，桌面釘在視窗頂部下方 120px。內容：價格主標、日期挑選器、旅客下拉、Rausch 主要 CTA，以及 12px Ash Gray 的『You won't be charged yet』附註。」
- 「製作三段式類別選擇器：三個等寬 tab，標籤為 Homes、Experiences、Services；每個 tab 上方有約 48px 的 3D 渲染插畫 icon（房屋、氣球、鈴鐺），下方為 16px 500 Ink Black 標籤；active tab 帶 2px Ink Black 底線；Experiences 與 Services 的 icon 右上角加一顆小型 12px 700 白字、深海軍藍底的『NEW』藥丸。」
- 「呈現 Guest Favorite 獎項組合：中央評分數字 52px 700 字重 Ink Black，左右兩側各有約 48px 高的手繪 SVG 桂冠葉飾；下方為 12px 700 全大寫、0.32px 字距的『GUEST FAVORITE』標籤；副標 14px 500 Ash Gray；滿版區塊直接坐落在白色畫布上，無容器邊框。」

### 迭代指南
精修這套設計系統產出的畫面時：
1. 一次只專注於一個元件。
2. 從本文件引用具體的色彩名稱與 hex 碼（例如「Ink Black #222222」，而不是「深灰色」）。
3. 用自然語言描述搭配尺寸數據（例如「細微的三層抬升」而非一長串 shadow 字串）。
4. 描述想要的「感覺」（如「雜誌感、攝影優先」對比「資訊密集的工具感」）。
5. 內文預設使用 Airbnb Cereal VF 500 字重，強調用 600–700 — 永遠不用 400。
6. Rausch 粉要稀缺 — 若一個視窗內出現超過一個 Rausch 色元素，要思考是否該中和掉其中一個。

### 已知缺口
- **首頁房源 grid 卡**：airbnb.com 的主要視覺面 — 房源卡 grid — 在擷取的首頁截圖中未完整載入。上文房源卡規格是從靈感 grid 結構與 Airbnb 整體慣例推導而來；正式生產使用前請以實際網站確認比例與 metadata 階層。
- **Experiences 類別 icon**：Homes / Experiences / Services 的 3D 插畫 icon 以點陣資產提供；其原始檔規格（SVG vs PNG、實際像素尺寸）未在此文件記錄。
- **動畫與過場時序**：未擷取 — 屬靜態擷取範圍之外。
- **深色模式**：Airbnb 在擷取的產品介面中未推出原生深色模式；本文件僅描述單一的淺色主題。
