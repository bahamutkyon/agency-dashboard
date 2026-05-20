# PostHog 啟發的設計系統

> 類別：Backend & Data
> 產品分析。俏皮的刺蝟品牌、開發者友善的深色 UI。

## 1. 視覺主題與氛圍

PostHog 的網站像是一份從新創公司內部 wiki 逃出來闖蕩世界的文件——溫暖、不羈，刻意反企業化。背景不是開發者工具預期的明亮純白或暗黑虛空，而是一片帶著鼠尾草色調的米白（`#fdfdf8`），讓每個表面都帶有手工、紙張般的質感。色彩偏向大地系的橄欖綠與柔和的鼠尾草色，不走 SaaS 世界慣用的藍紫路線。彷彿有人在舒適的花園小屋裡設計了一個開發者分析平台。

個性才是主角：手繪刺蝟插畫、古怪的玩具公仔、俏皮的圖像，取代了 B2B SaaS 典型的圖庫照片與抽象漸層。IBM Plex Sans Variable 作為字型基礎——一款帶有真實技術可信度的字型（由 IBM 創造、在開發者情境中廣泛使用），在這裡以粗字重（700、800）出現於標題，內文則搭配寬裕的行高。字型在說「我們是認真的工程師」，而周遭一切都在說「但我們不會太把自己當一回事」。

互動設計延續相同精神：hover 狀態閃現 PostHog Orange（`#F54E00`）的文字——一個平時不見、互動時驚喜出現的隱藏品牌色。深色近黑的按鈕（`#1e1f23`）在 hover 時降低不透明度而非變色，啟用狀態略微縮放。邊框系統使用帶鼠尾草色調的灰（`#bfc1b7`），與橄欖色文字盤面協調。底層建立在 Tailwind CSS 加上 Radix UI 與 shadcn/ui 元件之上，技術基底現代且元件導向，但視覺輸出頑強獨特。

**核心特徵：**
- 暖色鼠尾草／橄欖配色取代慣用的藍色——大地感且平易近人
- IBM Plex Sans Variable 字型，標題用粗字重（700/800）搭配 1.50+ 的寬裕行高
- 隱藏的品牌橘（`#F54E00`）只在 hover 互動時出現——令人愉悅的驚喜
- 手繪刺蝟插畫與俏皮圖像——刻意反企業化
- 鼠尾草色邊框（`#bfc1b7`）與背景（`#eeefe9`）建構統一的暖綠系統
- 深色近黑 CTA（`#1e1f23`）以不透明度做 hover 狀態
- 內容密集的編輯風佈局——網站讀起來像雜誌而非典型 landing page
- Tailwind CSS + Radix UI + shadcn/ui 元件架構

## 2. 配色系統與角色

### 主要色
- **Olive Ink** (`#4d4f46`)：主要文字色——獨特的橄欖灰，讓所有文字帶有溫暖大地色調
- **Deep Olive** (`#23251d`)：連結文字與高強調標題——帶綠色底蘊的近黑
- **PostHog Orange** (`#F54E00`)：隱藏的品牌點綴——只在 hover 狀態出現的鮮亮橘色驚喜

### 次要與點綴
- **Amber Gold** (`#F7A501`)：深色按鈕上的次要 hover 點綴——與橘色相配的溫暖金色
- **Gold Border** (`#b17816`)：特殊按鈕邊框——精選 CTA 用的琥珀金
- **Focus Blue** (`#3b82f6`)：focus ring 色（Tailwind 預設）——系統中唯一的藍色，保留給無障礙用途

### 表面與背景
- **Warm Parchment** (`#fdfdf8`)：主頁面背景——帶黃綠底蘊的暖近白
- **Sage Cream** (`#eeefe9`)：輸入背景、次要表面——淺鼠尾草色調
- **Light Sage** (`#e5e7e0`)：按鈕背景、第三層表面——柔和的鼠尾草綠
- **Warm Tan** (`#d4c9b8`)：精選按鈕背景——暖棕／卡其色用於強調
- **Hover White** (`#f4f4f4`)：通用 hover 背景狀態

