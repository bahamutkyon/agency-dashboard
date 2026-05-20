---
name: design-system-picker
description: 設計風格挑選器——當需要產出符合特定品牌/產品視覺語言的內容（例如「做一個 Linear 風的 dashboard」「Notion 風格的提案頁」「Stripe 風格的定價頁」）時，從 23 套精選 design system 中挑對的並讀取其 DESIGN.md 規範作為設計依據
---

# 設計風格挑選器

> Inspired by [nexu-io/open-design](https://github.com/nexu-io/open-design) 的 design-systems 集合（curated from VoltAgent/awesome-design-md），精選 23 套並繁中化。

## 何時觸發此技能

當使用者要求「**做出像 X 風格的東西**」時。例如：

- 「做一個 Linear 風的 dashboard」
- 「Notion 風格的提案頁」
- 「Stripe 那種乾淨的定價頁」
- 「給我 Vercel 那種 Hero section」
- 「設計一個跟 Claude 一樣有人文感的網頁」
- 「Spotify 風的播放清單卡片」

也適用於沒指名但需要參考視覺基調的場景：「做一個專業科技感的介面」→ 可挑 Vercel / Linear 風。

**不適用**：純中文簡報（用 `chinese-presentation-style`）、產出品質檢查（用 `creative-quality-gate`）。

---

## 工作流程

### Step 1：理解需求 → 挑系統

從 23 套裡挑最對味的 1 套（最多 2 套混搭）。下方分類表幫你快速定位：

#### 🤖 AI / LLM 風格

| 系統 | 一句話特徵 | 適用場景 |
|---|---|---|
| **claude** | 暖陶土色 + 編輯感襯線字 + 羊皮紙底色，AI 中最有人文味 | 內容類網頁、AI 產品官網 |
| **ollama** | 黑底極簡 + monospace 字、駭客感、命令列美學 | 開源開發工具、技術 landing |
| **x-ai** | 純黑高反差、銳利幾何、太空感 | 科技前沿、AI infrastructure |

#### 🛠 開發者工具風格

| 系統 | 一句話特徵 | 適用場景 |
|---|---|---|
| **cursor** | 深色為主 + 紫粉漸層強調、現代 IDE 感 | AI 編程工具、開發者產品 |
| **vercel** | 純白高對比、極致 typography、無多餘元素 | 部署平台、靜態網站 |
| **linear-app** | 深藍灰漸層、極乾淨、Inter 字、靜謐感 | 專案管理、團隊協作 |
| **supabase** | 翠綠強調 + 暗色底、開源熱情 + 技術專業 | 後端/資料庫產品 |
| **sentry** | 紫色為主、緊湊資訊密度、監控感 | 監控、錯誤追蹤 |
| **posthog** | 大膽橘紅 + 圖表元素豐富、playful 但專業 | 數據分析、用戶行為 |
| **framer** | 動態玻璃化 + 漸層、創意工具感 | 設計工具、no-code 平台 |

#### 📋 生產力工具風格

| 系統 | 一句話特徵 | 適用場景 |
|---|---|---|
| **notion** | 白底 + 內容優先、極簡但有個性、emoji 友善 | 文件、知識庫、wiki |
| **figma** | 多彩元件、視覺工具感、邊框圓角溫和 | 設計協作平台 |
| **miro** | 黃色強調 + 手繪感、白板協作活潑 | 視覺協作、腦力激盪 |
| **airtable** | 多色 cell + 試算表進化感、組織化但靈活 | 資料庫工具、CRM |
| **raycast** | 深色 + 銳利搜尋介面、極速感、命令列美學 | 啟動器、生產力工具 |

#### 💳 金融科技風格

| 系統 | 一句話特徵 | 適用場景 |
|---|---|---|
| **stripe** | 靛紫漸層 + 極簡乾淨、世界級 API 文件感 | 金融 API、開發者文檔、付款流 |

#### 🛒 電商風格

| 系統 | 一句話特徵 | 適用場景 |
|---|---|---|
| **airbnb** | 珊瑚紅 + 圓角溫暖、敘事攝影、生活感 | 旅遊、住宿、生活風格 |
| **shopify** | 翠綠 + 商業專業、清楚的轉換動線 | 電商、商家工具 |

#### 🎵 媒體風格

| 系統 | 一句話特徵 | 適用場景 |
|---|---|---|
| **spotify** | 純黑 + 螢光綠強調、音樂律動感、卡片豐富 | 音樂、podcast、串流媒體 |
| **meta** | 藍色為主、社群連結感、人本中心 | 社群、社交產品 |

#### 🍎 經典科技

| 系統 | 一句話特徵 | 適用場景 |
|---|---|---|
| **apple** | 純白 + 極簡 + SF Pro、Material Design 對立面、產品攝影主導 | 硬體產品、極簡科技 |

#### 🎨 通用 starter

| 系統 | 一句話特徵 | 適用場景 |
|---|---|---|
| **default** | 中性現代、無強烈品牌色、安全保底 | 不確定方向時的 baseline |
| **warm-editorial** | 暖色系編輯感、雜誌風、長篇內容友善 | blog、long-form 內容、文化類 |

---

### Step 2：讀取對應 DESIGN.md

挑好系統後，**用 Read tool 讀**：

```
~/.claude/skills/design-system-picker/systems/<name>/DESIGN.md
```

例如挑了 linear-app：
```
Read ~/.claude/skills/design-system-picker/systems/linear-app/DESIGN.md
```

每個 DESIGN.md 包含 9 個 section：視覺主題與氛圍、配色系統與角色、字型系統、間距與佈局、元件與模式、圖示系統、動效與互動、語氣與調性、使用準則。

### Step 3：嚴格遵守規範產出

讀完 DESIGN.md 後，**所有設計決策都引用該規範**：

- 色彩：用該系統定義的色票，不要自己編色碼
- 字型：用該系統規定的字型堆疊
- 間距：用該系統的 spacing scale
- 元件：套用該系統的 button / card / nav 模式
- 動效：依該系統的 motion 描述

**回應時引述 source**：
> 「我用 Linear 的設計系統做了這個 dashboard：主色 #5E6AD2（Linear Indigo），字型 Inter 4-700，間距 8px grid，按鈕用 Linear 的 hover 微 lift 效果...」

---

### Step 4：交付前過 `creative-quality-gate`

設計類產出 emit 前**必須走** `creative-quality-gate` 的兩道閘門：
1. anti-AI-slop 黑名單檢查
2. 五維自評審 ≥3 分

design-system-picker 解決「跟誰學風格」，creative-quality-gate 解決「品質有沒有達標」，兩個 skill **是搭配使用**。

---

## 範例完整流程

**使用者**：「幫我設計一個跟 Stripe 一樣乾淨的定價頁，要 3 個方案。」

**Agent**：

1. **Step 1**：挑 stripe 系統（直接點名）
2. **Step 2**：Read `~/.claude/skills/design-system-picker/systems/stripe/DESIGN.md`
3. **Step 3**：依規範產出：
   - 用 Stripe Indigo `#635BFF` 當主色（不要自己編紫色）
   - Typography 用 Söhne / Söhne Mono（Stripe 字型堆疊）
   - 3 卡並排，每張用 Stripe 標準的 16px radius + 細邊框
   - CTA 按鈕用 Stripe 的 hover 漸層
4. **Step 4**：emit 前過 `creative-quality-gate`
   - 反 slop 檢查：沒紫漸變濫用、沒通用 emoji、沒假數據 ✓
   - 五維自評：Philosophy 4/5, Hierarchy 5/5, Detail 5/5, Function 4/5, Innovation 3/5 → 通過
5. **emit**

---

## 給編排者的提醒

如果你是 dashboard 編排者派發任務：

- 對於明確指定品牌風格的設計任務，**在 prompt 中要求 agent 用本 skill**
- 對於模糊的設計請求（如「做個漂亮的網頁」），可建議 agent **先問風格方向**或挑 `default` / `warm-editorial`
- 收到產出時驗證：是否引述了用的 design system 名稱？是否用了該系統定義的色碼？沒有就退回
