# 取自 Linear 的設計系統

> 分類：Productivity & SaaS
> 專案管理。極致極簡、精準、紫色點綴。

## 1. 視覺主題與氛圍

Linear 的網站是「深色模式優先」產品設計的大師示範——一塊近黑畫布（`#08090a`），內容從黑暗裡像星光那樣浮現。整體印象是極端精準的工程感：每個元素都活在仔細校準過的亮度階層裡，從幾乎看不見的邊框（`rgba(255,255,255,0.05)`）到柔軟、會發光的文字（`#f7f8f8`）。這不是把亮色設計貼上深色主題——而是「黑暗作為原生媒介」，靠白色透明度的細微階梯而不是色彩變化來管理資訊密度。

字型系統完全建立在 Inter Variable 上，全域啟用 OpenType 特性 `"cv01"` 和 `"ss03"`，讓字體更乾淨、更幾何。Inter 用在極大的字重範圍——從 300（淺內文）到 510（medium，Linear 的招牌字重）到 590（強調 semibold）。510 字重特別有辨識度：它在 regular 和 medium 之間，做出不會大聲嚷嚷的細微強調。在 Display 尺寸（72px、64px、48px），Inter 用激進負字距（-1.584px 到 -1.056px），做出感覺被工程化而非設計過的壓縮、權威標題。Berkeley Mono 擔任 monospace 搭擋，給程式碼和技術標籤用，fallback 到 ui-monospace、SF Mono、Menlo。

色彩系統幾乎全是無彩——深底配白／灰文字——只用單一品牌點綴調味：Linear 招牌的靛紫（`#5e6ad2` 背景、`#7170ff` 互動點綴）。這個點綴色用得克制、刻意，只出現在 CTA、active 狀態、品牌元素。邊框系統用極細、半透明的白邊（`rgba(255,255,255,0.05)` 到 `rgba(255,255,255,0.08)`），做出結構卻不帶視覺噪音，像月光下畫的線框。

**關鍵特徵：**
- 深色模式原生：`#08090a` 行銷背景、`#0f1011` 面板背景、`#191a1b` 浮起表面
- Inter Variable 全域啟用 `"cv01", "ss03"`——幾何替代字形，更乾淨
- 招牌字重 510（regular 和 medium 之間）用在多數 UI 文字
- Display 尺寸用激進負字距（72px 時 -1.584px、48px 時 -1.056px）
- 品牌靛紫：`#5e6ad2`（背景）/ `#7170ff`（點綴）/ `#828fff`（hover）——系統唯一的彩色
- 通篇半透明白邊：`rgba(255,255,255,0.05)` 到 `rgba(255,255,255,0.08)`
- 按鈕背景接近零不透明度：`rgba(255,255,255,0.02)` 到 `rgba(255,255,255,0.05)`
- 多層陰影含 inset 變體，給深色表面做出深度
- Radix UI primitives 是元件基礎（偵測到 6 個 primitives）
- 成功綠（`#27a644`、`#10b981`）只用在狀態指示

## 2. 配色系統與角色

### 背景表面
- **Marketing Black**（`#010102` / `#08090a`）：最深的背景——hero 章節和行銷頁的畫布。近純黑，帶幾乎察覺不到的冷藍底色。
- **Panel Dark**（`#0f1011`）：側邊欄和面板背景。比 marketing black 高一階。
- **Level 3 Surface**（`#191a1b`）：浮起表面、卡片背景、dropdown。
- **Secondary Surface**（`#28282c`）：最淺的深色表面——用於 hover 狀態和略浮起元件。

### 文字與內容
- **Primary Text**（`#f7f8f8`）：近白，帶剛察覺得到的暖度。預設文字色——不是純白，避免深底刺眼。
- **Secondary Text**（`#d0d6e0`）：冷銀灰，給內文、描述、次要內容。
- **Tertiary Text**（`#8a8f98`）：弱化灰，給 placeholder、metadata、減弱內容。
- **Quaternary Text**（`#62666d`）：最低調的文字——時間戳、disabled 狀態、細微標籤。

### 品牌與點綴
- **Brand Indigo**（`#5e6ad2`）：主要品牌色——用於 CTA 按鈕背景、品牌標誌、關鍵互動表面。
- **Accent Violet**（`#7170ff`）：互動元素的較亮變體——連結、active 狀態、已選項目。
- **Accent Hover**（`#828fff`）：點綴元素的 hover 狀態，較淺、較飽和的變體。
- **Security Lavender**（`#7a7fad`）：弱化靛紫，專門用在安全相關的 UI 元素。