### 中性與文字
- **Olive Ink** (`#4d4f46`)：主要內文與 UI 文字
- **Muted Olive** (`#65675e`)：次要文字、淺色背景上的按鈕標籤
- **Sage Placeholder** (`#9ea096`)：placeholder 文字、disabled 狀態——溫暖鼠尾草綠
- **Sage Border** (`#bfc1b7`)：主要邊框色——所有邊框用的橄欖灰
- **Light Border** (`#b6b7af`)：次要邊框、工具列邊框——略深的鼠尾草色

### 語意與點綴
- **PostHog Orange** (`#F54E00`)：hover 文字點綴——示意互動性與品牌個性
- **Amber Gold** (`#F7A501`)：深色按鈕的 hover 點綴——溫暖訊號
- **Focus Blue** (`#3b82f6` 50% 不透明)：鍵盤 focus ring——僅供無障礙用
- **Dark Text** (`#111827`)：高對比連結文字——重要連結用的近黑

### 漸層系統
- 行銷網站不使用漸層——PostHog 的視覺語言刻意保持扁平與溫暖
- 深度透過層疊表面與邊框收束達成，而非色彩漸變

## 3. 字型系統

### 字型家族
- **展示與內文**：`IBM Plex Sans Variable`——可變字型（字重範圍 100–700+）。備援：`IBM Plex Sans, -apple-system, system-ui, Avenir Next, Avenir, Segoe UI, Helvetica Neue, Helvetica, Ubuntu, Roboto, Noto, Arial`
- **等寬字型**：`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New`——系統等寬字堆疊
- **程式碼展示**：`Source Code Pro`——備援：`Menlo, Consolas, Monaco`

### 階層

| 角色 | 字型 | 字級 | 字重 | 行高 | 字距 | 備註 |
|------|------|------|------|------|------|------|
| Display Hero | IBM Plex Sans Variable | 30px | 800 | 1.20 | -0.75px | 超粗、緊縮、最大衝擊 |
| Section Heading | IBM Plex Sans Variable | 36px | 700 | 1.50 | 0px | 大字級但行高寬裕 |
| Feature Heading | IBM Plex Sans Variable | 24px | 700 | 1.33 | 0px | 功能區段標題 |
| Card Heading | IBM Plex Sans Variable | 21.4px | 700 | 1.40 | -0.54px | 略不尋常的尺寸（縮放） |
| Sub-heading | IBM Plex Sans Variable | 20px | 700 | 1.40 | -0.5px | 內容子區段 |
| Sub-heading Uppercase | IBM Plex Sans Variable | 20px | 700 | 1.40 | 0px | 用大寫變形作為標籤 |
| Body Emphasis | IBM Plex Sans Variable | 19.3px | 600 | 1.56 | -0.48px | 半粗的引人文字 |
| Label Uppercase | IBM Plex Sans Variable | 18px | 700 | 1.50 | 0px | 大寫類別標籤 |
| Body Semi | IBM Plex Sans Variable | 18px | 600 | 1.56 | 0px | 半粗內文 |
| Body | IBM Plex Sans Variable | 16px | 400 | 1.50 | 0px | 標準閱讀文字 |
| Body Medium | IBM Plex Sans Variable | 16px | 500 | 1.50 | 0px | 中等字重的內文 |
| Body Relaxed | IBM Plex Sans Variable | 15px | 400 | 1.71 | 0px | 寬鬆行高用於長文 |
| Nav / UI | IBM Plex Sans Variable | 15px | 600 | 1.50 | 0px | 導覽與 UI 標籤 |
| Caption | IBM Plex Sans Variable | 14px | 400–700 | 1.43 | 0px | 多種字重的小字 |
| Small Label | IBM Plex Sans Variable | 13px | 500–700 | 1.00–1.50 | 0px | 標籤、徽章、微標 |
| Micro | IBM Plex Sans Variable | 12px | 400–700 | 1.33 | 0px | 最小文字，部分大寫 |
| Code | Source Code Pro | 14px | 500 | 1.43 | 0px | 程式碼片段與終端機 |

