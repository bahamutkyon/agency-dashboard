# 受 Miro 啟發的設計系統

> 類別：Design & Creative
> 視覺化協作。明亮黃色強調色，無限畫布美學。

## 1. 視覺主題與氛圍

Miro 的網站是一個乾淨、以協作工具為核心的平台，透過大量留白、粉彩強調色與穩健的幾何字型，傳達「視覺化思考」的精神。整體設計以白色畫布為主，搭配近黑色文字（`#1c1c1e`）與一組獨特的粉彩配色 — 珊瑚紅、玫瑰粉、青綠、橘、黃、苔綠 — 各自代表不同的協作情境。

字型方面以 Roobert PRO Medium 作為主要展示字型，搭配 OpenType 字元變體（`"blwf", "cv03", "cv04", "cv09", "cv11"`）與負字距（56px 時為 -1.68px）。內文則由 Noto Sans 擔綱，啟用自家的樣式集（`"liga" 0, "ss01", "ss04", "ss05"`）。整站以 Framer 打造，動畫流暢、元件模式現代。

**主要特徵：**
- 白色畫布搭配近黑（`#1c1c1e`）文字
- Roobert PRO Medium 並啟用多組 OpenType 字元變體
- 粉彩強調色組：珊瑚紅、玫瑰粉、青綠、橘、黃、苔綠（明／暗成對）
- Blue 450（`#5b76fe`）作為主要互動色
- 成功綠（`#00b473`）用於正向狀態
- 大方的圓角範圍：8px–50px
- 以 Framer 打造，動效流暢
- 環形陰影邊框：`rgb(224,226,232) 0px 0px 0px 1px`

## 2. 配色系統與角色

### Primary
- **Near Black**（`#1c1c1e`）：主要文字色
- **White**（`#ffffff`）：`--tw-color-white`，主要表面色
- **Blue 450**（`#5b76fe`）：`--tw-color-blue-450`，主要互動色
- **Actionable Pressed**（`#2a41b6`）：`--tw-color-actionable-pressed`

### 粉彩強調色（明／暗配對）
- **Coral**：明 `#ffc6c6` ／ 暗 `#600000`
- **Rose**：明 `#ffd8f4` ／ 暗（暗色省略）
- **Teal**：明 `#c3faf5` ／ 暗 `#187574`
- **Orange**：明 `#ffe6cd`
- **Yellow**：暗 `#746019`
- **Moss**：暗 `#187574`
- **Pink**（`#fde0f0`）：柔粉表面
- **Red**（`#fbd4d4`）：淡紅表面
- **Dark Red**（`#e3c5c5`）：低彩紅

### 語意
- **Success**（`#00b473`）：`--tw-color-success-accent`

### 中性
- **Slate**（`#555a6a`）：次要文字
- **Input Placeholder**（`#a5a8b5`）：`--tw-color-input-placeholder`
- **Border**（`#c7cad5`）：按鈕邊框
- **Ring**（`rgb(224,226,232)`）：以陰影代邊框

## 3. 字型系統

### 字型家族
- **Display**：`Roobert PRO Medium`，fallback：Placeholder — `"blwf", "cv03", "cv04", "cv09", "cv11"`
- **Display 變體**：`Roobert PRO SemiBold`、`Roobert PRO SemiBold Italic`、`Roobert PRO`
- **Body**：`Noto Sans` — `"liga" 0, "ss01", "ss04", "ss05"`

### 層級

| 角色 | 字型 | 大小 | 字重 | 行高 | 字距 |
|------|------|------|--------|-------------|----------------|
| Display Hero | Roobert PRO Medium | 56px | 400 | 1.15 | -1.68px |
| Section Heading | Roobert PRO Medium | 48px | 400 | 1.15 | -1.44px |
| Card Title | Roobert PRO Medium | 24px | 400 | 1.15 | -0.72px |
| Sub-heading | Noto Sans | 22px | 400 | 1.35 | -0.44px |
| Feature | Roobert PRO Medium | 18px | 600 | 1.35 | normal |
| Body | Noto Sans | 18px | 400 | 1.45 | normal |
| Body Standard | Noto Sans | 16px | 400–600 | 1.50 | -0.16px |
| Button | Roobert PRO Medium | 17.5px | 700 | 1.29 | 0.175px |
| Caption | Roobert PRO Medium | 14px | 400 | 1.71 | normal |
| Small | Roobert PRO Medium | 12px | 400 | 1.15 | -0.36px |
| Micro Uppercase | Roobert PRO | 10.5px | 400 | 0.90 | uppercase |

## 4. 元件與模式

### 按鈕
- Outlined：透明背景，`1px solid #c7cad5`，8px 圓角，7px 12px padding
- 白色圓鈕：50% 圓角，白底加陰影
- 藍色主要按鈕（由互動色推導而來）

### 卡片：12px–24px 圓角，搭配粉彩底色
### 輸入框：白底，`1px solid #e9eaef`，8px 圓角，16px padding

## 5. 間距與佈局
- 間距：1–24px 基礎刻度
- 圓角：8px（按鈕）、10px–12px（卡片）、20px–24px（面板）、40px–50px（大型容器）
- 環形陰影：`rgb(224,226,232) 0px 0px 0px 1px`

## 6. 深度與層次
低調 — 環形陰影加上粉彩表面對比即足夠。

## 7. Do's and Don'ts
### Do
- 在特色區塊使用粉彩的明／暗配對
- Roobert PRO 搭配 OpenType 字元變體一同使用
- 互動元素統一使用 Blue 450（#5b76fe）
### Don't
- 不要使用厚重陰影
- 同一區塊不要混用超過兩種粉彩強調色

## 8. 響應式行為
斷點：425px、576px、768px、896px、1024px、1200px、1280px、1366px、1700px、1920px

## 9. Agent 提示詞指南
### 快速配色參考
- 文字：Near Black（`#1c1c1e`）
- 背景：White（`#ffffff`）
- 互動：Blue 450（`#5b76fe`）
- 成功：`#00b473`
- 邊框：`#c7cad5`
### 元件提示詞範例
- 「製作 hero：白色背景。Roobert PRO Medium 56px，行高 1.15，字距 -1.68px。藍色 CTA（#5b76fe）。Outlined 次要按鈕（1px solid #c7cad5，8px 圓角）。」
