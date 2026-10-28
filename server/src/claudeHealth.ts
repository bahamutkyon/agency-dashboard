/**
 * claudeHealth.ts —— Claude CLI 登入健康度監測（集中判讀所有 claude 呼叫的結果）。
 *
 * 起因（真實事故，2026-09-02 起約 7 週）：這台電腦上 Claude Code 的 OAuth 登入過期且無法
 * 自動刷新，dashboard 每次 spawn 的 claude 都回「Failed to authenticate: OAuth session expired
 * and could not be refreshed」。但各子系統各自吞錯——每日簡報記成 parse_failed、每週能力學習
 * 記成 done（failed 欄只寫 claude exit 1）、用量表記成 0 token 的「成功回合」——所有 AI 功能
 * 停擺，卻沒有一處清楚告訴使用者「是登入掉了、這樣修」。
 *
 * 這裡把判讀集中：
 *  - 任何呼叫回報明確的登入錯誤 → 狀態轉 auth_failed：推一次 Telegram（附修復步驟）、
 *    前端顯示紅色橫幅。
 *  - 之後任何一次成功 → 轉回 ok，推一次「已恢復」。
 *  - 只認明確的登入錯誤字樣（窄比對）；逾時、工具錯誤、模型錯誤一律不動登入狀態。
 */
import { notify as realNotify, type NotifyEvent } from "./notifier.js";

export type ClaudeHealthStatus = "unknown" | "ok" | "auth_failed";

export interface ClaudeHealth {
  status: ClaudeHealthStatus;
  /** 進入目前狀態的時間（ms epoch）；unknown 時為 null。 */
  since: number | null;
  lastOkAt: number | null;
  lastErrorAt: number | null;
  /** 最近一次登入錯誤原文（最多 300 字）。 */
  lastError: string | null;
  /** 進入 auth_failed 後累計的失敗呼叫次數。 */
  failures: number;
  /** 修復步驟（僅 auth_failed 時有值）。 */
  remedy: string | null;
  /** 最近一次主動探測的結果（開機探測／按「重新檢查」）；從未探測為 null。 */
  lastProbe: { at: number; ok: boolean; error: string | null } | null;
}

const AUTH_PATTERNS: RegExp[] = [
  /failed to authenticate/i,
  /oauth (?:session|token)[^\n]{0,60}(?:expired|revoked|invalid|could not be refreshed)/i,
  /login expired/i,
  /please run \/login/i,
  /not logged in/i,
  /invalid api key/i,
  /authentication_error/i,
  /invalid (?:bearer|authentication) (?:token|credentials)/i,
];

/** 文字是否為「明確的登入/憑證錯誤」。 */
export function isAuthFailureText(text: string | null | undefined): boolean {
  if (!text) return false;
  const s = String(text).slice(0, 4000);
  return AUTH_PATTERNS.some((re) => re.test(s));
}

export const AUTH_REMEDY = [
  "這台電腦上 Claude Code CLI 的登入已失效：dashboard 所有走 Claude 的 AI 功能（聊天、派工、每日簡報、能力學習、主題研究）都會失敗。",
  "修復（擇一）：",
  "① 開終端機執行 claude，輸入 /login 重新登入（瀏覽器授權完成即恢復，免重啟 dashboard）。",
  "② 無人值守的長期解：執行 claude setup-token 產生一年期 token，寫進專案根目錄 .env.local 的 CLAUDE_CODE_OAUTH_TOKEN=…（不要貼到聊天裡），然後重啟 dashboard。",
  "修好後在 dashboard 頂部橫幅按「重新檢查」確認。",
].join("\n");

type Notifier = (evt: NotifyEvent) => unknown;

let notifyFn: Notifier = realNotify;
let nowFn: () => number = () => Date.now();

function freshState(): ClaudeHealth {
  return { status: "unknown", since: null, lastOkAt: null, lastErrorAt: null, lastError: null, failures: 0, remedy: null, lastProbe: null };
}
let state: ClaudeHealth = freshState();

function safeNotify(evt: NotifyEvent): void {
  try {
    const r = notifyFn(evt) as any;
    if (r && typeof r.catch === "function") r.catch(() => {});
  } catch { /* 推播失敗不影響主流程 */ }
}

/** 記一次登入失敗。只有「從非失敗狀態轉入」時推播，避免每次呼叫都吵手機。 */
export function markAuthFailure(detail: string): void {
  const t = nowFn();
  state.lastErrorAt = t;
  state.lastError = String(detail || "").trim().slice(0, 300) || "（無錯誤原文）";
  if (state.status === "auth_failed") {
    state.failures++;
    return;
  }
  state.status = "auth_failed";
  state.since = t;
  state.failures = 1;
  state.remedy = AUTH_REMEDY;
  console.warn(`[claudeHealth] Claude CLI 登入失效：${state.lastError}`);
  safeNotify({
    kind: "Claude 登入失效",
    title: "dashboard 的 Claude Code 登入已失效，AI 功能停擺中",
    body: `${state.lastError}\n\n${AUTH_REMEDY}`,
  });
}

/** 記一次成功呼叫。從 auth_failed 恢復時推一次「已恢復」。 */
export function markOk(): void {
  const t = nowFn();
  const recovered = state.status === "auth_failed";
  state.lastOkAt = t;
  if (state.status !== "ok") {
    state.status = "ok";
    state.since = t;
  }
  state.failures = 0;
  state.remedy = null;
  if (recovered) {
    console.log("[claudeHealth] Claude CLI 登入已恢復");
    safeNotify({
      kind: "Claude 登入恢復",
      title: "dashboard 的 Claude Code 登入已恢復",
      body: "AI 功能恢復正常。停擺期間沒跑成的排程（每日簡報、每週學習）會在下次排程時間自動再跑；急的話可以到對應面板手動觸發。",
    });
  }
}

