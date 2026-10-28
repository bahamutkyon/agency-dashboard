import { describe, it, expect, beforeEach } from "vitest";
import { runCockpit } from "./cockpitGenerator.js";
import { getLatestBriefing, getLatestOkBriefing } from "./cockpitStore.js";
import { db } from "./db.js";
import { createWorkspace, updateWorkspace } from "./store.js";

describe("runCockpit（注入假 agent）", () => {
  beforeEach(() => {
    db.exec("DELETE FROM cockpit_briefings");
  });
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

  it("agent 回的是登入錯誤字樣 → 存 status=error（不是 parse_failed），raw 標明登入失效", async () => {
    const fakeRun = async () => "Failed to authenticate: OAuth session expired and could not be refreshed";
    const r = await runCockpit("manual", { runAgent: fakeRun });
    expect(r.status).toBe("error");
    expect(getLatestBriefing()?.raw).toContain("登入失效");
  });

  it("runAgent 拋錯 → 存 status=error、不 throw", async () => {
    const fakeRun = async () => { throw new Error("boom"); };
    const r = await runCockpit("manual", { runAgent: fakeRun });
    expect(r.status).toBe("error");
  });

  it("error 不覆蓋上一份 ok 簡報（getLatestOkBriefing 仍回第一份）", async () => {
    const okContent = JSON.stringify({ sections: [
      { kind: "status", title: "近況", items: [{ title: "ok-item", body: "first ok" }] },
    ] });
    const fakeOk = async () => "```json\n" + okContent + "\n```";
    const fakeErr = async () => { throw new Error("second run boom"); };

    await runCockpit("manual", { runAgent: fakeOk });
    await runCockpit("manual", { runAgent: fakeErr });

    const okBriefing = getLatestOkBriefing();
    expect(okBriefing?.status).toBe("ok");
    expect(okBriefing?.content?.sections[0].items[0].title).toBe("ok-item");
  });
});