### 原則
- **粗體標題主導**：標題使用 700–800 字重——PostHog 的字型自信而堅定，不耳語
- **寬裕的內文行高**：內文行高 1.50–1.71 創造極舒適的閱讀感——網站內容密集，為長時間閱讀而最佳化
- **小數點字級**：多個尺寸（21.4px、19.3px、13.7px）暗示這是流動／縮放的字型系統，而非固定段落——可能是基於非標準 base 計算的 Tailwind rem 尺度
- **大寫作為類別信號**：粗體大寫標籤（18px–20px 字重 700）用於產品類別標題——雜誌編輯的慣例
- **選擇性的負字距**：展示文字字距收緊（30px 用 -0.75px），但內文放鬆到 0px——標題壓縮、內文呼吸

## 4. 元件樣式

### 按鈕
- **深色主要**：`#1e1f23` 背景、白色文字、6px 圓角、`10px 12px` padding。Hover：不透明度 0.7 並顯示 Amber Gold 文字。啟用：不透明度 0.8 並輕微縮放。主要 CTA——深色而自信
- **淺鼠尾草**：`#e5e7e0` 背景、Olive Ink（`#4d4f46`）文字、4px 圓角、`4px` padding。Hover：`#f4f4f4` 底色帶 PostHog Orange 文字。緊湊的工具型按鈕
- **暖棕精選**：`#d4c9b8` 背景、黑色文字、無可見圓角。Hover：同樣閃現橘色文字。精選／高階動作
- **輸入框風格**：`#eeefe9` 背景、Sage Placeholder（`#9ea096`）文字、4px 圓角、1px `#b6b7af` 邊框。看起來像搜尋／篩選控制項
- **近白 Ghost**：`#fdfdf8` 背景、Olive Ink 文字、4px 圓角、透明 1px 邊框。最低調的存在
- **Hover 模式**：所有按鈕 hover 時都閃現 PostHog Orange（`#F54E00`）或 Amber Gold（`#F7A501`）文字——這是品牌標誌性的互動驚喜

### 卡片與容器
- **帶邊框卡片**：Warm Parchment（`#fdfdf8`）或白色背景、1px `#bfc1b7` 邊框、4px–6px 圓角——乾淨而極簡
- **鼠尾草表面卡片**：`#eeefe9` 背景用於次要內容容器
- **陰影卡片**：`0px 25px 50px -12px rgba(0, 0, 0, 0.25)`——升起內容（彈窗、下拉選單）唯一的深陰影
- **Hover**：互動卡片閃現橘色文字——與按鈕行為一致

### 輸入與表單
- **預設**：`#eeefe9` 背景、`#9ea096` placeholder、1px `#b6b7af` 邊框、4px 圓角、`2px 0px 2px 8px` padding
- **Focus**：`#3b82f6` ring 50% 不透明度（Tailwind 藍色 focus ring）
- **文字色**：輸入值用 `#374151`——比主要文字更深，便於閱讀
- **邊框變體**：多種邊框模式——有些輸入框使用複合邊框（只用 top、left、bottom 邊）

### 導覽
- **頂部導覽**：暖色背景、IBM Plex Sans 15px 字重 600
- **下拉選單**：豐富的 mega-menu 結構，含產品類別
- **連結色**：導覽連結 Deep Olive（`#23251d`），hover 加底線
- **CTA**：深色主要按鈕（`#1e1f23`）放在導覽——「Get started - free」
- **手機**：摺疊成漢堡選單，搭配簡化菜單

### 圖像處理
- **手繪插畫**：刺蝟吉祥物與古怪插畫——標誌性的視覺元素
- **產品截圖**：嵌入裝置框架或乾淨容器的 UI 截圖
- **玩具公仔**：俏皮的刺蝟公仔產品攝影——反企業化
- **信任 logo**：企業 logo（Airbus、GOV.UK）展示在低調的信任列
- **長寬比**：混搭——插畫不規則、截圖為 16:9 或寬螢幕

### AI Chat 元件
- 浮動的 PostHog AI 助理搭配對話泡泡——內嵌於行銷網站的互動產品 demo

## 5. 間距與佈局

### 間距系統
- **基本單位**：8px
- **尺度**：2px、4px、6px、8px、10px、12px、16px、18px、24px、32px、34px
- **區段 padding**：區段間垂直 32px–48px（對內容密集的網站而言相當緊湊）
- **卡片內距**：4px–12px 內部（明顯緊湊）
- **元件間距**：相關元素之間 4px–8px

