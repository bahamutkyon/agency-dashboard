import { useEffect, useState } from "react";
import {
  getTheme, setTheme as saveTheme, type Theme,
  getFont, setFont as saveFont, type FontSize,
} from "../lib/settings";
import {
  notifSupported, notifPref, setNotifPref, ensureNotifPermission,
} from "../lib/notifications";
import { resetTour } from "../lib/tour";
import { api, type NotifierStatus } from "../lib/api";

export function SettingsPanel() {
  const [theme, setTheme] = useState<Theme>(getTheme());
  const [font, setFont] = useState<FontSize>(getFont());
  const [notif, setNotif] = useState<boolean>(notifPref());
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(
    notifSupported() ? Notification.permission : "denied"
  );

  // Telegram 推播狀態
  const [tgStatus, setTgStatus] = useState<NotifierStatus | null>(null);
  const [tgToken, setTgToken] = useState("");
  const [tgBusy, setTgBusy] = useState<"save" | "discover" | "test" | null>(null);
  const [tgMsg, setTgMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => { saveTheme(theme); }, [theme]);
  useEffect(() => { saveFont(font); }, [font]);
  useEffect(() => { setNotifPref(notif); }, [notif]);

  // 載入 Telegram 狀態
  useEffect(() => {
    api.notifierStatus().then(setTgStatus).catch(() => {});
  }, []);

  const enableNotif = async () => {
    const p = await ensureNotifPermission();
    setNotifPerm(p);
    if (p === "granted") setNotif(true);
  };

  const refreshTg = () => api.notifierStatus().then(setTgStatus).catch(() => {});

  const saveTgToken = async () => {
    if (!tgToken) return;
    setTgBusy("save"); setTgMsg(null);
    try {
      const updated = await api.saveNotifierConfig({ botToken: tgToken });
      setTgStatus(updated);
      setTgToken("");
      setTgMsg({ kind: "ok", text: "Token 已儲存" });
    } catch (e: any) {
      const text = e?.message?.includes("409")
        ? "環境變數已設定，檔案設定不會生效"
        : e?.message || "儲存失敗";
      setTgMsg({ kind: "err", text });
    } finally {
      setTgBusy(null);
    }
  };

  const discoverChat = async () => {
    setTgBusy("discover"); setTgMsg(null);
    try {
      const r = await api.discoverNotifierChat();
      if (r.ok) {
        await refreshTg();
        setTgMsg({ kind: "ok", text: `已抓到：${r.from ? `${r.from} ` : ""}(Chat ID: ${r.chatId})` });
      } else {
        setTgMsg({ kind: "err", text: r.error || "抓取失敗" });
      }
    } catch (e: any) {
      setTgMsg({ kind: "err", text: e?.message || "抓取失敗" });
    } finally {
      setTgBusy(null);
    }
  };

  const testTg = async () => {
    setTgBusy("test"); setTgMsg(null);
    try {
      const r = await api.testNotifier();
      setTgMsg(r.ok
        ? { kind: "ok", text: "測試訊息已發送，請檢查你的 Telegram" }
        : { kind: "err", text: "發送失敗，請確認設定正確" }
      );
    } catch (e: any) {
      setTgMsg({ kind: "err", text: e?.message || "發送失敗" });
    } finally {
      setTgBusy(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-xl font-semibold mb-6">⚙️ 設定</h2>

        <Section title="主題">
          <div className="flex gap-2">
            <Choice active={theme === "dark"} onClick={() => setTheme("dark")} label="🌙 深色" />
            <Choice active={theme === "light"} onClick={() => setTheme("light")} label="☀️ 淺色" />
          </div>
        </Section>

        <Section title="字體大小">
          <div className="flex gap-2">
            <Choice active={font === "sm"} onClick={() => setFont("sm")} label="A 小" />
            <Choice active={font === "md"} onClick={() => setFont("md")} label="A 中" />
            <Choice active={font === "lg"} onClick={() => setFont("lg")} label="A 大" />
          </div>
        </Section>

        <Section title="桌面通知" subtitle="當 agent 回應完畢或排程觸發時提醒你(僅在你不看著畫面時才會跳)">
          {!notifSupported() && (
            <div className="text-sm text-zinc-500">此瀏覽器不支援桌面通知</div>
          )}
          {notifSupported() && notifPerm !== "granted" && (
            <button
              onClick={enableNotif}
              className="px-4 py-2 rounded bg-accent hover:bg-violet-500 text-white text-sm"
            >
              啟用桌面通知
            </button>
          )}
          {notifSupported() && notifPerm === "granted" && (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={notif}
                  onChange={(e) => setNotif(e.target.checked)}
                />
                {notif ? "已開啟" : "已停用"}
              </label>
              <span className="text-xs text-zinc-500">瀏覽器權限:已授權</span>
            </div>
          )}
          {notifPerm === "denied" && (
            <div className="text-xs text-rose-400 mt-2">
              瀏覽器已封鎖通知。需到網址列左邊的鎖頭圖示 → 通知 → 允許
            </div>
          )}
        </Section>

        <Section title="📱 Telegram 推播" subtitle="設定後 agent 完成/失敗/待批時即時推到你手機">
          {/* 三步驟說明 */}
          <div className="text-xs text-zinc-500 mb-3 space-y-0.5">
            <div>① 去 Telegram 搜尋 <code className="bg-zinc-900 px-1 rounded">@BotFather</code>，輸入 <code className="bg-zinc-900 px-1 rounded">/newbot</code> 取得 token</div>
            <div>② 把 token 貼到下方儲存</div>
            <div>③ 在 Telegram 跟你的 bot 說一句話，再按「自動抓 Chat ID」</div>
            <div className="text-zinc-400 pt-1">💬 已設定後，收到待批推播回覆「批准」會列出待批清單，再回「批准 1」確認（含只有 1 筆時）</div>
          </div>

          {/* 目前狀態 */}
          {tgStatus && (
            <div className="text-xs text-zinc-400 mb-3 flex flex-wrap gap-2">
              <span className={tgStatus.configured ? "text-green-400" : "text-zinc-500"}>
                {tgStatus.configured ? "已設定" : "尚未設定"}
                {tgStatus.source !== "none" && `（來源：${tgStatus.source === "env" ? "環境變數" : "設定檔"}）`}
              </span>
              {tgStatus.botTokenMasked && (
                <span>Token: <code className="bg-zinc-900 px-1 rounded">{tgStatus.botTokenMasked}</code></span>
              )}
              {tgStatus.chatId && (
                <span>Chat ID: <code className="bg-zinc-900 px-1 rounded">{tgStatus.chatId}</code></span>
              )}
              {tgStatus.lastResult && (
                <span className={tgStatus.lastResult.ok ? "text-green-400" : "text-rose-400"}>
                  最近推播：{tgStatus.lastResult.ok ? "成功" : `失敗（${tgStatus.lastResult.error ?? "unknown"}）`}
                </span>
              )}
            </div>
          )}

          {/* envLocked 提示 */}
          {tgStatus?.envLocked && (
            <div className="text-xs text-amber-400 mb-3 bg-amber-900/20 border border-amber-800 rounded px-2 py-1.5">
              已透過環境變數（TELEGRAM_BOT_TOKEN）設定，下方輸入框不會生效。如需更改請修改環境變數。
            </div>
          )}

          {/* Token 輸入 + 儲存 */}
          <div className="flex gap-2 mb-3">
            <input
              type="password"
              value={tgToken}
              onChange={(e) => setTgToken(e.target.value)}
              disabled={tgStatus?.envLocked ?? false}
              placeholder="貼上 Bot Token（例：123456789:ABCdef-xyz）"
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm placeholder:text-zinc-600 disabled:opacity-40"
            />
            <button
              onClick={saveTgToken}
              disabled={!tgToken || tgBusy === "save" || (tgStatus?.envLocked ?? false)}
              className="px-4 py-1.5 rounded bg-accent hover:bg-violet-500 text-white text-sm disabled:opacity-40 whitespace-nowrap"
            >
              {tgBusy === "save" ? "儲存中…" : "儲存"}
            </button>
          </div>

          {/* discover + test */}
          <div className="flex flex-wrap gap-2 mb-2">
            <button
              onClick={discoverChat}
              disabled={tgBusy === "discover" || !tgStatus?.botTokenMasked}
              className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-sm disabled:opacity-40"
            >
              {tgBusy === "discover" ? "抓取中…" : "自動抓 Chat ID"}
            </button>
            <button
              onClick={testTg}
              disabled={tgBusy === "test" || !tgStatus?.configured}
              className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-sm disabled:opacity-40"
            >
              {tgBusy === "test" ? "發送中…" : "發測試訊息"}
            </button>
          </div>

          {/* 提示：discover 前要先說話 */}
          {tgStatus?.botTokenMasked && !tgStatus.chatId && (
            <div className="text-xs text-amber-400 mb-2">
              請先在 Telegram 跟你的 bot 說一句話（隨便打個 hi），再按「自動抓 Chat ID」
            </div>
          )}

          {/* 操作結果訊息 */}
          {tgMsg && (
            <div className={`text-xs mt-1 ${tgMsg.kind === "ok" ? "text-green-400" : "text-rose-400"}`}>
              {tgMsg.text}
            </div>
          )}
        </Section>

        <Section title="教學引導" subtitle="想重新看一次首次使用導覽?">
          <button
            onClick={() => {
              resetTour();
              window.dispatchEvent(new Event("agency:show-tour"));
            }}
            className="px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-sm"
          >
            🎓 重新看一次教學
          </button>
        </Section>

        <Section title="關於">
          <div className="text-sm text-zinc-400 space-y-1">
            <div>專家團隊儀表板 v0.1</div>
            <div>使用你本機 Claude Code OAuth 訂閱(認證不會被夾帶分享)</div>
            <div>儀表板資料存在 <code className="bg-zinc-900 px-1 rounded text-xs">server/data/store.json</code></div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-panel border border-zinc-800 rounded-lg p-4 mb-4">
      <div className="font-medium text-sm mb-1">{title}</div>
      {subtitle && <div className="text-xs text-zinc-500 mb-3">{subtitle}</div>}
      <div className={subtitle ? "" : "mt-2"}>{children}</div>
    </div>
  );
}

function Choice({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded text-sm ${
        active ? "bg-accent text-white" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
      }`}
    >
      {label}
    </button>
  );
}
