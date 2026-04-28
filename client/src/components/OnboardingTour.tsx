import { useEffect, useLayoutEffect, useState } from "react";
import { markTourDone } from "../lib/tour";

interface TourStep {
  selector?: string;
  title: string;
  body: string;
  placement?: "top" | "bottom" | "left" | "right" | "center";
}

const STEPS: TourStep[] = [
  {
    title: "👋 歡迎來到專家團隊儀表板",
    body: "211 位 AI 專家已就緒。花 30 秒看一下核心功能,之後想重看可以從「⚙️ 設定」叫出。",
    placement: "center",
  },
  {
    selector: "[data-tour=orchestrator-btn]",
    title: "👨‍💼 不知從何開始?",
    body: "點「找專案經理討論」,跟 AI 對話釐清需求,它會從 211 位專家中推薦合適的團隊。",
    placement: "right",
  },
  {
    selector: "[data-tour=batch-btn]",
    title: "🎯 批次同題",
    body: "同個指令派給多位 agent 同時做,並排比較結果。完成後可一鍵合併出最佳版本。",
    placement: "right",
  },
  {
    selector: "[data-tour=workflow-btn]",
    title: "🔗 自動接力流水線",
    body: "設定 N 步驟,前一步輸出自動傳給下一步。讓專案經理幫你設計,或從範本起手。",
    placement: "right",
  },
  {
    selector: "[data-tour=agent-search]",
    title: "🔍 直接找 agent",
    body: "搜尋 agent 名字,或用上方部門按鈕過濾。點任何一位開新對話 tab。",
    placement: "right",
  },
  {
    selector: "[data-tour=workspace-switcher]",
    title: "🗂️ 工作區隔離",
    body: "不同專案分開,每個工作區有自己的「📝 專案備忘錄」,自動注入給該工作區所有 agent — 你不用每次重講。",
    placement: "bottom",
  },
  {
    title: "⌨️ 鍵盤快捷鍵",
    body: "Ctrl+K 開全域搜尋(功能/agent/過往對話) · Ctrl+B 收合側欄 · 對話框打 / 叫出 prompt 模板",
    placement: "center",
  },
  {
    title: "✅ 準備好了",
    body: "去點「找專案經理討論」開始,或挑一位你想合作的 agent。需要重看?設定 → 「重新看一次教學」。",
    placement: "center",
  },
];

interface Props {
  onClose: () => void;
}

export function OnboardingTour({ onClose }: Props) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cur = STEPS[step];

  useLayoutEffect(() => {
    if (!cur.selector) { setRect(null); return; }
    const el = document.querySelector(cur.selector);
    if (!el) { setRect(null); return; }
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const compute = () => setRect(el.getBoundingClientRect());
    compute();
    el.classList.add("tour-highlight");
    window.addEventListener("resize", compute);
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => {
      el.classList.remove("tour-highlight");
      window.removeEventListener("resize", compute);
      ro.disconnect();
    };
  }, [cur.selector, step]);

  // Esc to skip
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight" || e.key === "Enter") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [step]);

  const next = () => {
    if (step < STEPS.length - 1) setStep(step + 1);
    else finish();
  };
  const prev = () => { if (step > 0) setStep(step - 1); };
  const finish = () => { markTourDone(); onClose(); };

  // tooltip position
  const tooltipStyle: React.CSSProperties = {};
  if (cur.placement === "center" || !rect) {
    tooltipStyle.top = "50%";
    tooltipStyle.left = "50%";
    tooltipStyle.transform = "translate(-50%, -50%)";
  } else {
    const margin = 14;
    const w = 360;
    if (cur.placement === "right") {
      tooltipStyle.top = Math.max(20, rect.top + rect.height / 2 - 80);
      tooltipStyle.left = Math.min(window.innerWidth - w - 20, rect.right + margin);
    } else if (cur.placement === "left") {
      tooltipStyle.top = Math.max(20, rect.top + rect.height / 2 - 80);
      tooltipStyle.left = Math.max(20, rect.left - w - margin);
    } else if (cur.placement === "bottom") {
      tooltipStyle.top = rect.bottom + margin;
      tooltipStyle.left = Math.max(20, Math.min(window.innerWidth - w - 20, rect.left + rect.width / 2 - w / 2));
    } else {
      tooltipStyle.top = Math.max(20, rect.top - 200);
      tooltipStyle.left = Math.max(20, Math.min(window.innerWidth - w - 20, rect.left + rect.width / 2 - w / 2));
    }
    tooltipStyle.width = w;
  }

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-[2px]" onClick={finish} />
      <div
        className="fixed z-[110] bg-panel border border-accent rounded-lg shadow-2xl p-5"
        style={tooltipStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-base font-semibold mb-2">{cur.title}</div>
        <div className="text-sm text-zinc-300 mb-4 leading-relaxed">{cur.body}</div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full ${i === step ? "bg-accent" : i < step ? "bg-accent/40" : "bg-zinc-700"}`}
              />
            ))}
            <span className="ml-2 text-xs text-zinc-500">{step + 1} / {STEPS.length}</span>
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <button onClick={prev} className="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700">上一步</button>
            )}
            <button onClick={finish} className="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400">
              {step === STEPS.length - 1 ? "" : "跳過"}
            </button>
            <button onClick={next} className="text-xs px-3 py-1.5 rounded bg-accent hover:bg-violet-500 text-white">
              {step === STEPS.length - 1 ? "完成" : "下一步 →"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