### 網格與容器
- **最大寬度**：1536px（最大斷點），內容容器多為 1200px–1280px
- **欄位模式**：多樣化——文字內容用單欄、功能卡片用 2–3 欄格線、產品 demo 用不對稱佈局
- **斷點**：定義 13 個——1px、425px、482px、640px、768px、767px、800px、900px、1024px、1076px、1160px、1280px、1536px

### 留白哲學
- **內容密集為設計初衷**：PostHog 網站資訊豐富——留白是節制而非奢侈
- **編輯風的節奏**：內容區段像雜誌般流動，多樣化的佈局讓視線持續移動
- **插畫作為呼吸空間**：手繪刺蝟藝術自然地打破密集內容區段

### 圓角尺度
- **2px**：小型行內元素、標籤（`span`）
- **4px**：主要 UI 元件——按鈕、輸入、下拉、選單項目（`button`、`div`、`combobox`）
- **6px**：次要容器——較大按鈕、列表項、卡片變體（`button`、`div`、`li`）
- **9999px**：藥丸形——徽章、狀態指示器、圓角標籤（`span`、`div`）

## 6. 深度與層次

| 層級 | 處理方式 | 用途 |
|------|----------|------|
| Level 0（平面） | 無陰影、暖羊皮紙背景 | 頁面畫布、大多數表面 |
| Level 1（邊框） | `1px solid #bfc1b7`（鼠尾草邊框） | 卡片收束、輸入邊框、區段分隔 |
| Level 2（複合邊框） | 不同邊上多條 1px 邊框 | 輸入分組、工具列元素 |
| Level 3（深陰影） | `0px 25px 50px -12px rgba(0, 0, 0, 0.25)` | 彈窗、浮動元素、mega-menu 下拉 |

### 陰影哲學
PostHog 的層次系統極度極簡——整個系統只定義一個陰影。深度透過以下方式傳達：
- **邊框收束**：鼠尾草色邊框（`#bfc1b7`）1px 創造溫和的暖色分隔
- **表面色彩位移**：從 `#fdfdf8` 到 `#eeefe9` 再到 `#e5e7e0` 形成沒有陰影的層疊深度
- **唯一陰影**：定義的這個陰影（`0 25px 50px -12px`）保留給浮動元素——彈窗、下拉、popover。是深沉、戲劇化的陰影，必要時清楚拉開層次

### 裝飾性深度
- **插畫層疊**：手繪刺蝟藝術自然創造視覺深度
- **無漸層或光暈**：扁平、溫暖的表面系統完全依靠邊框與表面色差來區分
- **不用玻璃擬態**：全站使用完全不透明的表面

## 7. Do's and Don'ts

### Do
- 使用橄欖／鼠尾草色系（`#4d4f46`、`#23251d`、`#bfc1b7`）做文字與邊框——暖綠底蘊是品牌的核心
- 在 hover 狀態閃現 PostHog Orange（`#F54E00`）——這是隱藏的品牌簽名
- 標題用 IBM Plex Sans 的粗字重（700/800）——這款字帶有技術可信度
- 內文行高保持寬裕（1.50–1.71）——內容密集的網站需要可讀性
- 維持暖羊皮紙背景（`#fdfdf8`）——非純白、永不冰冷
- 大多數 UI 元素用 4px 圓角——保持低調且功能取向
- 加入俏皮、手繪的插畫元素——個性才是差異化的關鍵
- 深色按鈕用不透明度（0.7）做 hover 而非變色

### Don't
- 不要用藍、紫等典型科技 SaaS 顏色——PostHog 的盤面刻意走橄欖／鼠尾草
- 不要加重陰影——系統只有一個陰影給浮動元素，其餘都靠邊框
- 不要把設計做得「精緻」或「高階」的傳統感——PostHog 的魅力在於不羈、克難的能量
- 不要把內文行高調緊——寬裕的 1.50+ 對密集內容是必要的
- 不要在卡片用大圓角（12px+）——PostHog 用 4px–6px，保持緊實與功能性
- 不要拿掉橘色 hover 閃光——這是核心互動模式，不是裝飾
- 不要用圖庫照片取代插畫——手繪刺蝟藝術就是品牌
- 不要用純白（`#ffffff`）當頁面背景——暖鼠尾草米白（`#fdfdf8`）色調是根基

