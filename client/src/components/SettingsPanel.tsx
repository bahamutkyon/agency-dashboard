import { useEffect, useState } from "react";
import {
  getTheme, setTheme as saveTheme, type Theme,
  getFont, setFont as saveFont, type FontSize,
} from "../lib/settings";
import {
  notifSupported, notifPref, setNotifPref, ensureNotifPermission,
} from "../lib/notifications";
import { resetTour } from "../lib/tour";

export function SettingsPanel() {
  const [theme, setTheme] = useState<Theme>(getTheme());
  const [font, setFont] = useState<FontSize>(getFont());
  const [notif, setNotif] = useState<boolean>(notifPref());
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(
    notifSupported() ? Notification.permission : "denied"
  );

  useEffect(() => { saveTheme(theme); }, [theme]);
  useEffect(() => { saveFont(font); }, [font]);
  useEffect(() => { setNotifPref(notif); }, [notif]);

  const enableNotif = async () => {
    const p = await ensureNotifPermission();
    setNotifPerm(p);
    if (p === "granted") setNotif(true);
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
