import { describe, it, expect } from "vitest";
import { runCockpit } from "./cockpitGenerator.js";
import { getLatestBriefing } from "./cockpitStore.js";
import { createWorkspace, updateWorkspace } from "./store.js";

describe("runCockpit（注入假 agent）", () => {
  it("解析成功 → 存 status=ok 的簡報", async () => {
    const w = createWorkspace({ name: "測試事業" });
    updateWorkspace(w.id, { memory: "本週要對帳" });
    const fakeRun = async () =>
      "```json\n" + JSON.stringify({ sections: [
        { kind: "status", title: "各事業近況", items: [{ title: "測試事業", body: "對帳中" }] },
      ] }) + "\n```";
    const r = await runCockpit("manual", { runAgent: fakeRun });
    expect(r.status).toBe("ok");
    expect(getLatestBriefing()?.content?.sections[0].items[0].title).toBe("測試事業");
  });

  it("agent 輸出無法解析 → 存 parse_failed、raw 保留", async () => {
    const fakeRun = async () => "我壞掉了，沒有 json";
    const r = await runCockpit("manual", { runAgent: fakeRun });
    expect(r.status).toBe("parse_failed");
    expect(getLatestBriefing()?.raw).toContain("壞掉");
  });

  it("runAgent 拋錯 → 存 status=error、不 throw", async () => {
    const fakeRun = async () => { throw new Error("boom"); };
    const r = await runCockpit("manual", { runAgent: fakeRun });
    expect(r.status).toBe("error");
  });
});
