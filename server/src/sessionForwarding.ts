/**
 * 即時回覆轉送：把 AgentSession 的 "event" 轉給觀看該對話的 socket。
 *
 * 舊版 bug（2026-11-19 使用者回報「送出後看不到即時回覆，刷新才有」）：
 * 轉送 listener 掛在「當下那個 AgentSession 物件」上，並以 sessionId 記成「已接線」。
 * 對話閒置被回收、物件被清掉後，下次送訊息會 reattach 出新物件，但「已接線」紀錄還在，
 * 不會重接——事件全掛在已作廢的舊物件上。刷新會斷線→觀看者歸零→紀錄清掉→重接，所以刷新才好。
 * 修法：記住 listener 掛在哪個物件；物件換新（registered 通知或 join 時比對）就搬過去。
 */
import type { EventEmitter } from "node:events";

type Forward = { target: EventEmitter; fn: (evt: any) => void };

export class SessionForwarding {
  private observers = new Map<string, Set<string>>();
  private forwards = new Map<string, Forward>();

  constructor(
    private getSession: (id: string) => EventEmitter | undefined,
    private emitToRoom: (sessionId: string, evt: any) => void,
  ) {}

  /** 確保 listener 掛在「目前」的 session 物件上（換新了就從舊的拆下、掛到新的）。 */
  private ensureWired(sessionId: string): void {
    const current = this.getSession(sessionId);
    const existing = this.forwards.get(sessionId);
    if (existing && existing.target === current) return;
    if (existing) existing.target.off("event", existing.fn);
    if (!current) { this.forwards.delete(sessionId); return; }
    const fn = (evt: any) => this.emitToRoom(sessionId, evt);
    current.on("event", fn);
    this.forwards.set(sessionId, { target: current, fn });
  }

  join(socketId: string, sessionId: string): void {
    if (!this.observers.has(sessionId)) this.observers.set(sessionId, new Set());
    this.observers.get(sessionId)!.add(socketId);
    this.ensureWired(sessionId);
  }

  leave(socketId: string, sessionId: string): void {
    const obs = this.observers.get(sessionId);
    if (!obs) return;
    obs.delete(socketId);
    if (obs.size > 0) return;
    this.observers.delete(sessionId);
    const f = this.forwards.get(sessionId);
    if (f) f.target.off("event", f.fn);
    this.forwards.delete(sessionId);
  }

  disconnect(socketId: string): void {
    for (const id of [...this.observers.keys()]) this.leave(socketId, id);
  }

  /** agentManager 建立／重建 session 物件時呼叫：有人在看才重接。 */
  sessionRegistered(sessionId: string): void {
    if ((this.observers.get(sessionId)?.size ?? 0) > 0) this.ensureWired(sessionId);
  }
}
