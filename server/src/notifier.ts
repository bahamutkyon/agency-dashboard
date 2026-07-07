/**
 * notifier.ts — Telegram 推播（員工化待辦：交辦完成/失敗、待批動作 → 推到你手機）
 *
 * 設定方式（擇一，env 優先）：
 * 1. 設定檔（推薦，免碰環境變數）：`server/data/notifier.json`
 *    { "botToken": "123:abc", "chatId": "42" }
 *    chatId 可留空 → 跟 bot 說一句話後打 POST /api/system/notifier/discover-chat 自動抓取並寫回。
 *    data/ 已在 .gitignore，token 不會進公開 repo。
 * 2. 環境變數：TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID。
 *
 * 設計原則：
 * - fail-safe：notify() 絕不拋錯、絕不阻塞呼叫端主流程（呼叫端一律 fire-and-forget）。
 * - 設定在呼叫時讀（非模組載入時），改檔/改 env 立即生效、測試可控。
 * - 10 秒逾時，不重試——推播丟了就丟了，比卡住主流程好。
 */
import fs from "node:fs";
import path from "node:path";

export interface NotifyEvent {
  kind: string;    // 事件類別，如「交辦完成」「交辦失敗」「待批」
  title: string;   // 一句話主旨
  body?: string;   // 細節（可省略）
}

const TG_TEXT_LIMIT = 4096;
const TIMEOUT_MS = 10_000;

// 設定檔路徑。測試環境預設停用（""），避免讀到開發機上真實的 notifier.json；
// 測試可用 _setNotifierConfigPathForTest 指到暫存檔。
const DEFAULT_CONFIG_PATH = process.env.VITEST
  ? ""
  : path.join(process.cwd(), "data", "notifier.json");
let configPath = DEFAULT_CONFIG_PATH;
export function _setNotifierConfigPathForTest(p: string): void { configPath = p; }

function readFileConfig(): { token?: string; chatId?: string } {
  if (!configPath) return {};
  try {
    const j = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return {
      token: typeof j.botToken === "string" ? j.botToken.trim() : undefined,
      chatId: j.chatId != null && String(j.chatId).trim() ? String(j.chatId).trim() : undefined,
    };
  } catch {
    return {}; // 檔案不存在或格式壞 → 視為未設定
  }
}

function readConfig(): { token: string; chatId: string } | null {
  const file = readFileConfig();
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() || file.token;
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim() || file.chatId;
  if (!token || !chatId) return null;
  return { token, chatId };
}

/** 只拿 token（chatId 可能還沒設，discover 流程用） */
function readToken(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || readFileConfig().token;
}

export function isNotifierConfigured(): boolean {
  return readConfig() !== null;
}

function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export interface NotifierStatus {
  configured: boolean;
  source: "env" | "file" | "none";
  botTokenMasked: string | null;
  chatId: string | null;
  envLocked: boolean;
  lastResult: ReturnType<typeof getNotifierLastResult>;
}

/** 回傳給前端的狀態——絕不含完整 token */
export function getNotifierStatus(): NotifierStatus {
  const envToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const envChatId = process.env.TELEGRAM_CHAT_ID?.trim();
  const envLocked = !!(envToken || envChatId);

  const fileConfig = readFileConfig();
  const token = envToken || fileConfig.token;
  const chatId = envChatId || fileConfig.chatId;

  let source: "env" | "file" | "none";
  if (envToken || envChatId) {
    source = "env";
  } else if (fileConfig.token || fileConfig.chatId) {
    source = "file";
  } else {
    source = "none";
  }

  return {
    configured: !!(token && chatId),
    source,
    botTokenMasked: token ? maskToken(token) : null,
    chatId: chatId ?? null,
    envLocked,
    lastResult: getNotifierLastResult(),
  };
}

export interface WriteConfigResult {
  ok: boolean;
  error?: string;
  status?: NotifierStatus;
}

/**
 * 寫入或合併 server/data/notifier.json。
 * - 給值 → 更新該欄位；空字串 → 清除該欄位；undefined → 不動該欄位。
 * - 回傳 ok:true + 最新 NotifierStatus（供路由直接回給前端）。
 */