### 狀態色
- **Green**（`#27a644`）：主要成功/active 狀態。用於「進行中」指示。
- **Emerald**（`#10b981`）：次要成功——膠囊徽章、完成狀態。

### 邊框與分隔
- **Border Primary**（`#23252a`）：明顯分隔用的實線深邊框。
- **Border Secondary**（`#34343a`）：略淺的實線邊框。
- **Border Tertiary**（`#3e3e44`）：最淺的實線邊框變體。
- **Border Subtle**（`rgba(255,255,255,0.05)`）：極細微的半透明邊框——預設。
- **Border Standard**（`rgba(255,255,255,0.08)`）：卡片、輸入框、程式碼區塊的標準半透明邊框。
- **Line Tint**（`#141516`）：幾乎看不見的線，給最細微的分隔。
- **Line Tertiary**（`#18191a`）：略明顯一點的分隔線。

### 亮色模式中性色（給亮色主題情境）
- **Light Background**（`#f7f8f8`）：亮色模式頁面背景。
- **Light Surface**（`#f3f4f5` / `#f5f6f7`）：細微表面染色。
- **Light Border**（`#d0d6e0`）：亮色情境的可見邊框。
- **Light Border Alt**（`#e6e6e6`）：替代的淺色邊框。
- **Pure White**（`#ffffff`）：卡片表面、高光。

### 覆蓋
- **Overlay Primary**（`rgba(0,0,0,0.85)`）：modal/dialog 背幕——非常深，讓焦點隔離。

## 3. 字型系統

### 字型家族
- **主要**：`Inter Variable`，fallback：`SF Pro Display, -apple-system, system-ui, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Open Sans, Helvetica Neue`
- **Monospace**：`Berkeley Mono`，fallback：`ui-monospace, SF Mono, Menlo`
- **OpenType 特性**：全域啟用 `"cv01", "ss03"`——cv01 提供替代小寫 'a'（單層樓設計），ss03 調整特定字形，做出更乾淨幾何的外觀。

### 層級

| 角色 | 字型 | 大小 | 字重 | 行高 | 字距 | 說明 |
|------|------|------|------|------|------|------|
| Display XL | Inter Variable | 72px (4.50rem) | 510 | 1.00（緊） | -1.584px | Hero 標題、最大衝擊力 |
| Display Large | Inter Variable | 64px (4.00rem) | 510 | 1.00（緊） | -1.408px | 次要 hero 文字 |
| Display | Inter Variable | 48px (3.00rem) | 510 | 1.00（緊） | -1.056px | 章節標題 |
| Heading 1 | Inter Variable | 32px (2.00rem) | 400 | 1.13（緊） | -0.704px | 主章節標題 |
| Heading 2 | Inter Variable | 24px (1.50rem) | 400 | 1.33 | -0.288px | 子章節標題 |
| Heading 3 | Inter Variable | 20px (1.25rem) | 590 | 1.33 | -0.24px | 特色標題、卡片 header |
| Body Large | Inter Variable | 18px (1.13rem) | 400 | 1.60（寬） | -0.165px | 引言、特色描述 |
| Body Emphasis | Inter Variable | 17px (1.06rem) | 590 | 1.60（寬） | normal | 強調內文、內文中的子標題 |
| Body | Inter Variable | 16px (1.00rem) | 400 | 1.50 | normal | 標準閱讀文字 |
| Body Medium | Inter Variable | 16px (1.00rem) | 510 | 1.50 | normal | 導覽、標籤 |
| Body Semibold | Inter Variable | 16px (1.00rem) | 590 | 1.50 | normal | 強強調 |
| Small | Inter Variable | 15px (0.94rem) | 400 | 1.60（寬） | -0.165px | 次要內文 |
| Small Medium | Inter Variable | 15px (0.94rem) | 510 | 1.60（寬） | -0.165px | 強調小文字 |
| Small Semibold | Inter Variable | 15px (0.94rem) | 590 | 1.60（寬） | -0.165px | 強小文字 |
| Small Light | Inter Variable | 15px (0.94rem) | 300 | 1.47 | -0.165px | 減弱內文 |
| Caption Large | Inter Variable | 14px (0.88rem) | 510–590 | 1.50 | -0.182px | 子標籤、分類 header |
| Caption | Inter Variable | 13px (0.81rem) | 400–510 | 1.50 | -0.13px | metadata、時間戳 |
| Label | Inter Variable | 12px (0.75rem) | 400–590 | 1.40 | normal | 按鈕文字、小標籤 |
| Micro | Inter Variable | 11px (0.69rem) | 510 | 1.40 | normal | 極小標籤 |
| Tiny | Inter Variable | 10px (0.63rem) | 400–510 | 1.50 | -0.15px | 上標籤文字，有時大寫 |
| Link Large | Inter Variable | 16px (1.00rem) | 400 | 1.50 | normal | 標準連結 |
| Link Medium | Inter Variable | 15px (0.94rem) | 510 | 2.67 | normal | 行高拉開的導覽連結 |
| Link Small | Inter Variable | 14px (0.88rem) | 510 | 1.50 | normal | 緊湊連結 |
| Link Caption | Inter Variable | 13px (0.81rem) | 400–510 | 1.50 | -0.13px | 頁尾、metadata 連結 |
| Mono Body | Berkeley Mono | 14px (0.88rem) | 400 | 1.50 | normal | 程式碼區塊 |
| Mono Caption | Berkeley Mono | 13px (0.81rem) | 400 | 1.50 | normal | 程式碼標籤 |
| Mono Label | Berkeley Mono | 12px (0.75rem) | 400 | 1.40 | normal | 程式碼 metadata，有時大寫 |

