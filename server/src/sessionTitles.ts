/** 專案經理（agents-orchestrator）的 id 與新對話預設標題。 */
export const ORCHESTRATOR_ID = "agents-orchestrator";
export const ORCHESTRATOR_TITLE = "👨‍💼 專案經理";

const AUTOMATED_PREFIXES = ["[排程", "[批次", "[workflow"];

/**
 * 標題是不是「還沒取名」的預設值（auto-titler 才會替它取名）。
 * 舊版散在三處、都漏了專案經理的預設標題「👨‍💼 專案經理」——它跟 agent 檔名「智能體編排者」
 * 對不上，被當成自訂標題略過，所以專案經理對話在歷史裡全都只叫「專案經理」。
 */
export function isDefaultTitle(title: string, agentId: string, agentName: string): boolean {
  if (AUTOMATED_PREFIXES.some((p) => title.includes(p))) return false;
  return title === `${agentId} 對話`
    || title === agentName
    || title.endsWith(" 對話")
    || (agentId === ORCHESTRATOR_ID && title === ORCHESTRATOR_TITLE);
}

/** auto-titler 產生的標題要不要加 agent 名前綴。專案經理不加，標題直接點題。 */
export function displayTitle(rawTitle: string, agentId: string, agentName: string): string {
  if (agentId === ORCHESTRATOR_ID) return rawTitle;
  return rawTitle.includes(agentName) ? rawTitle : `${agentName} · ${rawTitle}`;
}
