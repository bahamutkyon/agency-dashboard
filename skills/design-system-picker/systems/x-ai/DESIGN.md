# 取自 xAI 的設計系統

> 分類：AI & LLM
> Elon Musk 的 AI 實驗室。冷峻單色、未來感極簡。

## 1. 視覺主題與氛圍

xAI 的網站是一堂深色優先、monospace 主導的粗野極簡主義大師課——一個感覺是工程師做的、骨子裡懂「克制是最終極致」的設計系統。整個體驗錨定在一個接近黑的背景（`#1f2228`）配純白文字（`#ffffff`），形成高對比、終端機氣息的美學，直接放送深厚技術可信度。沒有漸層、沒有裝飾插畫、沒有彩色點綴在搶戲。這是一個透過「缺席」溝通的網站。

字型系統由兩款慎選的字體分擔。`GeistMono`（Vercel 的 monospace 字體）負責 Display 級標題，做到誇張的 320px 字重 300，同時也是按鈕字體（大寫加 1.4px 拉開的字距）。`universalSans` 處理所有內文和次要標題，是乾淨的幾何 sans-serif 嗓音。把 monospace 當 Display 用，是定義整個美學的關鍵決定——這把 xAI 定位成基礎建設、定位成「住在 terminal 裡的人」做的東西，而不是消費產品。

間距系統建立在 8px 基礎網格上，數值集中在小端（4px、8px、24px、48px），反映出緊湊、資訊優先的版面哲學。border-radius 極少——網站幾乎不對任何東西做圓角，維持銳利、建築感的邊。沒有裝飾陰影、沒有漸層、沒有堆疊層次。深度只靠對比和留白傳達。

**關鍵特徵：**
- 純深色主題：`#1f2228` 背景配 `#ffffff` 文字——沒有中間灰色地帶
- GeistMono 用在極端 Display 尺寸（320px、字重 300）——monospace 作為奢華
- 大寫 monospace 按鈕，字距 1.4px——技術感、命令感
- universalSans 內文 16px/1.5、標題 30px/1.2——乾淨對比
- 零裝飾元素：沒有陰影、沒有漸層、沒有彩色點綴
- 8px 間距網格，級距稀疏、刻意
- Heroicons SVG 圖示系統——極簡、功能性
- Tailwind CSS 含 arbitrary values——utility-first 的工程做法

## 2. 配色系統與角色

### 主色
- **Pure White**（`#ffffff`）：唯一的文字色、連結色和所有前景元素。在 xAI 系統裡，白色不是背景——是嗓音。
- **Dark Background**（`#1f2228`）：畫布。帶細微藍底色的暖近黑（不是純黑、不是中性灰）。這個特定色相避開了 `#000000` 對眼睛的刺激，又保留了深沉感。

### 互動色
- **White Default**（`#ffffff`）：預設狀態下的連結和互動元素色。
- **White Muted**（`rgba(255, 255, 255, 0.5)`）：連結 hover 狀態——刻意變暗而不是變亮，這做法很罕見、很有辨識度。
- **White Subtle**（`rgba(255, 255, 255, 0.2)`）：邊框、分隔線、細微表面處理。
- **Ring Blue**（`rgb(59, 130, 246) / 0.5`）：Tailwind 預設 focus ring 色（`--tw-ring-color`），用於鍵盤無障礙 focus 狀態。

### 表面與邊框
- **Surface Elevated**（`rgba(255, 255, 255, 0.05)`）：細微卡片背景和 hover 表面——幾乎看不見的浮起。
- **Surface Hover**（`rgba(255, 255, 255, 0.08)`）：略明顯的互動容器 hover 狀態。
- **Border Default**（`rgba(255, 255, 255, 0.1)`）：卡片、分隔線、容器的標準邊框。
- **Border Strong**（`rgba(255, 255, 255, 0.2)`）：active 狀態和按鈕輪廓用的強調邊框。

### 功能色
- **Text Primary**（`#ffffff`）：所有標題、內文、標籤。
- **Text Secondary**（`rgba(255, 255, 255, 0.7)`）：描述、caption、輔助文字。
- **Text Tertiary**（`rgba(255, 255, 255, 0.5)`）：弱化標籤、placeholder、時間戳。
- **Text Quaternary**（`rgba(255, 255, 255, 0.3)`）：disabled 文字、極細微註記。

## 3. 字型系統

