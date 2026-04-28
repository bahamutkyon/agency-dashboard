// Pre-built workflow templates. Pick one as a starting point, then edit
// agent IDs (some might not exist if you uninstall some) and prompts.

import type { WorkflowStep } from "./api";

export interface WorkflowTemplate {
  id: string;
  emoji: string;
  label: string;
  description: string;
  steps: { agentId: string; prompt: string }[];
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
  {
    id: "blank",
    emoji: "✏️",
    label: "空白(自己設計)",
    description: "從零開始",
    steps: [{ agentId: "", prompt: "" }],
  },
];
