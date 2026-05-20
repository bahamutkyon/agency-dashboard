---
name: creative-quality-gate
description: 創意產出品質閘門——對外交付前必須通過兩道檢查：anti-AI-slop 黑名單（禁紫漸變、通用 emoji、假數據、ChatGPT 味用語等）+ 五維自評審（哲學/層次/細節/功能/創新），任一維度 <3 分必須回工
---

# 創意產出品質閘門

> Inspired by [nexu-io/open-design](https://github.com/nexu-io/open-design) 的 anti-AI-slop + 五維評審機制，繁中在地化並擴充為四類黑名單。

## 何時觸發此技能

當你即將「對外交付」**有主觀品質判定**的創意產出時，**emit 之前**走完本閘門。包括：

- 投影片 / 海報 / 社交圖文 / Infographic
- 行銷文案 / 品牌敘事 / 廣告腳本 / SEO 文章
- 視覺設計 / UI mockup / Logo / Banner
- 內容創作（公眾號、小紅書、影片腳本、podcast 大綱）
- 報告類文件（年報、提案書、白皮書、PRD）
- 數據視覺化（圖表、儀表板、資訊圖）

**不適用**：純功能性程式碼（→ `chinese-code-review`）、純資料抽取（無美學判定）、純技術文件（→ `chinese-documentation`）。

---

## 兩道閘門

```
產出草稿 ──→ [閘門一：anti-AI-slop 黑名單] ──→ [閘門二：五維自評審 ≥3 分] ──→ EMIT
                  ↓ 命中任一禁忌                     ↓ 任一維度 <3
                  必須修正                          必須回工再評
```

### 閘門一：Anti-AI-Slop 黑名單（四類）

詳細禁忌清單與「為什麼俗 / 正確做法」對照表 → 讀 `references/anti-slop-blacklist.md`

| 類別 | 主要禁忌 |
|---|---|
| **A. 視覺類** | 紫漸變、通用 emoji 標題、左 border 圓角卡片、Inter 當大標題、3D 玻璃化、全部置中 |
| **B. 文案類** | 「在快節奏的當今社會」破題、三段排比、「賦能/助力/打造」、自吹形容詞、「綜上所述」結尾 |
| **C. 數據類** | 假數字（如「快 10 倍」）、百分比沒分母、3D 圖表、Y 軸不從 0 起 |
| **D. 結構類** | 三問三答、湊整數的 5/7/10 點、每個 bullet 配 emoji |

### 閘門二：五維自評審

每維 1-5 分，**任一維度 <3 必須回工**。詳細評分標準與完整範例 → 讀 `references/scoring-rubric.md`

| 維度 | 一句話定義 |
|---|---|
| **Philosophy** | 有清楚的觀點 / 主張嗎？還是資訊堆疊？ |
| **Hierarchy** | 視覺層級與資訊層級一致嗎？眼睛知道先看哪？ |
| **Detail** | 標點、留白、對齊、字距，是否到位？ |
| **Function** | 達成了它該達成的事嗎？ |
| **Innovation** | 換 AI 來做會一樣嗎？看得出創作者判斷嗎？ |

---

## 自評輸出格式（emit 前必須包含）

在交付前**先把這段說出來**（給用戶看 / 寫進 commit message / 放在 artifact 前）：

```
## 自評
- Philosophy: 4/5 — 主張清楚,但結尾可以更篤定
- Hierarchy:  5/5 — 三層視覺權重明確
- Detail:     3/5 — 第 4 頁字距偏鬆,已修正
- Function:   4/5 — CTA 明確
- Innovation: 3/5 — 配色保險,可再大膽

最低分: 3 ≥ 3 ✅ 通過閘門
```

退回流程：任一維度 <3 → 明確說出哪維、為什麼 → 針對該維度修正 → 重評該維度 → 全 ≥3 才 emit。

---

## 與其他 skill 的關係

本 skill 是「品質閘門」，不是「執行步驟」。配合執行類 skill 使用：

- 做簡報 → 配 `chinese-presentation-style`
- 寫文件 → 配 `chinese-documentation`
- 寫程式 → 配 `chinese-code-review`（程式碼有自己的審查維度，不走本閘門）

與 `verification-before-completion` 互補：那個查「跑不跑得起來」，本 skill 查「美不美 / 有沒有觀點」。

---

## 給編排者的提醒

如果你是在 dashboard 中**派發任務給其他 agent** 的編排者：

- 對於創意類任務（行銷、設計、內容），在派發 prompt 中明確要求 agent 走本閘門
- 收到 agent 產出後，先檢查它有沒有自評輸出。沒有就退回要求重評
- agent 自評分數虛高（全 5/5）也要警覺，可能是它沒認真檢查