### 字型家族
- **Display / 按鈕**：`GeistMono`，fallback：`ui-monospace, SFMono-Regular, Roboto Mono, Menlo, Monaco, Liberation Mono, DejaVu Sans Mono, Courier New`
- **內文 / 標題**：`universalSans`，fallback：`universalSans Fallback`

### 層級

| 角色 | 字型 | 大小 | 字重 | 行高 | 字距 | Transform | 說明 |
|------|------|------|------|------|------|-----------|------|
| Display Hero | GeistMono | 320px (20rem) | 300 | 1.50 | normal | none | 極端尺寸，monospace 作為奢華 |
| Section Heading | universalSans | 30px (1.88rem) | 400 | 1.20（緊） | normal | none | 乾淨 sans-serif 對比 |
| Body | universalSans | 16px (1rem) | 400 | 1.50 | normal | none | 標準閱讀文字 |
| Button | GeistMono | 14px (0.88rem) | 400 | 1.43 | 1.4px | uppercase | 拉開字距的 monospace，命令感 |
| Label / Caption | universalSans | 14px (0.88rem) | 400 | 1.50 | normal | none | 輔助文字 |
| Small / Meta | universalSans | 12px (0.75rem) | 400 | 1.50 | normal | none | 時間戳、註腳 |

### 原則
- **monospace 當 Display**：GeistMono 在 320px 不是噱頭——是品牌宣言。等寬字在極端尺寸下做出有節奏感、建築感的質地，沒有任何比例字型能達到。
- **大尺寸用細字重**：320px 標題用字重 300，避免 monospace 在極端尺寸下變得笨重粗暴。讀起來是精準，而不是壓迫。
- **大寫按鈕**：所有按鈕文字都是大寫 GeistMono 加 1.4px 字距。這讓互動元素帶有明顯的技術、近乎命令列的美學。
- **sans-serif 用於閱讀**：universalSans 在 16px/1.5 提供優秀的內文可讀性，和 monospace 的 Display 元素形成乾淨對比。
- **雙字型的清晰分工**：系統剛好用兩款字體，角色分明——monospace 給衝擊力和互動，sans-serif 給資訊和閱讀。沒有重疊、沒有模糊。

## 4. 元件樣式

### 按鈕

**Primary（白底深字）**
- 背景：`#ffffff`
- 文字：`#1f2228`
- Padding：12px 24px
- 圓角：0px（銳角）
- 字型：GeistMono 14px 字重 400、大寫、字距 1.4px
- Hover：背景 `rgba(255, 255, 255, 0.9)`
- 用途：主要 CTA（「TRY GROK」「GET STARTED」）

**Ghost / 描邊**
- 背景：透明
- 文字：`#ffffff`
- Padding：12px 24px
- 圓角：0px
- Border：`1px solid rgba(255, 255, 255, 0.2)`
- 字型：GeistMono 14px 字重 400、大寫、字距 1.4px
- Hover：背景 `rgba(255, 255, 255, 0.05)`
- 用途：次要操作（「LEARN MORE」「VIEW API」）

**文字連結**
- 背景：無
- 文字：`#ffffff`
- 字型：universalSans 16px 字重 400
- Hover：`rgba(255, 255, 255, 0.5)`——hover 時變暗
- 用途：行內連結、導覽項

### 卡片與容器
- 背景：`rgba(255, 255, 255, 0.03)` 或透明
- Border：`1px solid rgba(255, 255, 255, 0.1)`
- 圓角：0px（銳）或 4px（微圓）
- 陰影：無——xAI 不用 box shadow
- Hover：border 切到 `rgba(255, 255, 255, 0.2)`

### 導覽
- 深色背景對應頁面（`#1f2228`）
- 品牌文字標：白色，左對齊
- 連結：universalSans 14px 字重 400、`#ffffff` 文字
- Hover：文字色 `rgba(255, 255, 255, 0.5)`
- CTA：白色主要按鈕，右對齊
- Mobile：漢堡選單切換

### 徽章 / Tags
**Monospace Tag**
- 背景：透明
- 文字：`#ffffff`
- Padding：4px 8px
- Border：`1px solid rgba(255, 255, 255, 0.2)`
- 圓角：0px
- 字型：GeistMono 12px 大寫、字距 1px

### 輸入與表單
- 背景：透明或 `rgba(255, 255, 255, 0.05)`
- Border：`1px solid rgba(255, 255, 255, 0.2)`
- 圓角：0px
- Focus：ring 用 `rgb(59, 130, 246) / 0.5`
- 文字：`#ffffff`
- Placeholder：`rgba(255, 255, 255, 0.3)`
- 標籤：`rgba(255, 255, 255, 0.7)`、universalSans 14px

