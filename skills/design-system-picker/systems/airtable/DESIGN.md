# 受 Airtable 啟發的設計系統

> 類別：Design & Creative
> 試算表與資料庫的混血。色彩繽紛、親切、結構化的資料美學。

## 1. 視覺主題與氛圍

Airtable 的網站是一個乾淨、適合企業情境的平台，以白色畫布搭配深海軍藍文字（`#181d26`）與 Airtable Blue（`#1b61c9`）作為主要互動強調色，傳達「精緻而簡潔」的氣質。Haas 字型家族（display 與 text 兩種變體）建構出一套瑞士式精準度的字型系統，全文採用正字距。

**主要特徵：**
- 白色畫布搭配深海軍藍文字（`#181d26`）
- Airtable Blue（`#1b61c9`）作為主要 CTA 與連結色
- Haas 與 Haas Groot Disp 雙字型系統
- 內文採正字距（0.08px–0.28px）
- 按鈕 12px 圓角，卡片則為 16px–32px
- 多層藍色調陰影：`rgba(45,127,249,0.28) 0px 1px 3px`
- 語意化主題 token：`--theme_*` 的 CSS 變數命名

## 2. 配色系統與角色

### Primary
- **Deep Navy**（`#181d26`）：主要文字
- **Airtable Blue**（`#1b61c9`）：CTA 按鈕、連結
- **White**（`#ffffff`）：主要表面色
- **Spotlight**（`rgba(249,252,255,0.97)`）：`--theme_button-text-spotlight`

### 語意
- **Success Green**（`#006400`）：`--theme_success-text`
- **Weak Text**（`rgba(4,14,32,0.69)`）：`--theme_text-weak`
- **Secondary Active**（`rgba(7,12,20,0.82)`）：`--theme_button-text-secondary-active`

### 中性
- **Dark Gray**（`#333333`）：次要文字
- **Mid Blue**（`#254fad`）：連結／強調藍變體
- **Border**（`#e0e2e6`）：卡片邊框
- **Light Surface**（`#f8fafc`）：低調的表面色

### 陰影
- **藍調陰影**（`rgba(0,0,0,0.32) 0px 0px 1px, rgba(0,0,0,0.08) 0px 0px 2px, rgba(45,127,249,0.28) 0px 1px 3px, rgba(0,0,0,0.06) 0px 0px 0px 0.5px inset`）
- **柔光**（`rgba(15,48,106,0.05) 0px 0px 20px`）

## 3. 字型系統

### 字型家族
- **Primary**：`Haas`，fallback：`-apple-system, system-ui, Segoe UI, Roboto`
- **Display**：`Haas Groot Disp`，fallback：`Haas`

### 層級

| 角色 | 字型 | 大小 | 字重 | 行高 | 字距 |
|------|------|------|--------|-------------|----------------|
| Display Hero | Haas | 48px | 400 | 1.15 | normal |
| Display Bold | Haas Groot Disp | 48px | 900 | 1.50 | normal |
| Section Heading | Haas | 40px | 400 | 1.25 | normal |
| Sub-heading | Haas | 32px | 400–500 | 1.15–1.25 | normal |
| Card Title | Haas | 24px | 400 | 1.20–1.30 | 0.12px |
| Feature | Haas | 20px | 400 | 1.25–1.50 | 0.1px |
| Body | Haas | 18px | 400 | 1.35 | 0.18px |
| Body Medium | Haas | 16px | 500 | 1.30 | 0.08–0.16px |
| Button | Haas | 16px | 500 | 1.25–1.30 | 0.08px |
| Caption | Haas | 14px | 400–500 | 1.25–1.35 | 0.07–0.28px |

## 4. 元件與模式

### 按鈕
- **Primary Blue**：`#1b61c9`，白色文字，16px 24px padding，12px 圓角
- **White**：白底，`#181d26` 文字，12px 圓角，1px 白色邊框
- **Cookie Consent**：`#1b61c9` 背景，2px 圓角（銳利）

### 卡片：`1px solid #e0e2e6`，16px–24px 圓角
### 輸入框：標準 Haas 樣式

## 5. 佈局
- 間距：1–48px（以 8px 為基準）
- 圓角：2px（小型）、12px（按鈕）、16px（卡片）、24px（區塊）、32px（大型）、50%（圓形）

## 6. 深度
- 多層藍調陰影系統
- 柔和環境光：`rgba(15,48,106,0.05) 0px 0px 20px`

## 7. Do's and Don'ts
### Do：CTA 統一使用 Airtable Blue、Haas 字型搭配正字距、按鈕 12px 圓角
### Don't：省略正字距、套用厚重陰影

## 8. 響應式行為
斷點：425–1664px（共 23 個斷點）

## 9. Agent 提示詞指南
- 文字：Deep Navy（`#181d26`）
- CTA：Airtable Blue（`#1b61c9`）
- 背景：White（`#ffffff`）
- 邊框：`#e0e2e6`
