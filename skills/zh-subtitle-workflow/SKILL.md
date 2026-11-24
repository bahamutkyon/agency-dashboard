---
name: zh-subtitle-workflow
description: 中文影片字幕全流程——本機聽寫（faster-whisper，GPU）→ 台灣繁體與全形標點 → 套用錯字對照表 → 交給使用者在 Subtitle Edit 校對 → 從校對結果自動學習錯字 → 用微軟正黑體燒進影片。只要使用者要「上字幕」「聽寫」「逐字稿」「改字幕」「字幕有錯字」，或影片要出 Reels/Shorts/YouTube 且有人聲，就用這個 skill（燒字幕、轉檔交給 ffmpeg-skill）。
---

# 中文字幕流程（zh-subtitle-workflow）

腳本：`python3 <skill-dir>/scripts/subtitles.py <指令>`，每個指令都輸出一行 JSON，照 JSON 回報，不要自己猜。

## 標準流程（照順序）

1. **聽寫**
   `python3 <skill-dir>/scripts/subtitles.py transcribe 影片.mp4 -o 影片.srt`
   - 產出 `影片.srt`（工作稿）、`影片.auto.srt`（自動稿快照，**不准改、不准刪**，第 4 步要用）、`影片.raw.srt`（模型原始輸出）。
   - 預設 `large-v3`、每行最多 16 字（直式短片可用 `--max-chars 12`；橫式長片 18～20）。
   - 錯字對照表裡的正確詞會自動當成聽寫提示，越用越準。
2. **交給使用者校對**：先打開 Subtitle Edit，再告訴使用者檔案在哪
   `python3 <skill-dir>/scripts/subtitles.py edit 影片.srt --video 影片.mp4`
   回覆使用者：「字幕在 Subtitle Edit 開好了（影片.srt），改完存檔跟我說『改好了』」。
   **沒等到使用者確認就不要燒字幕**；使用者說「不用校對」「直接燒」才跳過第 2～4 步。
3. 使用者說改好了 → **一定要先學習**再燒：
4. `python3 <skill-dir>/scripts/subtitles.py learn 影片.srt`
   回報 `added`（新學到的錯字，例如「6SM7→6SN7」）；`found` 有但 `added` 沒有的代表已經學過或跟既有規則衝突。
5. **燒字幕**（ffmpeg-skill）：
   `python3 ~/.claude/skills/ffmpeg-skill/scripts/caption.py 影片.mp4 --srt 影片.srt --font "Microsoft JhengHei" -o 影片_字幕.mp4`
   直式短片要先轉 9:16 **再**燒字幕（先燒再裁會切到字）；平台匯出與檢查照 ffmpeg-skill 流程。

## 其他指令

- 外來的 SRT（別人給的、簡體的）：`subtitles.py normalize 外來.srt -o 整理後.srt`
- 看／手動加對照表：`subtitles.py glossary`、`subtitles.py glossary --add 錯=對 錯2=對2`
- 對照表位置：`~/.claude/subtitle-glossary.json`（環境變數 `ZH_SUB_GLOSSARY` 可改）。使用者主動提供的專有名詞（器材型號、品牌、人名）直接用 `--add` 加，下次聽寫就會認得。

## 規則

- 字幕的**文字內容以使用者校對為準**：不要自己改寫、潤飾、縮短使用者改過的句子；只有使用者要求才動。
- 學習只收「短的錯字替換」：整句改寫、純標點、增刪字都不會被學進去，這是刻意的，不要手動繞過。
- 不要刪 `.auto.srt`；它被刪了就沒辦法學習（`learn` 會報錯）。
- 環境缺套件時照錯誤訊息裡的安裝指令回報給使用者，不要自己裝系統層級的東西。

## 回報格式

```
字幕：開箱.srt（42 句，3 分 12 秒）— 已在 Subtitle Edit 打開，等你校對
學到：6SM7→6SN7、LP Audio→LP audio（對照表共 12 條）
成品：開箱_字幕.mp4（1080x1920，Reels 檢查 13 項全過）
```
