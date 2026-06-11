/**
 * SQLite-backed store. 對外 API 完全不變——只是把實作按領域拆進 store/ 目錄,
 * 這個檔現在是統一匯出口(barrel),所有既有 `import { ... } from "./store.js"`
 * / `"../store.js"` 不用改。
 *
 * 領域檔:
 *   store/types.ts      — 共用型別與常數
 *   store/helpers.ts    — parseTags 等小工具
 *   store/workspaces.ts — 工作區 + agent 記憶
 *   store/sessions.ts   — session / 訊息
 *   store/schedules.ts  — 排程
 *   store/templates.ts  — prompt 範本
 *   store/notes.ts      — 筆記
 *   store/workflows.ts  — workflow + run
 *   store/search.ts     — 搜尋 + 標籤聚合
 *   store/usage.ts      — 用量 / rate limit
 */
export * from "./store/types.js";
export * from "./store/workspaces.js";
export * from "./store/sessions.js";
export * from "./store/schedules.js";
export * from "./store/templates.js";
export * from "./store/notes.js";
export * from "./store/workflows.js";
export * from "./store/search.js";
export * from "./store/usage.js";
export { DEFAULT_WORKSPACE_ID } from "./db.js";