### 原則
- **510 是招牌字重**：Linear 用 Inter Variable 的 510 字重（在 regular 400 和 medium 500 之間）作為預設強調字重。做出細微「加粗」的感覺，又沒有傳統 medium 或 semibold 的重量。
- **大尺寸壓縮**：Display 尺寸用漸進變緊的字距——72px 時 -1.584px、64px 時 -1.408px、48px 時 -1.056px、32px 時 -0.704px。24px 以下字距放鬆回 normal。
- **OpenType 即身分**：`"cv01", "ss03"` 不是裝飾——它們把 Inter 變成 Linear 那款獨特的字體，給它更幾何、更有目的的個性。
- **三階字重系統**：400（閱讀）、510（強調/UI）、590（強強調）。300 字重只出現在刻意減弱的情境。

## 4. 元件樣式

### 按鈕

**Ghost Button（預設）**
- 背景：`rgba(255,255,255,0.02)`
- 文字：`#e2e4e7`（近白）
- Padding：舒適
- 圓角：6px
- Border：`1px solid rgb(36, 40, 44)`
- 輪廓：無
- Focus 陰影：`rgba(0,0,0,0.1) 0px 4px 12px`
- 用途：標準操作、次要 CTA

**Subtle Button**
- 背景：`rgba(255,255,255,0.04)`
- 文字：`#d0d6e0`（銀灰）
- Padding：0px 6px
- 圓角：6px
- 用途：工具列操作、情境按鈕

**Primary Brand Button（推測）**
- 背景：`#5e6ad2`（品牌靛紫）
- 文字：`#ffffff`
- Padding：8px 16px
- 圓角：6px
- Hover：切到 `#828fff`
- 用途：主 CTA（「Start building」「Sign up」）

**Icon Button（圓形）**
- 背景：`rgba(255,255,255,0.03)` 或 `rgba(255,255,255,0.05)`
- 文字：`#f7f8f8` 或 `#ffffff`
- 圓角：50%
- Border：`1px solid rgba(255,255,255,0.08)`
- 用途：關閉、選單切換、只有 icon 的操作

**Pill Button**
- 背景：透明
- 文字：`#d0d6e0`
- Padding：0px 10px 0px 5px
- 圓角：9999px
- Border：`1px solid rgb(35, 37, 42)`
- 用途：篩選 chip、tag、狀態指示

**小型工具列按鈕**
- 背景：`rgba(255,255,255,0.05)`
- 文字：`#62666d`（弱化）
- 圓角：2px
- Border：`1px solid rgba(255,255,255,0.05)`
- 陰影：`rgba(0,0,0,0.03) 0px 1.2px 0px 0px`
- 字型：12px 字重 510
- 用途：工具列操作、快速存取控制

