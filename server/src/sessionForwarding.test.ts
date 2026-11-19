import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { SessionForwarding } from "./sessionForwarding.js";

function setup() {
  const sessions = new Map<string, EventEmitter>();
  const sent: any[] = [];
  const fwd = new SessionForwarding((id) => sessions.get(id), (id, evt) => sent.push({ id, ...evt }));
  return { sessions, sent, fwd };
}

describe("即時回覆轉送：session 物件換新後要跟著接上", () => {
  it("join 後事件會轉給前端", () => {
    const { sessions, sent, fwd } = setup();
    const a = new EventEmitter(); sessions.set("s1", a);
    fwd.join("sock1", "s1");
    a.emit("event", { type: "delta", payload: "嗨" });
    expect(sent).toEqual([{ id: "s1", type: "delta", payload: "嗨" }]);
  });

  it("閒置回收後重建了新的 session 物件（分頁一直開著）→ 新物件的事件照樣轉送，舊物件解除", () => {
    const { sessions, sent, fwd } = setup();
    const old = new EventEmitter(); sessions.set("s1", old);
    fwd.join("sock1", "s1");
    const fresh = new EventEmitter(); sessions.set("s1", fresh);
    fwd.sessionRegistered("s1");
    fresh.emit("event", { type: "delta", payload: "新回覆" });
    expect(sent).toEqual([{ id: "s1", type: "delta", payload: "新回覆" }]);
    expect(old.listenerCount("event")).toBe(0);
  });

  it("沒人在看的 session 重建時不接線", () => {
    const { sessions, fwd } = setup();
    const fresh = new EventEmitter(); sessions.set("s1", fresh);
    fwd.sessionRegistered("s1");
    expect(fresh.listenerCount("event")).toBe(0);
  });

  it("重複 join 不會重複轉送；同一物件只掛一次", () => {
    const { sessions, sent, fwd } = setup();
    const a = new EventEmitter(); sessions.set("s1", a);
    fwd.join("sock1", "s1"); fwd.join("sock2", "s1"); fwd.join("sock1", "s1");
    a.emit("event", { type: "x" });
    expect(sent).toHaveLength(1);
  });

  it("join 時發現物件已換新（沒收到 registered 通知）也會重接", () => {
    const { sessions, sent, fwd } = setup();
    const old = new EventEmitter(); sessions.set("s1", old);
    fwd.join("sock1", "s1");
    const fresh = new EventEmitter(); sessions.set("s1", fresh);
    fwd.join("sock2", "s1");
    fresh.emit("event", { type: "x" });
    expect(sent).toHaveLength(1);
    expect(old.listenerCount("event")).toBe(0);
  });

  it("最後一位離開才解除；斷線清掉該 socket 所有觀看", () => {
    const { sessions, fwd } = setup();
    const a = new EventEmitter(); sessions.set("s1", a);
    fwd.join("sock1", "s1"); fwd.join("sock2", "s1");
    fwd.leave("sock1", "s1");
    expect(a.listenerCount("event")).toBe(1);
    fwd.disconnect("sock2");
    expect(a.listenerCount("event")).toBe(0);
  });
});