/**
 * 判讀一個 claude result 物件（stream-json 的 result 事件，或 `-p --output-format json` 的輸出）。
 * 非 claude 的結果（codex / gemini 的合成 result）沒有 type:"result" + is_error 布林，直接忽略。
 *
 * 判定登入失敗的條件：結果文字是登入錯誤字樣，且（is_error 為真，或整回合 0 個輸出 token）。
 * 第二個條件是保險：正常回答「剛好談到登入錯誤」一定有輸出 token，不會被誤判。
 */
export function noteClaudeResult(result: any): void {
  if (!result || typeof result !== "object") return;
  if (result.type !== "result" || typeof result.is_error !== "boolean") return;
  const text = typeof result.result === "string" ? result.result : "";
  const outTokens = Number(result.usage?.output_tokens ?? 0);
  if (isAuthFailureText(text) && (result.is_error || !outTokens)) {
    markAuthFailure(text);
    return;
  }
  if (result.is_error) return; // 其他錯誤（工具/上限/模型）與登入無關，不動狀態
  markOk();
}

/** 判讀非 JSON 的失敗輸出（stderr / 混雜文字）：只有明確是登入錯誤才轉狀態。 */
export function noteClaudeFailureText(text: string | null | undefined): void {
  if (isAuthFailureText(text)) markAuthFailure(String(text));
}

export function getClaudeHealth(): ClaudeHealth {
  return { ...state, lastProbe: state.lastProbe ? { ...state.lastProbe } : null };
}

type ProbeRunner = () => Promise<{ ok: boolean; error?: string }>;

/** 預設探測：極小的 fast 層（Haiku 家族）呼叫，只要求回 OK。動態 import 避免與 claudeOneShot 靜態循環依賴。 */
const defaultProbeRunner: ProbeRunner = async () => {
  const { runClaudeOneShot } = await import("./claudeOneShot.js");
  const { modelFor } = await import("./models.js");
  return runClaudeOneShot(
    ["-p", "--output-format", "json", "--model", modelFor("fast"), "--no-session-persistence", "--disable-slash-commands"],
    { input: "健康檢查：只回覆 OK 兩個字，不要其他內容。", timeoutMs: 90_000, source: "health" },
  );
};
let probeRunner: ProbeRunner = defaultProbeRunner;
let probeInflight: Promise<ClaudeHealth> | null = null;

/**
 * 主動探測登入狀態。結果經 runClaudeOneShot 內建的判讀更新狀態（成功→ok、登入錯誤→auth_failed），
 * 並記在 lastProbe 供前端顯示。用在開機後、定期閒置檢查、使用者按「重新檢查」。
 * 同時只跑一個：探測進行中再呼叫會拿到同一個結果，不會連點就開一堆子程序。
 */
export function probeClaudeAuth(): Promise<ClaudeHealth> {
  if (probeInflight) return probeInflight;
  probeInflight = (async () => {
    try {
      let r: { ok: boolean; error?: string };
      try { r = await probeRunner(); } catch (e: any) { r = { ok: false, error: e?.message || String(e) }; }
      state.lastProbe = { at: nowFn(), ok: r.ok, error: r.ok ? null : String(r.error || "未知錯誤").slice(0, 300) };
      return getClaudeHealth();
    } finally {
      probeInflight = null;
    }
  })();
  return probeInflight;
}

/** 定期檢查的間隔：距離上次成功呼叫超過這麼久才主動探測（平常有在用就不會多打）。 */
const MONITOR_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * 開機 15 秒後探測一次，之後每 6 小時檢查：距上次成功超過 6 小時才探測（閒置期間登入掉了也會被發現，
 * 不必等到某個排程失敗——上次登入過期整整 7 週沒人發現）。CLAUDE_HEALTH_PROBE=off 可整個關閉。
 */
export function startClaudeHealthMonitor(log: (msg: string) => void = (m) => console.log(m)): void {
  if (process.env.CLAUDE_HEALTH_PROBE === "off") return;
  const run = (why: string) => {
    probeClaudeAuth()
      .then((h) => {
        const probeNote = h.lastProbe && !h.lastProbe.ok && h.status !== "auth_failed" ? `（探測未成功但非登入問題：${h.lastProbe.error}）` : "";
        log(`[claudeHealth] ${why}探測：${h.status}${probeNote}`);
      })
      .catch((e: any) => log(`[claudeHealth] ${why}探測失敗：${e?.message || e}`));
  };
  setTimeout(() => run("開機"), 15_000).unref?.();
  setInterval(() => {
    const last = state.lastOkAt ?? 0;
    if (nowFn() - last >= MONITOR_INTERVAL_MS) run("定期");
  }, MONITOR_INTERVAL_MS).unref?.();
}

// ── 測試用 ─────────────────────────────────────────────────────────────
export function _setClaudeHealthDepsForTest(d: { notify?: Notifier; now?: () => number; probe?: ProbeRunner }): void {
  if (d.notify) notifyFn = d.notify;
  if (d.now) nowFn = d.now;
  if (d.probe) probeRunner = d.probe;
}
export function _resetClaudeHealthForTest(): void {
  state = freshState();
  notifyFn = realNotify;
  nowFn = () => Date.now();
  probeRunner = defaultProbeRunner;
  probeInflight = null;
}
