import { useState, useEffect } from "react";
import type { AutonomyRun } from "../lib/api";

const TERMINAL = ["done", "stopped", "budget_exhausted", "error"];
const INJECT_ACTIVE = ["running", "paused_for_action"];

export function AutonomyPanel({
  run,
  busy,
  onStart,
  onApprovePlan,
  onStop,
  onResume,
  onInput,
  onInject,
}: {
  run: AutonomyRun | null;
  busy: boolean;
  onStart: (goal: string) => void;
  onApprovePlan: () => void;
  onStop: () => void;
  onResume: () => void;
  onInput: (t: string) => void;
  onInject: (t: string) => Promise<boolean>;
}) {
  const [goal, setGoal] = useState("");
  const [input, setInput] = useState("");
  const [injectText, setInjectText] = useState("");
  const [expanded, setExpanded] = useState(false);
  // run 一旦進入進行中狀態，收起閒置展開狀態，確保跑完回到乾淨的一行
  useEffect(() => {
    if (run && !TERMINAL.includes(run.status)) setExpanded(false);
  }, [run?.status]);

  if (!run || TERMINAL.includes(run.status)) {
    return (
      <div className="rounded border border-zinc-700 text-xs">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between p-2 text-zinc-300 hover:text-zinc-100"
        >
          <span>🎯 自走模式</span>
          <span className="text-zinc-500">{expanded ? "▾" : "▸"}</span>
        </button>
        {expanded && (
          <div className="border-t border-zinc-700 p-2">
            <div className="mb-1 text-zinc-400">
              給一個目標，agent 會自己拆步驟、逐步執行（諮詢／工作區內動作自動進行；對外發送、花錢、破壞性動作會先問你）。
            </div>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="例如：盤點本週三大平台熱門選題並整理成提案草稿"
              className="mb-1 w-full rounded bg-zinc-900 p-2 text-zinc-100"
              rows={2}
            />
            <button
              disabled={busy || !goal.trim()}
              onClick={() => onStart(goal.trim())}
              className="rounded bg-emerald-700 px-3 py-1 text-white disabled:opacity-40"
            >
              開始自主執行
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded border border-emerald-700/50 bg-emerald-950/20 p-2 text-xs">
      <div className="mb-1 text-zinc-200">🎯 {run.goal}</div>
      <div className="mb-2 text-zinc-400">
        狀態：{run.status} · 第 {run.stepCount}/{run.maxSteps} 步
      </div>
      {run.status === "awaiting_plan_approval" && (
        <button
          disabled={busy}
          onClick={onApprovePlan}
          className="mr-2 rounded bg-sky-700 px-3 py-1 text-white disabled:opacity-40"
        >
          核可計畫並開跑
        </button>
      )}
      {run.status === "paused" && (
        <button
          disabled={busy}
          onClick={onResume}
          className="mr-2 rounded bg-sky-700 px-3 py-1 text-white"
        >
          續跑
        </button>
      )}
      {run.status === "paused_for_input" && (
        <div className="my-1 flex gap-1">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 rounded bg-zinc-900 p-1"
            placeholder="補充資訊…"
          />
          <button
            disabled={busy || !input.trim()}
            onClick={() => {
              onInput(input.trim());
              setInput("");
            }}
            className="rounded bg-sky-700 px-2 text-white"
          >
            送出
          </button>
        </div>
      )}
      {INJECT_ACTIVE.includes(run.status) && (
        <div className="my-2 flex gap-1">
          <input
            value={injectText}
            onChange={(e) => setInjectText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && injectText.trim() && !busy) {
                e.preventDefault();
                const text = injectText.trim();
                onInject(text).then((ok) => {
                  if (ok) setInjectText("");
                });
              }
            }}
            className="flex-1 rounded bg-zinc-900 p-1 text-xs"
            placeholder="插話給 agent（Enter 送出）…"
          />
          <button
            disabled={busy || !injectText.trim()}
            onClick={() => {
              const text = injectText.trim();
              onInject(text).then((ok) => {
                if (ok) setInjectText("");
              });
            }}
            className="rounded bg-amber-700 px-2 text-white text-xs disabled:opacity-40"
          >
            插話
          </button>
        </div>
      )}
      <button
        disabled={busy}
        onClick={onStop}
        className="rounded bg-rose-800 px-3 py-1 text-white"
      >
        喊停
      </button>
    </div>
  );
}