### 卡片與容器
- 背景：`rgba(255,255,255,0.02)` 到 `rgba(255,255,255,0.05)`（絕不純色——永遠半透明）
- Border：`1px solid rgba(255,255,255,0.08)`（標準）或 `1px solid rgba(255,255,255,0.05)`（細微）
- 圓角：8px（標準）、12px（強調）、22px（大型面板）
- 陰影：`rgba(0,0,0,0.2) 0px 0px 0px 1px` 或多層陰影堆疊
- Hover：背景透明度微微上升

### 輸入與表單

**Text Area**
- 背景：`rgba(255,255,255,0.02)`
- 文字：`#d0d6e0`
- Border：`1px solid rgba(255,255,255,0.08)`
- Padding：12px 14px
- 圓角：6px

**搜尋輸入**
- 背景：透明
- 文字：`#f7f8f8`
- Padding：1px 32px（保留 icon 空間）

**Button-style Input**
- 文字：`#8a8f98`
- Padding：1px 6px
- 圓角：5px
- Focus 陰影：多層堆疊

### 徽章與膠囊

**Success Pill**
- 背景：`#10b981`
- 文字：`#f7f8f8`
- 圓角：50%（圓形）
- 字型：10px 字重 510
- 用途：狀態點、完成指示

**Neutral Pill**
- 背景：透明
- 文字：`#d0d6e0`
- Padding：0px 10px 0px 5px
- 圓角：9999px
- Border：`1px solid rgb(35, 37, 42)`
- 字型：12px 字重 510
- 用途：tag、篩選 chip、分類標籤

**Subtle Badge**
- 背景：`rgba(255,255,255,0.05)`
- 文字：`#f7f8f8`
- Padding：0px 8px 0px 2px
- 圓角：2px
- Border：`1px solid rgba(255,255,255,0.05)`
- 字型：10px 字重 510
- 用途：行內標籤、版本 tag

### 導覽
- 近黑背景上的深色 sticky header
- Linear logomark 左對齊（SVG icon）
- 連結：Inter Variable 13–14px 字重 510、`#d0d6e0` 文字
- Active/hover：文字變亮到 `#f7f8f8`
- CTA：品牌靛紫按鈕或 ghost 按鈕
- Mobile：漢堡收合
- 搜尋：command palette 觸發（`/` 或 `Cmd+K`）

### 圖片處理
- 深底上的產品截圖配細微邊框（`rgba(255,255,255,0.08)`）
- 頂部圓角圖片：`12px 12px 0px 0px` 圓角
- Dashboard/issue 預覽主導特色章節
- 截圖下方有細微陰影：`rgba(0,0,0,0.4) 0px 2px 4px`

## 5. 版面原則

### 間距系統
- 基本單位：8px
- 級距：1px、4px、7px、8px、11px、12px、16px、19px、20px、22px、24px、28px、32px、35px
- 7px 和 11px 暗示視覺對齊用的微調
- 主要節奏：8px、16px、24px、32px（標準 8px 網格）

### 網格與容器
- 內容最大寬度：約 1200px
- Hero：置中單欄，垂直 padding 寬鬆
- 特色章節：特色卡片用 2–3 欄網格
- 全寬深色章節，內部 max-width 限制
- Changelog：單欄 timeline 版面

### 留白哲學
- **黑暗即空間**：在 Linear 的深色畫布上，空白不是白色——是「不存在」。近黑背景就是留白本身，內容從中浮現。
- **壓縮標題、開放四周**：72px 配 -1.584px 字距的 Display 文字是密的、壓縮的，但坐在大片深色 padding 裡。字型密度和空間大方的對比製造張力。
- **章節隔離**：每個特色章節用寬鬆垂直 padding（80px+）隔開，沒有可見分隔線——深色背景提供自然分隔。

### 圓角級距
- 微（2px）：行內徽章、工具列按鈕、細微 tag
- 標準（4px）：小容器、列表項
- 舒適（6px）：按鈕、輸入、功能元素
- 卡片（8px）：卡片、dropdown、popover
- 面板（12px）：面板、強調卡片、章節容器
- 大（22px）：大型面板元素
- 完全膠囊（9999px）：chip、篩選膠囊、狀態 tag
- 圓形（50%）：icon 按鈕、頭像、狀態點

## 6. 深度與層次

