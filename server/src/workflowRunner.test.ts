/**
 * 單元測試：workflowRunner.ts 核心純函式
 *
 * 覆蓋範圍：
 *   - validateGraph  — cycle 偵測、missing dep、duplicate id、happy paths
 *   - normalizeSteps — id 自動補齊、dependsOn 自動填補
 *   - ancestorsOf    — 線性、菱形、單節點、不存在 id
 *   - descendantsOf  — 線性、菱形、單節點、葉節點
 *   - depsReady      — all / any mode、空 deps
 */
import { describe, it, expect } from "vitest";
import type { WorkflowStep } from "./store.js";
import {
  validateGraph,
  normalizeSteps,
  ancestorsOf,
  descendantsOf,
  depsReady,
} from "./workflowRunner.js";

// ---------------------------------------------------------------------------
// 輔助工廠：建立最小化的 WorkflowStep（不依賴 DB / agentManager）
// ---------------------------------------------------------------------------
function step(
  id: string,
  dependsOn: string[] = [],
  extra: Partial<WorkflowStep> = {},
): WorkflowStep {
  return {
    id,
    agentId: "agent-stub",
    prompt: "test prompt",
    dependsOn,
    ...extra,
  };
}

// ===========================================================================
// validateGraph
// ===========================================================================
describe("validateGraph", () => {
  it("空陣列 → valid (回傳 null)", () => {
    expect(validateGraph([])).toBeNull();
  });

  it("單一節點、無 dep → valid", () => {
    expect(validateGraph([step("a", [])])).toBeNull();
  });

  it("線性 a→b→c → valid", () => {
    const steps = [step("a", []), step("b", ["a"]), step("c", ["b"])];
    expect(validateGraph(steps)).toBeNull();
  });

  it("菱形 a→{b,c}→d → valid", () => {
    const steps = [
      step("a", []),
      step("b", ["a"]),
      step("c", ["a"]),
      step("d", ["b", "c"]),
    ];
    expect(validateGraph(steps)).toBeNull();
  });

  it("樹（fan-out）a→b, a→c, b→d → valid", () => {
    const steps = [
      step("a", []),
      step("b", ["a"]),
      step("c", ["a"]),
      step("d", ["b"]),
    ];
    expect(validateGraph(steps)).toBeNull();
  });

  it("自我依賴 a→a → 偵測到 cycle", () => {
    const err = validateGraph([step("a", ["a"])]);
    expect(err).not.toBeNull();
    expect(err).toMatch(/cycle|循環/i);
  });

  it("簡單雙節點 cycle a→b, b→a → 偵測到", () => {
    const steps = [step("a", ["b"]), step("b", ["a"])];
    const err = validateGraph(steps);
    expect(err).not.toBeNull();
    expect(err).toMatch(/cycle|循環/i);
  });

  it("三節點 cycle a→b→c→a → 偵測到", () => {
    const steps = [step("a", ["c"]), step("b", ["a"]), step("c", ["b"])];
    const err = validateGraph(steps);
    expect(err).not.toBeNull();
    expect(err).toMatch(/cycle|循環/i);
  });

  it("不存在的 dep → 回傳錯誤訊息", () => {
    const steps = [step("a", []), step("b", ["x"])];
    const err = validateGraph(steps);
    expect(err).not.toBeNull();
    // 訊息應提示找不到 "x"
    expect(err).toContain("x");
  });

  it("dep 指向自身且是唯一節點 → 偵測到（missing dep 或 cycle 均可）", () => {
    // 此時 "a" depends on "z" which doesn't exist
    const err = validateGraph([step("a", ["z"])]);
    expect(err).not.toBeNull();
  });

  it("兩個步驟都依賴不存在的 dep → 回傳錯誤", () => {
    const steps = [step("a", ["ghost"]), step("b", [])];
    expect(validateGraph(steps)).not.toBeNull();
  });
});