## 5. 版面原則

### 間距系統
- 基本單位：8px
- 級距：4px、8px、24px、48px
- 級距刻意稀疏——xAI 避開細微的間距區分，偏好大跳躍，純靠留白拉出視覺階層

### 網格與容器
- 內容最大寬度：約 1200px
- Hero：全視窗高度，超大置中 monospace 標題
- 特色章節：簡單垂直堆疊，章節 padding 寬鬆（48px-96px）
- Desktop 上特色描述用兩欄版面
- 全寬深色章節，整頁維持單一深色背景

### 留白哲學
- **極致大方**：xAI 用大量留白。320px 標題配 48px+ 周圍 padding 做出的空無感本身就是設計宣言——內容重要到需要空間呼吸。
- **垂直節奏勝過水平密度**：內容垂直堆疊，章節之間留大間隙，而不是水平塞滿。這做出的是 scroll 驅動的體驗，感覺刻意、有電影感。
- **沒有視覺噪音**：沒有裝飾元素、章節之間沒有邊框、沒有色彩變化，留白成為主要的結構工具。

### 斷點
- 2000px、1536px、1280px、1024px、1000px、768px、640px
- Tailwind 響應式修飾子驅動斷點行為

### 圓角級距
- 銳利（0px）：按鈕、卡片、輸入框的主要處理——預設
- 微圓（4px）：偶爾為次要容器加點柔軟
- 接近零圓角的哲學是品牌粗野身分的核心

## 6. 深度與層次

| 層級 | 處理 | 用途 |
|------|------|------|
| Flat (Level 0) | 無陰影、無 border | 頁面背景、內文 |
| Surface (Level 1) | `rgba(255,255,255,0.03)` 背景 | 細微卡片表面 |
| Bordered (Level 2) | `1px solid rgba(255,255,255,0.1)` border | 卡片、容器、分隔線 |
| Active (Level 3) | `1px solid rgba(255,255,255,0.2)` border | hover 狀態、active 元素 |
| Focus（無障礙） | `ring` 用 `rgb(59,130,246)/0.5` | 鍵盤 focus 指示器 |

**層次哲學**：xAI 完全拒絕傳統的陰影層次系統。整個網站沒有 box-shadow。深度透過三種機制傳達：(1) 透明度導向的邊框會在互動時變亮，做出元素「啟動」而非「浮起」的感覺；(2) 極細微的背景透明度切換（`0.03` 到 `0.08`）做出幾乎察覺不到的表面區隔；(3) 320px Display 字級和 16px 內文之間的巨大尺寸對比，做出字型上的深度。這是靠對比和透明度的層次，不是模擬光影。

## 7. Do's 與 Don'ts

### Do
- 通用背景用 `#1f2228`——絕不用純黑 `#000000`
- 所有 Display 標題和按鈕文字用 GeistMono——monospace 就是品牌
- 所有按鈕標籤套大寫 + 1.4px 字距
- 巨大 Display 標題（320px）用字重 300
- 邊框維持 `rgba(255, 255, 255, 0.1)`——幾乎看不見，但不是沒有
- 互動元素 hover 時變暗到 `rgba(255, 255, 255, 0.5)`——和慣例相反
- 預設維持銳角（0px 圓角）——粗野的精準
- 所有內文和閱讀文字用 universalSans，16px/1.5

### Don't
- 不要用 box-shadow——xAI 沒有任何陰影層次
- 不要在白與深色背景之外引入彩色點綴——單色色盤神聖不可侵犯
- 不要用大圓角（8px+、膠囊形）——銳邊是刻意的
- 標題不要用粗體（600-700）——只用 300-400
- hover 時不要讓元素變亮——xAI 是變暗到 0.5
- 不要加裝飾漸層、插畫、色塊
- 按鈕不要用比例字型——GeistMono 大寫是強制
- 非必要時不要用彩色狀態指示——一切都維持在白/深色光譜內

## 8. RWD 行為

### 斷點
| 名稱 | 寬度 | 主要變化 |
|------|------|----------|
| Mobile | <640px | 單欄、hero 標題大幅縮小 |
| Small Tablet | 640-768px | padding 略增 |
| Tablet | 768-1024px | 開始兩欄版面、標題尺寸增加 |
| Desktop | 1024-1280px | 完整版面、寬鬆留白 |
| Large | 1280-1536px | 容器更寬、更多呼吸空間 |
| Extra Large | 1536-2000px | 最大內容寬度、置中 |
| Ultra | >2000px | 內容保持置中、邊距極大 |