## 8. 響應式行為

### 斷點
| 名稱 | 寬度 | 主要變化 |
|------|------|----------|
| Mobile Small | <425px | 單欄、緊湊 padding、卡片堆疊 |
| Mobile | 425px–640px | 略調整佈局、更大的觸控目標 |
| Tablet | 640px–768px | 開始出現 2 欄、部分導覽可見 |
| Tablet Large | 768px–1024px | 多欄佈局、展開導覽 |
| Desktop | 1024px–1280px | 完整佈局、3 欄功能格線、展開 mega-menu |
| Large Desktop | 1280px–1536px | 最大寬度容器、寬裕邊距 |
| Extra Large | >1536px | 容器置中於最大寬度 |

### 觸控目標
- 按鈕：4px–6px 圓角搭配 `4px–12px` padding——緊湊但可用
- 導覽連結：15px 字重 600 搭配足夠 padding
- 手機：漢堡選單搭配簡化導覽
- 輸入框：寬裕的垂直 padding，便於拇指操作

### 摺疊策略
- **導覽**：完整 mega-menu 含下拉 → 手機漢堡選單
- **功能格線**：3 欄 → 2 欄 → 單欄堆疊
- **字型**：展示尺寸跨斷點縮減（30px → 更小）
- **插畫**：容器內等比縮放，手機可能隱藏部分以節省空間
- **區段間距**：等比例縮減同時保持可讀性

### 圖像行為
- 插畫在容器內響應式縮放
- 產品截圖維持長寬比
- 信任 logo 在手機上重新流入多列格線
- AI chat 元件在小螢幕可能重新定位或簡化

## 9. Agent Prompt 指南

### 快速色彩參考
- 主要文字：Olive Ink（`#4d4f46`）
- 深色文字：Deep Olive（`#23251d`）
- Hover 點綴：PostHog Orange（`#F54E00`）
- 深色 CTA：近黑（`#1e1f23`）
- 按鈕表面：Light Sage（`#e5e7e0`）
- 頁面背景：Warm Parchment（`#fdfdf8`）
- 邊框：Sage Border（`#bfc1b7`）
- Placeholder：Sage Placeholder（`#9ea096`）

### 範例元件 Prompt
- 「在暖羊皮紙背景（`#fdfdf8`）上建立 hero 區段，30px IBM Plex Sans 標題字重 800、行高 1.20、字距 -0.75px、Olive Ink 文字（`#4d4f46`），搭配深色 CTA 按鈕（`#1e1f23`、6px 圓角、白色文字、hover 時不透明度 0.7）」
- 「設計功能卡片：`#fdfdf8` 背景、1px `#bfc1b7` 邊框、4px 圓角，IBM Plex Sans 標題 20px 字重 700，16px 內文字重 400 行高 1.50 用 Olive Ink（`#4d4f46`）」
- 「打造導覽列：暖色背景、IBM Plex Sans 連結 15px 字重 600 用 Deep Olive（`#23251d`）、hover 加底線，右邊放深色 CTA 按鈕（`#1e1f23`）」
- 「建立按鈕群組：主要深色（`#1e1f23` 白色文字 6px 圓角）、次要鼠尾草（`#e5e7e0`、`#4d4f46` 文字、4px 圓角）、ghost／文字按鈕——全部 hover 時閃現 `#F54E00` 橘色文字」
- 「設計輸入欄位：`#eeefe9` 背景、1px `#b6b7af` 邊框、4px 圓角、`#9ea096` placeholder、focus ring `#3b82f6` 50% 不透明度」

### 迭代指南
精修此設計系統生成的畫面時：
1. 確認背景是暖羊皮紙（`#fdfdf8`）而非純白——鼠尾草米色的溫度是必要的
2. 檢查所有文字使用橄欖系（`#4d4f46`、`#23251d`），而非純黑或中性灰
3. 確保 hover 狀態閃現 PostHog Orange（`#F54E00`）——若 hover 感覺平淡就是少了它
4. 確認邊框是鼠尾草色調的灰（`#bfc1b7`）而非中性灰——溫度貫穿每個元素
5. 整體調性要像有趣、克難的新創 wiki——絕不是企業精緻或冰冷