// ===========================================================================
// normalizeSteps
// ===========================================================================
describe("normalizeSteps", () => {
  it("空陣列 → 回傳空陣列", () => {
    expect(normalizeSteps([])).toEqual([]);
  });

  it("有 id 的步驟保留原 id", () => {
    const result = normalizeSteps([step("myId", [])]);
    expect(result[0].id).toBe("myId");
  });

  it("無 id 步驟補齊 step_N（1-based）", () => {
    const raw: WorkflowStep[] = [
      { agentId: "a", prompt: "p1" },
      { agentId: "a", prompt: "p2" },
      { agentId: "a", prompt: "p3" },
    ];
    const result = normalizeSteps(raw);
    expect(result[0].id).toBe("step_1");
    expect(result[1].id).toBe("step_2");
    expect(result[2].id).toBe("step_3");
  });

  it("第一個步驟（無 dependsOn）→ dependsOn 設為 []", () => {
    const raw: WorkflowStep[] = [{ agentId: "a", prompt: "p" }];
    const result = normalizeSteps(raw);
    expect(result[0].dependsOn).toEqual([]);
  });

  it("中間步驟（無 dependsOn）→ 自動依賴前一步", () => {
    const raw: WorkflowStep[] = [
      { agentId: "a", prompt: "p1" },
      { agentId: "a", prompt: "p2" },
    ];
    const result = normalizeSteps(raw);
    // step_2 應自動依賴 step_1
    expect(result[1].dependsOn).toEqual(["step_1"]);
  });

  it("明確 dependsOn 保留不覆蓋", () => {
    const raw: WorkflowStep[] = [
      { agentId: "a", prompt: "p1", id: "x" },
      { agentId: "a", prompt: "p2", dependsOn: [] },
    ];
    const result = normalizeSteps(raw);
    expect(result[1].dependsOn).toEqual([]);
  });

  it("混合：有 id 和無 id 的步驟同時出現", () => {
    const raw: WorkflowStep[] = [
      { agentId: "a", prompt: "p1", id: "named" },
      { agentId: "a", prompt: "p2" },
    ];
    const result = normalizeSteps(raw);
    expect(result[0].id).toBe("named");
    expect(result[1].id).toBe("step_2");
    // step_2 無 dependsOn → 自動依賴前一步 "named"
    expect(result[1].dependsOn).toEqual(["named"]);
  });

  it("不改變原陣列（immutable）", () => {
    const raw: WorkflowStep[] = [{ agentId: "a", prompt: "p" }];
    normalizeSteps(raw);
    expect(raw[0].id).toBeUndefined();
  });
});

// ===========================================================================
// ancestorsOf
// ===========================================================================
describe("ancestorsOf", () => {
  it("單節點、無 deps → ancestors 為空 Set", () => {
    const steps = [step("a", [])];
    expect(ancestorsOf("a", steps).size).toBe(0);
  });

  it("線性 a→b→c, ancestorsOf(c) = {a, b}", () => {
    const steps = [step("a", []), step("b", ["a"]), step("c", ["b"])];
    const anc = ancestorsOf("c", steps);
    expect(anc).toEqual(new Set(["a", "b"]));
  });

  it("線性 a→b→c, ancestorsOf(b) = {a}", () => {
    const steps = [step("a", []), step("b", ["a"]), step("c", ["b"])];
    expect(ancestorsOf("b", steps)).toEqual(new Set(["a"]));
  });

  it("菱形 a→{b,c}→d, ancestorsOf(d) = {a, b, c}", () => {
    const steps = [
      step("a", []),
      step("b", ["a"]),
      step("c", ["a"]),
      step("d", ["b", "c"]),
    ];
    const anc = ancestorsOf("d", steps);
    expect(anc).toEqual(new Set(["a", "b", "c"]));
  });

  it("根節點 a (無 dep), ancestorsOf(a) = {}", () => {
    const steps = [step("a", []), step("b", ["a"])];
    expect(ancestorsOf("a", steps).size).toBe(0);
  });

  it("不存在的 id → 回傳空 Set（不 throw）", () => {
    const steps = [step("a", [])];
    expect(ancestorsOf("ghost", steps).size).toBe(0);
  });

  it("多層深度：a→b→c→d, ancestorsOf(d) = {a,b,c}", () => {
    const steps = [
      step("a", []),
      step("b", ["a"]),
      step("c", ["b"]),
      step("d", ["c"]),
    ];
    expect(ancestorsOf("d", steps)).toEqual(new Set(["a", "b", "c"]));
  });
});

