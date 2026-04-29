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
  // ---- 從 jnMetaCode/Agency-orchestrator 移植並繁中化的範本 ----

  {
    id: "douyin-tiktok-script",
    emoji: "🎬",
    label: "短影音腳本(TikTok / 抖音 / Reels)",
    description: "鉤子 → 腳本 → 字幕 → 標題",
    steps: [
      { id: "hook", agentId: "marketing-trend-researcher",
        prompt: "為以下主題想 5 個短影音開場鉤子(前 3 秒抓眼球),每個 30 字內,風格不同(衝突/反差/數字/疑問/承諾):\n\n{{out}}" },
      { id: "script", agentId: "marketing-content-creator", dependsOn: ["hook"],
        prompt: "從以下鉤子挑最有潛力的 1 個,寫成 60-90 秒短影音完整腳本(畫面分鏡 + 旁白逐字稿):\n\n{{hook.out}}" },
      { id: "captions", agentId: "marketing-content-creator", dependsOn: ["script"],
        prompt: "為以下腳本產出緊湊字幕(每行 12-15 字,符合短影音閱讀節奏):\n\n{{script.out}}" },
      { id: "titles", agentId: "marketing-content-creator", dependsOn: ["script"],
        prompt: "為以下腳本想 5 個影片標題(各 15 字內,SEO 友善 + 吸引點擊):\n\n{{script.out}}" },
    ],
  },

  {
    id: "investment-analysis",
    emoji: "💰",
    label: "[平行] 投資 / 商業機會分析",
    description: "市場 / 財務 / 技術 / 風險 四角度同跑 → 投資建議",
    steps: [
      { id: "intro", agentId: "marketing-trend-researcher",
        prompt: "請整理以下投資標的或商業機會的基本資訊:行業、規模、團隊、產品、近一年動態。\n\n{{out}}" },
      { id: "market", agentId: "strategy-business-strategist", dependsOn: ["intro"],
        prompt: "從市場角度分析:TAM、競爭強度、成長性、進入障礙。\n\n{{intro.out}}" },
      { id: "finance", agentId: "finance-financial-analyst", dependsOn: ["intro"],
        prompt: "從財務角度估算:可能營收結構、毛利、現金流、估值區間。\n\n{{intro.out}}" },
      { id: "tech", agentId: "engineering-software-architect", dependsOn: ["intro"],
        prompt: "從技術 / 護城河角度分析:核心技術、可複製性、長期競爭優勢。\n\n{{intro.out}}" },
      { id: "risk", agentId: "legal-policy-writer", dependsOn: ["intro"],
        prompt: "列出 5-7 個關鍵風險(法規、執行、市場、競爭、技術)及對應避險建議。\n\n{{intro.out}}" },
      { id: "verdict", agentId: "strategy-business-strategist", dependsOn: ["market", "finance", "tech", "risk"],
        prompt: "綜合以下四方分析,給投資建議(投/觀望/不投)+ 條件 + 監測指標:\n\n## 市場\n{{market.out}}\n\n## 財務\n{{finance.out}}\n\n## 技術\n{{tech.out}}\n\n## 風險\n{{risk.out}}" },
    ],
  },

  {
    id: "okr-decomposition",
    emoji: "🎯",
    label: "OKR 目標拆解",
    description: "個人 / 團隊年度大目標 → 季 OKR → 週任務",
    steps: [
      { id: "ambition", agentId: "strategy-business-strategist",
        prompt: "請幫我把這個年度大目標精煉成 3 個更 measurable 的 ambitions(各 30 字內):\n\n{{out}}" },
      { id: "okr", agentId: "project-management-senior-project-manager", dependsOn: ["ambition"],
        prompt: "依以下 3 個 ambitions,各設計一份季度 OKR(O 一句,KR 3-5 個都要可量化):\n\n{{ambition.out}}" },
      { id: "weekly", agentId: "project-management-senior-project-manager", dependsOn: ["okr"],
        prompt: "把以下季度 OKR 拆成 12 週的週任務清單(每週 3-5 個具體可執行 action):\n\n{{okr.out}}" },
    ],
  },

  {
    id: "pitch-deck-outline",
    emoji: "🎤",
    label: "Pitch Deck 大綱",
    description: "10 頁標準融資簡報結構",
    steps: [
      { id: "story", agentId: "marketing-content-creator",
        prompt: "為以下產品/服務發想 1 個有力的「為什麼是現在」開場故事(150 字內):\n\n{{out}}" },
      { id: "slides", agentId: "product-product-manager", dependsOn: ["story"],
        prompt: "依以下開場故事,規劃 10 頁 pitch deck 標準大綱(每頁:標題 + 核心訊息一句話 + 視覺建議):\n\n問題 / 解方 / 市場 / 產品 / 商模 / 競爭 / 進度 / 團隊 / 募資需求 / Q&A\n\n{{story.out}}" },
      { id: "qa", agentId: "sales-coach", dependsOn: ["slides"],
        prompt: "列出 10 個投資人最可能尖銳問的問題與建議回答(各 100 字內):\n\n{{slides.out}}" },
    ],
  },

  {
    id: "meeting-notes",
    emoji: "📝",
    label: "會議紀錄整理",
    description: "原始逐字稿 → 結構化會議紀錄 + 待辦",
    steps: [
      { id: "summary", agentId: "marketing-content-creator",
        prompt: "請把以下會議逐字稿濃縮成 5 個要點(每點 50 字內):\n\n{{out}}" },
      { id: "structured", agentId: "marketing-content-creator", dependsOn: ["summary"],
        prompt: "請依以下要點,結構化會議紀錄(議程 / 討論 / 決議 / 待跟進),每段條列:\n\n{{summary.out}}" },
      { id: "actions", agentId: "project-management-senior-project-manager", dependsOn: ["structured"],
        prompt: "從以下會議紀錄抽出待辦事項(誰 / 做什麼 / 何時前完成):\n\n{{structured.out}}" },
    ],
  },

  {
    id: "viral-rednote-post",
    emoji: "🔥",
    label: "小紅書爆款貼文(指定平台)",
    description: "選題 → 標題 → 內文 → 標籤 全流程",
    steps: [
      { id: "topics", agentId: "marketing-bilibili-strategist",
        prompt: "為以下主題,參考小紅書近期爆款套路(opening hook + 反差 + 乾貨),想 5 個適合的選題切角:\n\n{{out}}" },
      { id: "headline", agentId: "marketing-bilibili-strategist", dependsOn: ["topics"],
        prompt: "從以下選題挑 1 個最有爆款潛力,擬 3 種小紅書風格標題(各 20 字內,有 emoji):\n\n{{topics.out}}" },
      { id: "body", agentId: "marketing-content-creator", dependsOn: ["headline"],
        prompt: "依以下標題,寫一篇 600 字內小紅書筆記(emoji + 條列 + 親切口吻 + 結尾 CTA):\n\n{{headline.out}}" },
      { id: "tags", agentId: "marketing-content-creator", dependsOn: ["body"],
        prompt: "為以下筆記想 8-10 個小紅書話題標籤(混搭大流量 + 小眾精準):\n\n{{body.out}}" },
    ],
  },

  {
    id: "story-creation",
    emoji: "📖",
    label: "故事創作(角色 → 大綱 → 章節)",
    description: "敘事學家 + 內容創作 接力",
    steps: [
      { id: "character", agentId: "academic-narratologist",
        prompt: "依以下主題,設計 1 位主角(背景 / 性格弧線 / 內外衝突)+ 1 位反派 + 2 位配角:\n\n{{out}}" },
      { id: "outline", agentId: "academic-narratologist", dependsOn: ["character"],
        prompt: "依以下角色,設計三幕劇大綱(Setup / Confrontation / Resolution),每幕 3-5 個關鍵節拍:\n\n{{character.out}}" },
      { id: "chapter1", agentId: "marketing-content-creator", dependsOn: ["outline"],
        prompt: "依以下大綱,寫第 1 章開場(2000-3000 字,要有鉤子 + 主角登場 + 世界觀):\n\n{{outline.out}}" },
    ],
  },

  // ---- 部門協作型(adapted from department-collab) ----

  {
    id: "ceo-org-delegation",
    emoji: "🏛️",
    label: "[協作] CEO 委派多部門 SOP",
    description: "高層指令 → 拆解 → 各部門領任務 → CEO 整合",
    steps: [
      { id: "ceo_plan", agentId: "strategy-business-strategist",
        prompt: "你是 CEO 接到以下任務需求。請分析:(1) 任務本質 (2) 需要哪些部門協作(產品/工程/行銷/HR/法務/財務)(3) 每個部門的子任務 + 期限。\n\n{{out}}" },
      { id: "product_plan", agentId: "product-product-manager", dependsOn: ["ceo_plan"],
        prompt: "你是產品經理。從以下 CEO 計畫中,提取屬於產品部門的子任務,寫成 1 頁執行 brief:\n\n{{ceo_plan.out}}" },
      { id: "marketing_plan", agentId: "marketing-content-strategist", dependsOn: ["ceo_plan"],
        prompt: "你是行銷主管。從以下 CEO 計畫中,提取屬於行銷部門的子任務,寫成 1 頁執行 brief:\n\n{{ceo_plan.out}}" },
      { id: "finance_plan", agentId: "finance-financial-analyst", dependsOn: ["ceo_plan"],
        prompt: "你是財務長。從以下 CEO 計畫中,評估預算需求 + ROI 預估,寫成 1 頁財務 brief:\n\n{{ceo_plan.out}}" },
      { id: "ceo_review", agentId: "strategy-business-strategist", dependsOn: ["product_plan", "marketing_plan", "finance_plan"], pauseBefore: true,
        prompt: "你是 CEO,看完三部門 brief 後寫一份整合執行備忘錄:\n\n## 產品\n{{product_plan.out}}\n\n## 行銷\n{{marketing_plan.out}}\n\n## 財務\n{{finance_plan.out}}\n\n包含:對齊建議、優先級、風險、下次 review 時間。" },
    ],
  },

  {
    id: "incident-response",
    emoji: "🚨",
    label: "[協作] 突發事件 / 危機回應",
    description: "事實搜集 → 影響評估 → 對外溝通 → 後續改善",
    steps: [
      { id: "facts", agentId: "support-customer-responder",
        prompt: "請整理以下突發事件的已知事實(時間 / 範圍 / 受影響對象 / 目前狀態),寫成 1 頁 incident brief:\n\n{{out}}" },
      { id: "impact", agentId: "strategy-business-strategist", dependsOn: ["facts"],
        prompt: "依以下 incident brief 評估三層影響(營運 / 品牌 / 法律),最壞情境與緩解步驟:\n\n{{facts.out}}" },
      { id: "external", agentId: "marketing-content-creator", dependsOn: ["impact"],
        prompt: "撰寫對外溝通稿(中性、不卸責、提解決方案,300 字內適合社群與新聞):\n\n{{impact.out}}" },
      { id: "internal", agentId: "marketing-content-creator", dependsOn: ["impact"],
        prompt: "撰寫對內公告稿(更詳細、含後續行動 / 角色分工 / 時間軸):\n\n{{impact.out}}" },
      { id: "postmortem", agentId: "engineering-code-reviewer", dependsOn: ["external", "internal"], pauseBefore: true,
        prompt: "寫一份 post-mortem 改善計畫:根因 5-Why 分析 / 短中長期改進 / 監測指標。\n\n## 對外稿\n{{external.out}}\n\n## 對內稿\n{{internal.out}}" },
    ],
  },

  {
    id: "marketing-campaign",
    emoji: "📢",
    label: "[協作] 行銷活動全鏈路規劃",
    description: "受眾洞察 → 創意主軸 → 多平台分發 → 成效追蹤",
    steps: [
      { id: "audience", agentId: "marketing-trend-researcher",
        prompt: "依以下產品 / 服務,描繪 3 個核心目標受眾畫像(年齡 / 場景 / 痛點 / 在哪 / 觸動點):\n\n{{out}}" },
      { id: "concept", agentId: "marketing-content-strategist", dependsOn: ["audience"],
        prompt: "依以下受眾洞察,提出 1 個有記憶點的 campaign 主軸 + slogan + 視覺 mood:\n\n{{audience.out}}" },
      { id: "ig_plan", agentId: "Instagram 策展师", dependsOn: ["concept"],
        prompt: "把以下主軸落地成 IG 排程(7 天 5 篇貼文 + 3 個 reels 主題):\n\n{{concept.out}}" },
      { id: "rednote_plan", agentId: "小红书专家", dependsOn: ["concept"],
        prompt: "把以下主軸落地成小紅書排程(7 天 4 篇深度筆記 + 標籤策略):\n\n{{concept.out}}" },
      { id: "yt_plan", agentId: "marketing-content-creator", dependsOn: ["concept"],
        prompt: "把以下主軸落地成 YouTube 內容矩陣(2 支長片主題 + 6 支 Shorts 切片):\n\n{{concept.out}}" },
      { id: "kpi", agentId: "marketing-content-strategist", dependsOn: ["ig_plan", "rednote_plan", "yt_plan"],
        prompt: "依以下三平台計畫,設計 KPI 儀表板(每平台 3-5 指標)+ 每週檢視節奏:\n\n## IG\n{{ig_plan.out}}\n\n## 小紅書\n{{rednote_plan.out}}\n\n## YT\n{{yt_plan.out}}" },
    ],
  },

  {
    id: "hiring-pipeline",
    emoji: "👥",
    label: "[協作] 招聘 / 客戶接案 pipeline",
    description: "需求釐清 → 篩選條件 → JD/Brief → 面試題 → 評分表",
    steps: [
      { id: "intake", agentId: "hr-recruiter",
        prompt: "依以下職缺 / 接案需求,釐清 5 個關鍵 must-have 條件 + 5 個 nice-to-have:\n\n{{out}}" },
      { id: "jd", agentId: "marketing-content-creator", dependsOn: ["intake"],
        prompt: "依以下條件撰寫 JD / 接案需求書(吸引人 + 具體 + 含薪資 / 報酬範圍):\n\n{{intake.out}}" },
      { id: "screening", agentId: "hr-recruiter", dependsOn: ["intake"],
        prompt: "設計初篩 5 道題目 + 評分標準(每題 0-3 分):\n\n{{intake.out}}" },
      { id: "interview", agentId: "hr-recruiter", dependsOn: ["intake"],
        prompt: "設計面試 / 詢價對談 流程:5 道情境題 + 5 道專業題 + 4 個觀察重點:\n\n{{intake.out}}" },
      { id: "scorecard", agentId: "hr-recruiter", dependsOn: ["screening", "interview"],
        prompt: "整合成一頁招聘評分表(欄位:候選人 / 各題分數 / 總分 / 主觀評語 / 決策),格式 Markdown 表格:\n\n## 初篩\n{{screening.out}}\n\n## 面試\n{{interview.out}}" },
    ],
  },

  {
    id: "content-publish",
    emoji: "✅",
    label: "[協作] 內容發佈前完整審稿",
    description: "事實 → 品牌 → 法務 → SEO 四層審查",
    steps: [
      { id: "fact", agentId: "engineering-code-reviewer",
        prompt: "請對以下內容做事實/數據查核(列出可疑陳述 + 建議查證來源),不修改原文:\n\n{{out}}" },
      { id: "brand", agentId: "design-brand-guardian",
        prompt: "請對以下內容做品牌語氣審查(語氣是否一致 / 用字 / 禁用詞),具體標出問題段落:\n\n{{out}}" },
      { id: "legal", agentId: "legal-contract-reviewer",
        prompt: "請對以下內容做法務 / 合規檢查(智財權 / 誇大宣稱 / 個資 / 廣告法),列出風險點:\n\n{{out}}" },
      { id: "seo", agentId: "marketing-content-strategist",
        prompt: "請對以下內容做 SEO 優化建議(標題 / meta / 關鍵字密度 / 內鏈 / hashtag):\n\n{{out}}" },
      { id: "consolidate", agentId: "design-brand-guardian", dependsOn: ["fact", "brand", "legal", "seo"], pauseBefore: true,
        prompt: "整合以下四方審查意見,輸出可直接交給原作者的「修改清單」(必改 / 建議改 / 加分項):\n\n## 事實\n{{fact.out}}\n\n## 品牌\n{{brand.out}}\n\n## 法務\n{{legal.out}}\n\n## SEO\n{{seo.out}}" },
    ],
  },

  {
    id: "ai-coding-setup",
    emoji: "🛠️",
    label: "AI 編程工具諮詢與落地",
    description: "顧問推薦工具組合 → 工程師產出可貼上的配置檔 + 第一週上手清單",
    steps: [
      {
        id: "consult",
        agentId: "ai-coding-guide-consultant",
        prompt: "使用者情境如下,請給出:\n1. 推薦的工具組合(1-3 個,排序),每個附「為什麼選」與「為什麼不選備案」\n2. 每個工具需要的配置檔清單(CLAUDE.md / .cursorrules / GEMINI.md / .windsurfrules 等)\n3. 第一週的學習路徑(具體要先試什麼指令、讀本機 ai-coding-guide 哪幾篇)\n4. 預期的 3 個踩坑點\n\n使用者情境:"
      },
      {
        id: "configs",
        agentId: "engineering-codebase-onboarding-engineer",
        dependsOn: ["consult"],
        prompt: "根據以下 AI 編程工具諮詢結果,請產出可直接複製貼上的配置檔。\n\n要求:\n1. 每個推薦工具的配置檔**完整內容**(用 ```語言 程式碼框包起來,讓使用者一鍵複製)\n2. 每個檔案放在專案的相對路徑(例如 `./CLAUDE.md`、`./.cursor/rules/global.md`)\n3. 第一週 daily checklist(- [ ] 形式,每天 1-2 個 checkpoint)\n4. 一個 sanity-check 任務(讓使用者確認設定生效,例如「叫 Claude Code 讀 CLAUDE.md 並摘要,如果摘要正確就代表載入成功」)\n\n諮詢結果:\n\n{{consult.out}}"
      }
    ]
  },

  {
    id: "blank",
    emoji: "✏️",
    label: "空白(自己設計)",
    description: "從零開始",
    steps: [{ agentId: "", prompt: "" }],
  },
];
