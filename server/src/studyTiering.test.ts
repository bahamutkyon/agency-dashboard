import { describe, it, expect, beforeEach } from "vitest";
import { db } from "./db.js";
import { setTierOverride } from "./studyStore.js";
import { computeTiers, HOT_THRESHOLD } from "./studyTiering.js";

// 使用真實存在於 loadAgents() 的 agent id
const ID_HOT     = "marketing-content-creator";
const ID_COLD    = "support-support-responder";
const ID_DORMANT = "legal-contract-reviewer";
const ID_FORCED  = "engineering-senior-developer";    // override=hot
const ID_EXCLUDE = "engineering-frontend-developer";  // override=exclude

function addSessions(agentId: string, n: number, ageDays: number) {
  const ts = Date.now() - ageDays * 86400_000;
  for (let i = 0; i < n; i++) {
    db.prepare(
      "INSERT INTO sessions (id, workspace_id, agent_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?)"
    ).run(
      `s_${agentId}_${ageDays}_${i}_${Math.random().toString(36).slice(2)}`,
      "ws_default",
      agentId,
      "t",
      ts,
      ts,
    );
  }
}

beforeEach(() => {
  db.exec("DELETE FROM sessions; DELETE FROM agent_study_prefs;");
});

describe("computeTiers", () => {
  it("近30天 >= 門檻 → 熱", () => {
    addSessions(ID_HOT, HOT_THRESHOLD, 5);
    expect(computeTiers().hot.map((a) => a.agentId)).toContain(ID_HOT);
  });

  it("近90天用過但未達門檻 → 冷", () => {
    addSessions(ID_COLD, 1, 40);
    expect(computeTiers().cold.map((a) => a.agentId)).toContain(ID_COLD);
  });

  it("90天沒用 → 休眠", () => {
    addSessions(ID_DORMANT, 5, 200);
    expect(computeTiers().dormant.map((a) => a.agentId)).toContain(ID_DORMANT);
  });

  it("override=hot 強制熱、exclude 不進任何自動層", () => {
    addSessions(ID_FORCED, 1, 200);
    setTierOverride(ID_FORCED, "hot");

    addSessions(ID_EXCLUDE, HOT_THRESHOLD, 1);
    setTierOverride(ID_EXCLUDE, "exclude");

    const t = computeTiers();
    expect(t.hot.map((a) => a.agentId)).toContain(ID_FORCED);
    expect([...t.hot, ...t.cold, ...t.dormant].map((a) => a.agentId)).not.toContain(ID_EXCLUDE);
  });
});