### 觸控目標
- 按鈕用 12px 24px padding，舒適觸控
- 導覽連結間距 24px
- 最小觸控目標：44px 高
- Mobile：全寬按鈕方便拇指操作

### 收合策略
- Hero：320px monospace 標題大幅縮小（mobile 上約 48px-64px）
- 導覽：水平連結收成漢堡選單
- 特色章節：兩欄 → 單欄堆疊
- 章節 padding：96px → 48px → 24px 跨斷點變化
- 巨大 Display 字級最先縮放——必須維持衝擊力又不能溢出

### 圖片行為
- 圖像極少——網站靠字型和留白
- 任何產品截圖維持銳角
- 全寬媒體按視窗等比縮放

## 9. Agent Prompt 指南

### 快速色票
- 背景：Dark（`#1f2228`）
- 主要文字：White（`#ffffff`）
- 次要文字：White 70%（`rgba(255, 255, 255, 0.7)`）
- 弱化文字：White 50%（`rgba(255, 255, 255, 0.5)`）
- Disabled 文字：White 30%（`rgba(255, 255, 255, 0.3)`）
- 預設邊框：White 10%（`rgba(255, 255, 255, 0.1)`）
- 強邊框：White 20%（`rgba(255, 255, 255, 0.2)`）
- 細微表面：White 3%（`rgba(255, 255, 255, 0.03)`）
- Hover 表面：White 8%（`rgba(255, 255, 255, 0.08)`）
- Focus Ring：Blue（`rgb(59, 130, 246)` 50% opacity）
- 主按鈕背景：White（`#ffffff`），文字 Dark（`#1f2228`）

### 元件 prompt 範例
- 「在 #1f2228 背景上建立 hero 章節。標題用 GeistMono 72px 字重 300，色 #ffffff，置中。副標用 universalSans 18px 字重 400，色 rgba(255,255,255,0.7)，max-width 600px 置中。兩顆按鈕：主要按鈕（白底、#1f2228 文字、0px 圓角、GeistMono 14px 大寫、字距 1.4px、padding 12px 24px）和 ghost（透明底、1px solid rgba(255,255,255,0.2)、白色文字、同樣字型處理）。」
- 「設計一張卡片：透明或 rgba(255,255,255,0.03) 背景、1px solid rgba(255,255,255,0.1) 邊框、0px 圓角、24px padding。無陰影。標題用 universalSans 22px 字重 400，#ffffff。內文用 universalSans 16px 字重 400，rgba(255,255,255,0.7)，行高 1.5。Hover：邊框切到 rgba(255,255,255,0.2)。」
- 「做導覽：#1f2228 背景，全寬。品牌文字在左（GeistMono 14px 大寫）。連結用 universalSans 14px #ffffff，hover 切到 rgba(255,255,255,0.5)。白色主按鈕右對齊（GeistMono 14px 大寫、字距 1.4px）。」
- 「做一個表單：深色背景 #1f2228。標籤用 universalSans 14px rgba(255,255,255,0.7)。輸入框透明底、1px solid rgba(255,255,255,0.2) 邊框、0px 圓角、白色文字 16px universalSans。Focus：藍色 ring rgb(59,130,246)/0.5。Placeholder：rgba(255,255,255,0.3)。」
- 「設計一個 monospace tag/徽章：透明底、1px solid rgba(255,255,255,0.2)、0px 圓角、GeistMono 12px 大寫、字距 1px、白色文字、padding 4px 8px。」

### 迭代指南
1. 永遠從 `#1f2228` 背景開始——絕不用純黑或灰色背景
2. Display 和按鈕用 GeistMono，其餘用 universalSans——這兩個角色絕不交換
3. 所有按鈕必須是 GeistMono 大寫 + 字距 1.4px——不可妥協
4. 永遠沒有陰影——深度只靠邊框透明度和背景透明度
5. 邊框永遠是低透明度白（預設 0.1、強調 0.2）
6. Hover 行為是變暗到 0.5 透明度，而不是變亮——和多數系統相反
7. 預設銳角（0px）——只有特定次要容器才用 4px
8. 內文 16px universalSans，行高 1.5，舒適閱讀
9. 章節 padding 寬鬆（48px-96px）——讓內容在黑暗裡呼吸
10. 白配深的單色色盤是絕對——除非功能必要，否則別加色
