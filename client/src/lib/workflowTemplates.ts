// Pre-built workflow templates. Pick one as a starting point, then edit
// agent IDs (some might not exist if you uninstall some) and prompts.

import type { WorkflowStep } from "./api";

export interface WorkflowTemplate {
  id: string;
  emoji: string;
  label: string;
  description: string;
  steps: WorkflowStep[];
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "ip-weekly",
    emoji: "📱",
    label: "IP 週報生產線",
    description: "找熱點 → 寫初稿 → 品牌審稿 → 多平台改編",
    steps: [
      {
        agentId: "marketing-trend-researcher",
        prompt: "找出本週中文社群(IG / Threads / 小紅書)上跟我這個 IP 主題相關的 5 個熱門選題,每個用一句話說明為什麼有潛力。"
      },
      {
        agentId: "marketing-content-creator",
        prompt: "從以下選題挑出最適合我品牌的 1 個,寫成一篇 IG 主貼文初稿(400 字內,口語、實作派、有 CTA),最後附 5-8 個 hashtag。\n\n{{out}}"
      },
      {
        agentId: "design-brand-guardian",
        prompt: "審以下文案,確認:(1)語氣符合品牌(2)沒有禁用詞(3)CTA 自然不硬推。給我具體修改建議或直接改寫。\n\n{{out}}"
      },
      {
        agentId: "design-image-prompt-engineer",
        prompt: "為以下這篇 IG 貼文設計一張主視覺圖的 AI 生圖 prompt(英文,Midjourney / Imagen 通用,不要包含中文字)。把最終 prompt 包在 ```prompt code block 裡。\n\n{{out}}"
      }
    ]
  },
  {
    id: "client-proposal",
    emoji: "📋",
    label: "新客戶提案製作",
    description: "需求釐清 → 提案草擬 → 法務檢查 → 報價",
    steps: [
      {
        agentId: "sales-coach",
        prompt: "請列出針對下面這位潛在客戶,提案要釐清的 5 個關鍵問題與其答案範例(若我已知答案請填入,未知則標 [TBD])。"
      },
      {
        agentId: "marketing-content-creator",
        prompt: "依下列已釐清的需求,撰寫一份提案大綱(問題定義 / 解決方案 / 預期效益 / 時程 / 報價區間)。\n\n{{out}}"
      },
      {
        agentId: "legal-contract-reviewer",
        prompt: "檢查以下提案有沒有需要加的免責聲明、智財權條款、保密義務、履約風險。\n\n{{out}}"
      },
      {
        agentId: "finance-financial-analyst",
        prompt: "依以下提案內容估算合理報價區間(列出 3 種方案:精簡 / 標準 / 完整,各列工時 + 成本)。\n\n{{out}}"
      }
    ]
  },
  {
    id: "competitor-analysis",
    emoji: "🎯",
    label: "競品分析報告",
    description: "蒐集 → 分析 → 結論",
    steps: [
      {
        agentId: "marketing-trend-researcher",
        prompt: "請用網路公開資訊,整理出我這個業務領域的 5 個主要競品,每個列:品牌定位、目標客群、定價、主要差異化。輸出表格。"
      },
      {
        agentId: "strategy-business-strategist",
        prompt: "依以下競品資訊做 SWOT 分析,我方相對優勢與劣勢各 3 點,以及 2 個可切入的市場空白。\n\n{{out}}"
      },
      {
        agentId: "marketing-content-creator",
        prompt: "把以上分析整理成一頁 executive summary(3 段、每段 100 字內),適合給決策者快速看完做決定。\n\n{{out}}"
      }
    ]
  },
  {
    id: "code-review",
    emoji: "🛠️",
    label: "Code Review 雙保險",
    description: "結構審查 → 安全性掃描 → 效能建議",
    steps: [
      {
        agentId: "engineering-code-reviewer",
        prompt: "請看以下程式碼,給結構性建議(命名、抽象、責任分離、測試覆蓋)。"
      },
      {
        agentId: "engineering-security-engineer",
        prompt: "對以下程式碼做安全性掃描,標出可能的漏洞(input validation、injection、auth、敏感資料外洩)。\n\n{{out}}"
      },
      {
        agentId: "engineering-performance-benchmarker",
        prompt: "依以下程式碼結構與安全建議,額外指出效能瓶頸(熱點函數、N+1 查詢、不必要的 IO),按優先級排序。\n\n{{out}}"
      }
    ]
  },
  {
    id: "course-design",
    emoji: "🎓",
    label: "線上課程設計",
    description: "市場研究 → 大綱 → 行銷話術",
    steps: [
      {
        agentId: "marketing-trend-researcher",
        prompt: "搜尋目前在小紅書 / YouTube 中文圈最受歡迎的同領域課程,列 5 個並分析它們的賣點與定價。"
      },
      {
        agentId: "academic-study-planner",
        prompt: "依以下市場研究與我的專業,設計一份 8 週課程大綱(每週主題 + 學習成果 + 作業形式)。\n\n{{out}}"
      },
      {
        agentId: "marketing-content-creator",
        prompt: "為以下課程寫一段 600 字的銷售文案(痛點 → 解方 → 學員成果 → 加入 CTA)。\n\n{{out}}"
      }
    ]
  },
  // ---- DAG / 平行範例 ----
  {
    id: "ip-multi-platform",
    emoji: "🌐",
    label: "[平行] IP 多平台同步發稿",
    description: "一次寫好 IG / 小紅書 / Threads 三平台改編稿(平行跑)",
    steps: [
      { id: "core_draft", agentId: "marketing-content-creator",
        prompt: "為以下主題寫一份「核心」內容(主軸 + 重點 + 結論,400-600 字繁體中文,不限平台):\n\n{{out}}" },
      { id: "ig_version", agentId: "Instagram 策展师", dependsOn: ["core_draft"],
        prompt: "把以下核心內容改編成 IG 主貼文(視覺感、口語、加 hashtag):\n\n{{core_draft.out}}" },
      { id: "rednote_version", agentId: "小红书专家", dependsOn: ["core_draft"],
        prompt: "把以下核心內容改編成小紅書筆記(emoji、條列、平台調性):\n\n{{core_draft.out}}" },
      { id: "threads_version", agentId: "marketing-content-creator", dependsOn: ["core_draft"],
        prompt: "把以下核心內容改編成 Threads 串文(3-5 則,每則 100 字內,口語):\n\n{{core_draft.out}}" },
      { id: "merge", agentId: "design-brand-guardian", dependsOn: ["ig_version", "rednote_version", "threads_version"],
        prompt: "請審以下三平台稿件,確認語氣一致、品牌調性符合;若有衝突請給統一建議:\n\n## IG\n{{ig_version.out}}\n\n## 小紅書\n{{rednote_version.out}}\n\n## Threads\n{{threads_version.out}}" },
    ],
  },
  {
    id: "competitor-deep",
    emoji: "🔍",
    label: "[平行] 競品深度分析(三角度同跑)",
    description: "技術 / 行銷 / 財務三角度同時分析,最後綜合報告",
    steps: [
      { id: "intel", agentId: "marketing-trend-researcher",
        prompt: "蒐集以下競品的公開資訊:產品線、定位、客群、價格、優勢、近一年動態。\n\n{{out}}" },
      { id: "tech_angle", agentId: "engineering-software-architect", dependsOn: ["intel"],
        prompt: "從技術 / 產品架構角度,評估以下競品的強弱項與護城河:\n\n{{intel.out}}" },
      { id: "marketing_angle", agentId: "marketing-content-creator", dependsOn: ["intel"],
        prompt: "從行銷敘事角度,分析以下競品的故事、定位、情感連結:\n\n{{intel.out}}" },
      { id: "finance_angle", agentId: "finance-financial-analyst", dependsOn: ["intel"],
        prompt: "從財務 / 商業模式角度,推估以下競品的獲利結構與可持續性:\n\n{{intel.out}}" },
      { id: "synthesis", agentId: "strategy-business-strategist", dependsOn: ["tech_angle", "marketing_angle", "finance_angle"],
        prompt: "綜合以下三方分析,輸出一份兩頁戰略 brief(對手地圖 + 我方切入機會):\n\n## 技術\n{{tech_angle.out}}\n\n## 行銷\n{{marketing_angle.out}}\n\n## 財務\n{{finance_angle.out}}" },
    ],
  },
  {
    id: "broker-client-onboarding",
    emoji: "📋",
    label: "[仲介] 新客戶 onboarding",
    description: "需求釐清 → 合規檢查 → 合約準備 → 報價(法務檢查暫停等批准)",
    steps: [
      { id: "intake", agentId: "sales-coach",
        prompt: "請列出針對外勞仲介客戶的 onboarding 訪問題目(8-10 題),涵蓋:行業、人力需求、預算、時程、合規要求。" },
      { id: "compliance", agentId: "legal-contract-reviewer", dependsOn: ["intake"], pauseBefore: true,
        prompt: "依以下訪問結果,檢查是否符合就業服務法、外國人聘僱許可辦法,並標出風險點:\n\n{{intake.out}}" },
      { id: "contract", agentId: "legal-contract-reviewer", dependsOn: ["compliance"],
        prompt: "依以下合規檢查結果,起草一份簡版合作合約大綱(雙方義務、計費、終止):\n\n{{compliance.out}}" },
      { id: "quote", agentId: "finance-financial-analyst", dependsOn: ["compliance"],
        prompt: "依以下合規結果與市場行情,給出 3 種報價方案(精簡 / 標準 / 完整):\n\n{{compliance.out}}" },
    ],
  },
  {
    id: "viral-postmortem",
    emoji: "📈",
    label: "爆款貼文事後分析",
    description: "拆解一篇爆紅貼文 → 提煉公式 → 套用新主題",
    steps: [
      { id: "deconstruct", agentId: "marketing-trend-researcher",
        prompt: "請拆解以下這篇爆款貼文成功的元素:標題鉤子、結構、情緒峰值、CTA。\n\n{{out}}" },
      { id: "formula", agentId: "marketing-content-creator", dependsOn: ["deconstruct"],
        prompt: "根據以下拆解,提煉成可重複的「公式 / 模板」(包含:鉤子句型、敘事節奏、開放結尾):\n\n{{deconstruct.out}}" },
      { id: "apply", agentId: "marketing-content-creator", dependsOn: ["formula"],
        prompt: "用以下公式,套到我下個主題上,寫一篇新貼文。我的下個主題:[請填]\n\n公式:\n{{formula.out}}" },
    ],
  },
  {
    id: "course-launch",
    emoji: "🎓",
    label: "[平行] 線上課程 launch 套組",
    description: "市場研究 + 大綱 + 銷售頁 + 預售文案 + email 序列(平行起跑)",
    steps: [
      { id: "research", agentId: "marketing-trend-researcher",
        prompt: "搜尋以下課程主題目前在中文圈的競品、定價、痛點、學員樣貌:\n\n{{out}}" },
      { id: "syllabus", agentId: "academic-study-planner", dependsOn: ["research"],
        prompt: "依以下市場研究,設計 8 週大綱(每週主題 + 學習成果 + 作業):\n\n{{research.out}}" },
      { id: "sales_page", agentId: "marketing-content-creator", dependsOn: ["syllabus"],
        prompt: "為以下大綱寫一份 1500 字銷售頁文案(痛點 → 解方 → 學員成果 → 講師信任 → 加入 CTA):\n\n{{syllabus.out}}" },
      { id: "email_seq", agentId: "marketing-content-creator", dependsOn: ["syllabus"],
        prompt: "為以下大綱設計 5 封預售 email 序列(各 200 字內,主題行 + 內文):\n\n{{syllabus.out}}" },
      { id: "social_teaser", agentId: "Instagram 策展师", dependsOn: ["sales_page"],
        prompt: "從以下銷售頁提煉 3 篇 IG 預熱貼文(各 300 字內,鉤子 + 故事 + CTA):\n\n{{sales_page.out}}" },
    ],
  },
  {
    id: "code-pr-review",
    emoji: "🔬",
    label: "[平行] Code PR 三角度審查",
    description: "結構 + 安全 + 效能 同時審,最後合併建議(取代之前的線性版)",
    steps: [
      { id: "structure", agentId: "engineering-code-reviewer",
        prompt: "請審以下程式碼的結構(命名、抽象、責任分離、測試覆蓋):\n\n{{out}}" },
      { id: "security", agentId: "engineering-security-engineer",
        prompt: "請對以下程式碼做安全審查(input validation、injection、auth、敏感資料):\n\n{{out}}" },
      { id: "performance", agentId: "engineering-performance-benchmarker",
        prompt: "請指出以下程式碼的效能瓶頸與改善建議(熱點函數、N+1、不必要 IO):\n\n{{out}}" },
      { id: "merged_review", agentId: "engineering-software-architect", dependsOn: ["structure", "security", "performance"],
        prompt: "請整合以下三方審查意見,給出一份優先級排序的修改清單(P0/P1/P2):\n\n## 結構\n{{structure.out}}\n\n## 安全\n{{security.out}}\n\n## 效能\n{{performance.out}}" },
    ],
  },
  {
    id: "weekly-newsletter",
    emoji: "📰",
    label: "週報 / Newsletter 自動化",
    description: "蒐集 → 篩選 → 撰稿 → 排版 預覽",
    steps: [
      { id: "collect", agentId: "marketing-trend-researcher",
        prompt: "找出本週(中文圈)我這個領域的 5-10 個值得關注的事件 / 文章 / 觀點,附來源連結。" },
      { id: "curate", agentId: "marketing-content-creator", dependsOn: ["collect"],
        prompt: "從以下清單挑出最值得讀者花時間看的 3-5 個,排序並寫一句話導讀:\n\n{{collect.out}}" },
      { id: "draft", agentId: "marketing-content-creator", dependsOn: ["curate"],
        prompt: "把以下精選內容寫成一封 newsletter(800 字內,有溫度、口語、附我的觀察):\n\n{{curate.out}}" },
    ],
  },
  {
    id: "client-pitch-prep",
    emoji: "🎤",
    label: "客戶 pitch 準備(暫停批准 + Loop)",
    description: "了解客戶 → 草擬簡報 → 我審 → 模擬問答",
    steps: [
      { id: "research", agentId: "sales-coach",
        prompt: "請整理以下客戶的公開資訊與痛點推測(行業、規模、近期動態、決策者風格):\n\n{{out}}" },
      { id: "deck", agentId: "marketing-content-creator", dependsOn: ["research"], pauseBefore: true,
        prompt: "依以下客戶分析,擬一份 8 頁 pitch 大綱(問題 / 我們的視角 / 解法 / 案例 / 報價 / next step):\n\n{{research.out}}" },
      { id: "qa", agentId: "sales-coach", dependsOn: ["deck"],
        prompt: "請列出客戶可能問的 10 個尖銳問題與建議回答:\n\n{{deck.out}}" },
    ],
  },
  {
    id: "blank",
    emoji: "✏️",
    label: "空白(自己設計)",
    description: "從零開始",
    steps: [{ agentId: "", prompt: "" }],
  },
];