| 層級 | 處理 | 用途 |
|------|------|------|
| Flat (Level 0) | 無陰影、`#010102` 背景 | 頁面背景、最深畫布 |
| Subtle (Level 1) | `rgba(0,0,0,0.03) 0px 1.2px 0px` | 工具列按鈕、微浮起 |
| Surface (Level 2) | `rgba(255,255,255,0.05)` 背景 + `1px solid rgba(255,255,255,0.08)` 邊框 | 卡片、輸入欄位、容器 |
| Inset (Level 2b) | `rgba(0,0,0,0.2) 0px 0px 12px 0px inset` | 內凹面板、內陰影 |
| Ring (Level 3) | `rgba(0,0,0,0.2) 0px 0px 0px 1px` | border-as-shadow 手法 |
| Elevated (Level 4) | `rgba(0,0,0,0.4) 0px 2px 4px` | 浮動元素、dropdown |
| Dialog (Level 5) | 多層堆疊：`rgba(0,0,0,0) 0px 8px 2px, rgba(0,0,0,0.01) 0px 5px 2px, rgba(0,0,0,0.04) 0px 3px 2px, rgba(0,0,0,0.07) 0px 1px 1px, rgba(0,0,0,0.08) 0px 0px 1px` | popover、command palette、modal |
| Focus | `rgba(0,0,0,0.1) 0px 4px 12px` + 額外層 | 互動元素的鍵盤 focus |

**陰影哲學**：在深色表面上，傳統陰影（深上加深）幾乎看不見。Linear 用半透明白邊作為主要深度指示來解決。層次不靠陰影深度傳達，而靠背景亮度階梯——每一層級略微提高表面背景的白色不透明度（`0.02` → `0.04` → `0.05`），做出細微堆疊效果。inset 陰影手法（`rgba(0,0,0,0.2) 0px 0px 12px 0px inset`）為內凹面板做出獨特的「沉下去」效果，補上傳統深色主題缺少的維度感。

## 7. Do's 與 Don'ts

### Do
- 所有文字啟用 Inter Variable 的 `"cv01", "ss03"`——這些特性是 Linear 字體身分的根本
- 預設強調字重用 510——這是 Linear 招牌的中間字重
- Display 尺寸套激進負字距（72px 時 -1.584px、48px 時 -1.056px）
- 建立在近黑背景上：行銷用 `#08090a`、面板用 `#0f1011`、浮起表面用 `#191a1b`
- 用半透明白邊（`rgba(255,255,255,0.05)` 到 `rgba(255,255,255,0.08)`），不要用實線深邊
- 按鈕背景維持近透明：`rgba(255,255,255,0.02)` 到 `rgba(255,255,255,0.05)`
- 品牌靛紫（`#5e6ad2` / `#7170ff`）只留給主 CTA 和互動點綴
- 主要文字用 `#f7f8f8`——不是純 `#ffffff`，太刺眼
- 套用亮度堆疊模型：越深 = 越暗背景、越浮起 = 略亮背景

### Don't
- 主要文字不要用純白（`#ffffff`）——`#f7f8f8` 才不刺眼
- 按鈕不要用純色背景——透明度才是系統（rgba 白 0.02–0.05）
- 不要把品牌靛紫當裝飾用——只留給互動/CTA 元素
- Display 文字不要用正字距——大尺寸 Inter 永遠跑負
- 深色背景上不要用可見/不透明邊框——邊框該是 whisper 細的半透明白
- 不要省略 OpenType 特性（`"cv01", "ss03"`）——沒有這些，就只是通用 Inter，不是 Linear 的 Inter
- 不要用字重 700（bold）——Linear 最高 590，510 是主力
- UI chrome 不要引入暖色——色盤是冷灰配藍紫點綴
- 深色表面上不要用 drop shadow 做層次——改用背景亮度堆疊

## 8. RWD 行為

### 斷點
| 名稱 | 寬度 | 主要變化 |
|------|------|----------|
| Mobile Small | <600px | 單欄、緊湊 padding |
| Mobile | 600–640px | 標準 mobile 版面 |
| Tablet | 640–768px | 2 欄網格開始 |
| Desktop Small | 768–1024px | 完整卡片網格、padding 擴展 |
| Desktop | 1024–1280px | 標準 desktop、完整導覽 |
| Large Desktop | >1280px | 完整版面、邊距寬鬆 |

