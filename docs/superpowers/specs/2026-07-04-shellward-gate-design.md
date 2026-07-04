# shellward 強制化（PreToolUse Gate）設計規格

- 日期：2026-07-04
- 狀態：設計已確認（使用者選 shadow 模式先上），實作中
- 由 Fable 研究 + 實測驗證，Opus 把關

## 背景
agent 用 `claude -p --permission-mode bypassPermissions` spawn（`-p` 下 MCP 工具會 auto-deny，故放開所有工具含 Bash）。shellward 目前只是 agent「可自願呼叫」的 MCP，**非強制**；被 prompt injection 的 agent 可跳過守門人直接跑危險指令；缺 shellward 時 fail-open。

## 已驗證的關鍵事實（Fable 實測）
- **PreToolUse hook 的 deny 在 `bypassPermissions` 下有效**（實測：deny hook 擋下指令、agent 如實回報未執行）。這是方案成立前提，已成立。
- claude 的 `http`/`mcp_tool` hook type 在失敗時 **fail-open**（工具照跑）→ 不能用來 fail-closed。只有 `command` type hook 能在腳本內兜底 fail-closed。
- shellward 是 stdio MCP（`shellward-mcp`，env `SHELLWARD_MODE=enforce/THRESHOLD=60`），**無 CLI 檢查模式**。`check_command` 回 `{safe:bool, level, reason, rule_id}`（布林裁決）。冷啟動 ~80ms。
- PreToolUse stdin：`{ tool_name, tool_input:{command|file_path}, cwd, session_id, ... }`。deny 回法：exit 0 + stdout `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}`（reason 回饋 agent）。

## 方案（C：dashboard 代理 + 常駐 shellward 連線）
```
spawn claude --settings <hooks檔> ─→ PreToolUse(Bash) 觸發
  hook 腳本 shellward-gate.mjs ─POST─→ dashboard /api/guard/check (127.0.0.1, boot-token)
      server 端常駐 shellwardClient（stdio JSON-RPC，斷線重連）→ check_command
      safe:true→allow(exit0 無輸出) ；safe:false 或任何失敗→deny(帶 reason)
```
**選 C 不選「hook 直接 spawn shellward」**：避開 hook 子行程 PATH 漂移脆弱點（本專案自啟踩過）、攔截集中回 server 可上 SecurityBadge、模式一處切換。

## Fail-closed 全鏈
shellward 連不上 / endpoint 打不到/非2xx/逾時 / 腳本任何異常 → **一律 deny**（腳本 `uncaughtException`→deny+exit0；內部 3s timeout 短於 hook 10s timeout）。殘餘缺口：settings 驗證失敗會被 claude 靜默忽略→hook 沒掛上=fail-open；用「session 有 Bash 活動卻零 check→UI 告警」補償偵測（無法 100% 閉合，誠實記錄）。

## 模式與逃生開關
- `SHELLWARD_GATE=off`（server env）→ 不注入 `--settings`（走既有 force-respawn 生效）。
- `SHELLWARD_GATE_MODE=shadow|enforce`（server 一處切換）：**預設 shadow**（照檢查照記錄但一律 allow）；enforce 才真擋。
- 腳本第一行檢查 `SHELLWARD_GATE=off` 可秒退。

## MVP 範圍（YAGNI）
- **只做 Bash → check_command**（injection 最大殺傷面）。
- Phase 2（不做）：Write/Edit → check_path 護敏感路徑；shadow would-block 統計 UI；WebFetch（shellward 無 URL 裁決工具，不硬做）。

## 任務
- G1 `shellwardClient.ts`：常駐 shellward-mcp stdio JSON-RPC + initialize 握手 + `checkCommand(cmd)` + 斷線重連 + 連不上回 unavailable。
- G2 `routes/guard.ts` `POST /api/guard/check`：boot-token 驗證、依 tool_name 分流、mode（shadow/enforce）、決策記錄（供 UI/統計）。
- G3 `server/hooks/shellward-gate.mjs`：fail-closed hook 腳本（讀 stdin、POST guard、任何異常 deny、逃生開關）。
- G4 `agentSession.spawnClaudeChild`：boot 生成 hooks settings 檔（matcher "Bash"）、`SHELLWARD_GATE!==off` 時 push `--settings`；`claudeProcess` 確認 `--settings` 加參。
- G5 `mcpDetector`：缺 baseline 通報（`getBaselineMissing`）；heartbeat「有 Bash 活動卻零 check」告警骨架。

## 測試/rollout
- 單元：shellwardClient（假 shellward stdio）、guard route（shadow 放行/enforce 擋、fail-closed）、hook 腳本（異常→deny）。
- rollout：預設 shadow → dogfood 累積 would-block 樣本 → 人審誤擋 → 再切 enforce（先非關鍵 workspace 跑良性組全過+惡意組全擋+被擋 agent 不崩）→ 全域。回退：拔 shellward 確認全 deny、`SHELLWARD_GATE=off` 確認完全回退。
