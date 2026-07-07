/**
 * A4 — decidePendingAction CAS（compare-and-swap）防重複批准
 *
 * decidePendingAction 從無條件 UPDATE 改為 `WHERE ... AND status='pending'`，
 * 回傳是否真的改到（sqlite changes>0）。用於路由層判斷「首次決定才執行、
 * 已處理過回 409」，並讓「先批准又拒絕」的亂序被擋下。
 */
import { describe, it, expect } from "vitest";
import { createPendingAction, decidePendingAction, getPendingAction } from "./store/autonomy.js";

describe("decidePendingAction CAS", () => {
  it("首次 approve 回 true、再次 approve 回 false（狀態已非 pending）", () => {
    const pa = createPendingAction({ sessionId: "cas1", workspaceId: "w", kind: "dispatch", risk: "high", summary: "派工", detail: "x" });
    expect(decidePendingAction(pa.id, "approved")).toBe(true);
    expect(getPendingAction(pa.id)?.status).toBe("approved");
    // 第二次（雙擊/重送/兩分頁）→ 不再改到任何列
    expect(decidePendingAction(pa.id, "approved")).toBe(false);
  });

  it("已 approve 後再 reject 回 false（擋掉先批准又拒絕的亂序）", () => {
    const pa = createPendingAction({ sessionId: "cas2", workspaceId: "w", kind: "dispatch", risk: "high", summary: "派工", detail: "x" });
    expect(decidePendingAction(pa.id, "approved")).toBe(true);
    expect(decidePendingAction(pa.id, "rejected")).toBe(false);
    expect(getPendingAction(pa.id)?.status).toBe("approved");
  });

  it("首次 reject 回 true、再次 reject 回 false", () => {
    const pa = createPendingAction({ sessionId: "cas3", workspaceId: "w", kind: "dispatch", risk: "high", summary: "派工", detail: "x" });
    expect(decidePendingAction(pa.id, "rejected")).toBe(true);
    expect(decidePendingAction(pa.id, "rejected")).toBe(false);
  });
});