### 觸控目標
- 按鈕用舒適 padding、最小 6px 圓角
- 導覽連結 13–14px、間距足夠
- 膠囊 tag 水平 padding 10px，方便觸控
- Icon 按鈕 50% 圓角確保圓形、好點
- 搜尋觸發位置顯眼、點擊區寬鬆

### 收合策略
- Hero：Display 文字 72px → 48px → 32px，字距按比例調整
- 導覽：水平連結 + CTA → 768px 漢堡選單
- 特色卡片：3 欄 → 2 欄 → 單欄堆疊
- 產品截圖：維持長寬比，可能縮 padding
- Changelog：timeline 各尺寸維持單欄
- 頁尾：多欄 → 堆疊單欄
- 章節間距：80px+ → mobile 48px

### 圖片行為
- Dashboard 截圖各尺寸維持邊框處理
- Hero 視覺在 mobile 簡化（減少浮動 UI 元素）
- 產品截圖用響應式尺寸、圓角一致
- 深色背景確保截圖在任何 viewport 都自然融入

## 9. Agent Prompt 指南

### 快速色票
- 主要 CTA：Brand Indigo（`#5e6ad2`）
- 頁面背景：Marketing Black（`#08090a`）
- 面板背景：Panel Dark（`#0f1011`）
- 表面：Level 3（`#191a1b`）
- 標題文字：Primary White（`#f7f8f8`）
- 內文：Silver Gray（`#d0d6e0`）
- 弱化文字：Tertiary Gray（`#8a8f98`）
- 細微文字：Quaternary Gray（`#62666d`）
- 點綴：Violet（`#7170ff`）
- 點綴 Hover：Light Violet（`#828fff`）
- 邊框（預設）：`rgba(255,255,255,0.08)`
- 邊框（細微）：`rgba(255,255,255,0.05)`
- Focus ring：多層陰影堆疊

### 元件 prompt 範例
- 「在 `#08090a` 背景上建立 hero 章節。標題用 Inter Variable 48px 字重 510、行高 1.00、字距 -1.056px、色 `#f7f8f8`、font-feature-settings `'cv01', 'ss03'`。副標 18px 字重 400、行高 1.60、色 `#8a8f98`。品牌 CTA 按鈕（`#5e6ad2`、6px 圓角、8px 16px padding）和 ghost 按鈕（`rgba(255,255,255,0.02)` 背景、1px solid rgba(255,255,255,0.08) 邊框、6px 圓角）。」
- 「設計深底卡片：`rgba(255,255,255,0.02)` 背景、1px solid rgba(255,255,255,0.08) 邊框、8px 圓角。標題 Inter Variable 20px 字重 590、字距 -0.24px、色 `#f7f8f8`。內文 15px 字重 400、色 `#8a8f98`、字距 -0.165px。」
- 「做膠囊徽章：透明底、`#d0d6e0` 文字、9999px 圓角、0px 10px padding、1px solid #23252a 邊框、Inter Variable 12px 字重 510。」
- 「做導覽：`#0f1011` 上的深色 sticky header。Inter Variable 13px 字重 510 連結、`#d0d6e0` 文字。品牌靛紫 CTA `#5e6ad2` 右對齊、6px 圓角。底部邊框 1px solid rgba(255,255,255,0.05)。」
- 「設計 command palette：`#191a1b` 背景、1px solid rgba(255,255,255,0.08) 邊框、12px 圓角、多層陰影堆疊。輸入用 16px Inter Variable 字重 400、`#f7f8f8` 文字。結果列表用 13px 字重 510 標籤（`#d0d6e0`）和 12px metadata（`#62666d`）。」

### 迭代指南
1. 所有 Inter 文字一定要設 font-feature-settings `"cv01", "ss03"`——對 Linear 的外觀不可妥協
2. 字距隨字級變化：72px 時 -1.584px、48px 時 -1.056px、32px 時 -0.704px、16px 以下 normal
3. 三字重：400（讀）、510（強調/導覽）、590（宣告）
4. 表面層次靠背景透明度：`rgba(255,255,255, 0.02 → 0.04 → 0.05)`——深底上絕不用純色背景
5. 品牌靛紫（`#5e6ad2` / `#7170ff`）是系統唯一彩色——其他都是灰階
6. 邊框永遠是半透明白，深底上絕不用實線深色
7. 程式碼或技術內容用 Berkeley Mono，其餘用 Inter Variable
