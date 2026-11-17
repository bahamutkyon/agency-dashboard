import type { SessionRecord } from "./api";

/** 與 server/src/sessionTitles.ts 對齊。 */
export const ORCHESTRATOR_ID = "agents-orchestrator";
export const PM_TITLE = "👨‍💼 專案經理";

const AUTOMATED_PREFIXES = ["[排程", "[批次", "[workflow", "🤖 工作區設定顧問", "🤝 受派諮詢", "🛠️ 外包執行"];

/** 還沒取名的預設標題（舊版漏了專案經理的「👨‍💼 專案經理」）。 */
export function isDefaultTitle(title: string, agentId: string, agentName: string): boolean {
  return title === `${agentId} 對話`
    || title === agentName
    || title.endsWith(" 對話")
    || (agentId === ORCHESTRATOR_ID && title === PM_TITLE);
}

/** 系統自動產生的對話（排程、批次、派工子對話…），不算「你上次聊到一半」的對話。 */
export function isAutomatedTitle(title: string): boolean {
  return AUTOMATED_PREFIXES.some((p) => title.startsWith(p));
}

/** 角色顯示名：agents-orchestrator 統一叫「專案經理」（agent 檔裡叫智能體編排者，同一個人三個名字很難認）。 */
export function agentLabel(agentId: string, catalogName?: string): string {
  return agentId === ORCHESTRATOR_ID ? PM_TITLE : (catalogName || agentId);
}

/** 可「繼續」的專案經理對話：互動式、有訊息、沒被標記完成或擱置，新到舊。 */
export function pickResumable(sessions: SessionRecord[], limit: number): SessionRecord[] {
  return sessions
    .filter((x) => x.agentId === ORCHESTRATOR_ID && (x.messageCount ?? x.messages?.length ?? 0) > 0
      && !isAutomatedTitle(x.title) && x.state !== "done" && x.state !== "parked")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

/** 標題給人看：預設標題的專案經理對話顯示「（未命名對話）」。 */
export function sessionHeading(x: Pick<SessionRecord, "title" | "agentId">): string {
  return x.agentId === ORCHESTRATOR_ID && x.title === PM_TITLE ? "（未命名對話）" : x.title;
}

/** 本工作區所有互動式專案經理對話（整理畫面用，不限數量、含完成與擱置）。 */
export function interactivePm(sessions: SessionRecord[]): SessionRecord[] {
  return sessions.filter((x) => x.agentId === ORCHESTRATOR_ID && (x.messageCount ?? x.messages?.length ?? 0) > 0 && !isAutomatedTitle(x.title));
}
