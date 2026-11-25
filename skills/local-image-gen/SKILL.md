---
name: local-image-gen
description: 本機生圖（MiniMax H3-Image，3090 本地跑、不花錢、不上雲）——自動用使用者開著的 LocModel 或 ComfyUI，可指定比例或寬高、步數、seed、張數，成品存到 D 槽。只要要「生一張圖」「做主視覺／封面／貼文配圖／產品情境圖／縮圖」，或剪輯需要片頭底圖、示意圖，就用這個 skill。
---

# 本機生圖（local-image-gen）

腳本：`python3 <skill-dir>/scripts/genimage.py <指令>`，每個指令輸出一行 JSON，照 JSON 回報。

## 流程

1. **先看哪個後端開著**
   `python3 <skill-dir>/scripts/genimage.py status`
   - `locmodel: true` 或 `comfyui: true` 任一即可；都 false 就**停下來請使用者打開其中一個**：
     LocModel 打開「畫圖」頁並先生成一張（引擎才會啟動），或打開 ComfyUI 桌面版。
   - 兩個不要同時生圖（顯卡 24GB 只夠一個）。
2. **生圖**
   `python3 <skill-dir>/scripts/genimage.py generate --prompt "英文提示詞" --aspect 4:5 --name 檔名前綴`
   - 尺寸：`--aspect`（1:1、4:5、9:16、16:9、3:4…）＋選填 `--megapixels`（預設約 1 MP，最大約 16 MP）；或 `--width W --height H`（自動取 32 的倍數）。
   - 常用：IG 貼文 `4:5`、Reels/Shorts 封面 `9:16`、YouTube 縮圖 `16:9 --megapixels 2`。
   - `--seed N` 固定構圖可重現；`--count 4` 一次多張（seed 依序 +1），挑圖時用。
   - `--steps` 預設 6，是模型蒸餾設定，**不要改**。
3. **看圖再交件**：用讀圖工具打開 `files[].path` 確認內容，不合就改提示詞或換 seed 重生；回報時附路徑與 seed。

## 提示詞

- 用**英文**寫，具體描述主體、材質、光線、鏡頭與構圖；品牌名、型號這類文字模型常會亂印上去，**不要求畫面出現文字時就別寫進提示詞**，需要文字的版面用設計工具後製。
- 使用者給中文需求時，自己轉成英文提示詞，回報時附上用的英文提示詞。

## 規則

- 成品一律存 `D:\AI\dashboard`（`--out-dir` 可改，但要留在 D 槽）；不覆蓋既有檔案。
- **測試或廢棄的圖用完要刪**，只留使用者要的成品。
- 只做一般工作用途的圖：不做真人或真實人物形象（含 VTuber）的色情、裸露或誹謗內容，不做看起來未成年的角色的任何性暗示內容。
- 只在本機跑，不呼叫任何雲端生圖服務。