export function writeNotifierConfig(patch: { botToken?: string; chatId?: string }): WriteConfigResult {
  if (!configPath) {
    return { ok: false, error: "設定檔路徑未設定（測試環境）" };
  }
  try {
    let existing: Record<string, unknown> = {};
    try { existing = JSON.parse(fs.readFileSync(configPath, "utf8")); } catch { /* 新檔 */ }

    const updated: Record<string, unknown> = { ...existing };

    if (patch.botToken !== undefined) {
      if (patch.botToken === "") {
        delete updated.botToken;
      } else {
        updated.botToken = patch.botToken;
      }
    }

    if (patch.chatId !== undefined) {
      if (patch.chatId === "") {
        delete updated.chatId;
      } else {
        updated.chatId = patch.chatId;
      }
    }

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(updated, null, 2), "utf8");
    return { ok: true, status: getNotifierStatus() };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** 最近一次發送結果（給 /api/system/notifier 觀測用；不持久化） */
let lastResult: { ok: boolean; at: number; error?: string } | null = null;
export function getNotifierLastResult() { return lastResult; }
export function _resetNotifierForTest() { lastResult = null; configPath = DEFAULT_CONFIG_PATH; }

export async function notify(evt: NotifyEvent): Promise<boolean> {
  const cfg = readConfig();
  if (!cfg) return false;
  const text = `【${evt.kind}】${evt.title}${evt.body ? `\n${evt.body}` : ""}`.slice(0, TG_TEXT_LIMIT);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    timer.unref?.();
    const resp = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.chatId, text }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const ok = !!(resp as any)?.ok;
    lastResult = { ok, at: Date.now(), error: ok ? undefined : `HTTP ${(resp as any)?.status}` };
    return ok;
  } catch (e: any) {
    lastResult = { ok: false, at: Date.now(), error: e?.message || String(e) };
    console.warn(`[notifier] Telegram 推播失敗：${lastResult.error}`);
    return false;
  }
}

export interface DiscoverResult {
  ok: boolean;
  chatId?: string;
  from?: string;   // 該 chat 的顯示名稱，方便確認抓對人
  error?: string;
}

/**
 * 自動抓 chat id：用 token 打 getUpdates，取最新一則訊息的 chat.id 並寫回設定檔。
 * 前置：使用者已在 Telegram 跟 bot 說過至少一句話（否則 getUpdates 是空的）。
 */
export async function discoverChatId(): Promise<DiscoverResult> {
  const token = readToken();
  if (!token) {
    return { ok: false, error: "尚未設定 bot token——請先在 data/notifier.json 填入 botToken（或設 TELEGRAM_BOT_TOKEN）" };
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    timer.unref?.();
    const resp = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { signal: ctrl.signal });
    clearTimeout(timer);
    const j: any = await (resp as any).json();
    if (j?.ok !== true) {
      // token 錯 / 未授權等——把 Telegram 的錯誤原話帶回，別誤導成「沒訊息」
      return { ok: false, error: `Telegram 回應錯誤：${j?.description || `HTTP ${(resp as any)?.status}`}（多半是 botToken 貼錯）` };
    }
    const updates: any[] = Array.isArray(j?.result) ? j.result : [];
    // 由新到舊找第一個帶 chat.id 的訊息（含 edited_message / channel_post 容錯）
    for (let i = updates.length - 1; i >= 0; i--) {
      const msg = updates[i]?.message ?? updates[i]?.edited_message ?? updates[i]?.channel_post;
      const chat = msg?.chat;
      if (chat?.id != null) {
        const chatId = String(chat.id);
        const from = chat.first_name || chat.title || chat.username || "";
        // 寫回設定檔（保留既有欄位、只更新 chatId）；寫失敗不影響回傳結果。
        // 注意：絕不把 resolved token 寫進檔案——token 可能來自環境變數，
        // 機密不落地（檔案裡本來有 botToken 就保留，沒有就維持沒有）。
        if (configPath) {
          try {
            let existing: Record<string, unknown> = {};
            try { existing = JSON.parse(fs.readFileSync(configPath, "utf8")); } catch {}
            fs.mkdirSync(path.dirname(configPath), { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({ ...existing, chatId }, null, 2), "utf8");
          } catch (e: any) {
            console.warn(`[notifier] 寫回設定檔失敗：${e?.message}`);
          }
        }
        return { ok: true, chatId, from };
      }
    }
    return { ok: false, error: "getUpdates 沒有任何訊息——請先在 Telegram 跟你的 bot 說一句話（隨便打個 hi），再按一次" };
  } catch (e: any) {
    return { ok: false, error: `連 Telegram 失敗：${e?.message || String(e)}` };
  }
}