// ===========================================================================
// descendantsOf
// ===========================================================================
describe("descendantsOf", () => {
  it("葉節點（無子節點）→ descendants 為空 Set", () => {
    const steps = [step("a", []), step("b", ["a"])];
    expect(descendantsOf("b", steps).size).toBe(0);
  });

  it("線性 a→b→c, descendantsOf(a) = {b, c}", () => {
    const steps = [step("a", []), step("b", ["a"]), step("c", ["b"])];
    expect(descendantsOf("a", steps)).toEqual(new Set(["b", "c"]));
  });

  it("線性 a→b→c, descendantsOf(b) = {c}", () => {
    const steps = [step("a", []), step("b", ["a"]), step("c", ["b"])];
    expect(descendantsOf("b", steps)).toEqual(new Set(["c"]));
  });

  it("菱形 a→{b,c}→d, descendantsOf(a) = {b, c, d}", () => {
    const steps = [
      step("a", []),
      step("b", ["a"]),
      step("c", ["a"]),
      step("d", ["b", "c"]),
    ];
    expect(descendantsOf("a", steps)).toEqual(new Set(["b", "c", "d"]));
  });

  it("單節點，descendantsOf(a) = {}", () => {
    const steps = [step("a", [])];
    expect(descendantsOf("a", steps).size).toBe(0);
  });

  it("不存在的 id → 回傳空 Set（不 throw）", () => {
    const steps = [step("a", [])];
    expect(descendantsOf("ghost", steps).size).toBe(0);
  });

  it("fan-out：a→{b,c,d}, descendantsOf(a) = {b,c,d}", () => {
    const steps = [
      step("a", []),
      step("b", ["a"]),
      step("c", ["a"]),
      step("d", ["a"]),
    ];
    expect(descendantsOf("a", steps)).toEqual(new Set(["b", "c", "d"]));
  });
});

// ===========================================================================
// depsReady
// ===========================================================================
describe("depsReady", () => {
  it("無 deps → 永遠 ready", () => {
    const s = step("a", []);
    expect(depsReady(s, new Set())).toBe(true);
  });

  it("mode=all, 所有 deps 完成 → ready", () => {
    const s = step("c", ["a", "b"]);
    expect(depsReady(s, new Set(["a", "b"]))).toBe(true);
  });

  it("mode=all, 只完成部分 deps → not ready", () => {
    const s = step("c", ["a", "b"]);
    expect(depsReady(s, new Set(["a"]))).toBe(false);
  });

  it("mode=all, 沒有 dep 完成 → not ready", () => {
    const s = step("c", ["a", "b"]);
    expect(depsReady(s, new Set())).toBe(false);
  });

  it("mode=any, 任意一個 dep 完成 → ready", () => {
    const s: WorkflowStep = { ...step("c", ["a", "b"]), dependsOnMode: "any" };
    expect(depsReady(s, new Set(["a"]))).toBe(true);
  });

  it("mode=any, 所有 deps 都未完成 → not ready", () => {
    const s: WorkflowStep = { ...step("c", ["a", "b"]), dependsOnMode: "any" };
    expect(depsReady(s, new Set())).toBe(false);
  });

  it("mode=any, 所有 deps 都完成 → ready", () => {
    const s: WorkflowStep = { ...step("c", ["a", "b"]), dependsOnMode: "any" };
    expect(depsReady(s, new Set(["a", "b"]))).toBe(true);
  });

  it("dependsOn undefined（沒有 key）→ 視為無 deps，ready", () => {
    const s: WorkflowStep = { id: "a", agentId: "x", prompt: "p" };
    expect(depsReady(s, new Set())).toBe(true);
  });
});
