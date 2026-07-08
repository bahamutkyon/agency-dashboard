/**
 * telegramPoller — Telegram 雙向批准
 *
 * 覆蓋：chatId 過濾（陌生 chat 完全忽略不回）、動詞解析（含變體與雜訊訊息回說明）、
 * 0/1/N 筆 pending 三情境、編號批准、snapshot TTL 過期、CAS 已處理回「已處理過」、
 * 輪詢錯誤退避不拋、未設定不啟動。
 *
 * 全 deps 注入，絕不碰網路/真實 notifier 設定。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseCommand, processUpdate, pollOnce, nextDelayMs, makeInitialState,
  startTelegramPoller, stopTelegramPoller, suspendTelegramPoller,
  type PollerDeps, type PollerState, type PendingLike, type TelegramUpdate,
} from "./telegramPoller.js";
import type { ApprovalResult } from "./routes/approvalService.js";

const CHAT = "42";

function makeDeps(over: Partial<PollerDeps> = {}): PollerDeps & {
  replies: { chatId: string; text: string }[];
  approved: string[];
  rejected: string[];
} {
  const replies: { chatId: string; text: string }[] = [];
  const approved: string[] = [];
  const rejected: string[] = [];
  const base: PollerDeps = {
    fetchImpl: vi.fn() as any,
    getConfig: () => ({ token: "t", chatId: CHAT }),
    listAllPending: () => [],
    approve: (id) => { approved.push(id); return { status: "approved", summary: `S:${id}` }; },
    reject: (id) => { rejected.push(id); return { status: "rejected", summary: `S:${id}` }; },
    sendReply: async (chatId, text) => { replies.push({ chatId, text }); },
    workspaceName: (id) => `WS(${id})`,
    now: () => 1_000_000,
    ...over,
  };
  return Object.assign(base, { replies, approved, rejected });
}

function pending(...ids: string[]): PendingLike[] {
  return ids.map((id) => ({ id, summary: `摘要-${id}`, workspaceId: `ws-${id}` }));
}

function msg(chatId: string | number, text: string, update_id = 1): TelegramUpdate {
  return { update_id, message: { chat: { id: chatId }, text } };
}

describe("parseCommand — 動詞解析（含變體與雜訊）", () => {
  it("批准變體都解析為 approve", () => {
    for (const t of ["批准", "同意", "核可", "ok", "OK", "approve", "  批准 "]) {
      expect(parseCommand(t).verb).toBe("approve");
    }
  });
  it("拒絕變體都解析為 reject", () => {
    for (const t of ["拒絕", "不要", "駁回", "reject", "no", "NO"]) {
      expect(parseCommand(t).verb).toBe("reject");
    }
  });
  it("帶編號：批准 2 / 拒絕3 / 批准2", () => {
    expect(parseCommand("批准 2")).toEqual({ verb: "approve", index: 2 });
    expect(parseCommand("批准2")).toEqual({ verb: "approve", index: 2 });
    expect(parseCommand("拒絕 3")).toEqual({ verb: "reject", index: 3 });
  });
  it("雜訊訊息 → help（不誤觸）", () => {
    for (const t of ["okay", "你好", "批准一下所有的", "", "  ", "approver"]) {
      expect(parseCommand(t).verb).toBe("help");
    }
  });
});

describe("chatId 過濾", () => {
  it("陌生 chat 完全忽略：不回覆、不核可", async () => {
    const deps = makeDeps({ listAllPending: () => pending("a") });
    const state = makeInitialState();
    await processUpdate(msg("999", "批准"), deps, state);
    expect(deps.replies).toHaveLength(0);
    expect(deps.approved).toHaveLength(0);
  });
  it("設定的 chat 才處理（列清單存 snapshot，尚未執行）", async () => {
    const deps = makeDeps({ listAllPending: () => pending("a") });
    const state = makeInitialState();
    await processUpdate(msg(CHAT, "批准"), deps, state);
    expect(deps.approved).toHaveLength(0);
    expect(state.snapshot?.items).toHaveLength(1);
    expect(deps.replies).toHaveLength(1);
  });
  it("chat.id 為數字型別也能比對（Telegram 傳 number）", async () => {
    const deps = makeDeps({ listAllPending: () => pending("a") });
    const state = makeInitialState();
    await processUpdate(msg(42, "批准"), deps, state);
    expect(deps.replies).toHaveLength(1);
    expect(state.snapshot?.items).toHaveLength(1);
  });
});

describe("雜訊訊息回使用說明", () => {
  it("非動詞 → 回一則說明，不動 pending", async () => {
    const deps = makeDeps({ listAllPending: () => pending("a") });
    await processUpdate(msg(CHAT, "哈囉"), deps, makeInitialState());
    expect(deps.approved).toHaveLength(0);
    expect(deps.replies[0].text).toContain("批准");
    expect(deps.replies[0].text).toContain("拒絕");
  });
  it("非文字訊息（無 text）→ 完全忽略，不回噪音", async () => {
    const deps = makeDeps({ listAllPending: () => pending("a") });
    await processUpdate({ update_id: 1, message: { chat: { id: CHAT } } }, deps, makeInitialState());
    expect(deps.replies).toHaveLength(0);
  });
});

describe("0 / 1 / N 筆 pending 三情境（R3：一律編號確認）", () => {
  it("0 筆 → 回「目前沒有待批項目」", async () => {
    const deps = makeDeps({ listAllPending: () => [] });
    await processUpdate(msg(CHAT, "批准"), deps, makeInitialState());
    expect(deps.replies[0].text).toContain("目前沒有待批項目");
    expect(deps.approved).toHaveLength(0);
  });
  it("1 筆也要確認：列「待批 1 筆」清單、存 snapshot、先不執行", async () => {
    const deps = makeDeps({ listAllPending: () => pending("only") });
    const state = makeInitialState();
    await processUpdate(msg(CHAT, "批准"), deps, state);
    expect(deps.approved).toHaveLength(0);
    expect(deps.replies[0].text).toContain("待批 1 筆");
    expect(deps.replies[0].text).toContain("批准 1");
    expect(state.snapshot?.items).toHaveLength(1);
  });
  it("1 筆：列清單後「批准 1」才真的執行", async () => {
    const deps = makeDeps({ listAllPending: () => pending("only") });
    const state = makeInitialState();
    await processUpdate(msg(CHAT, "批准", 1), deps, state);    // 列清單
    await processUpdate(msg(CHAT, "批准 1", 2), deps, state);  // 帶編號確認
    expect(deps.approved).toEqual(["only"]);
    expect(deps.replies[1].text).toContain("已批准");
  });
  it("1 筆拒絕也要確認：先列清單，「拒絕 1」才執行", async () => {
    const deps = makeDeps({ listAllPending: () => pending("only") });
    const state = makeInitialState();
    await processUpdate(msg(CHAT, "拒絕", 1), deps, state);
    expect(deps.rejected).toHaveLength(0);
    await processUpdate(msg(CHAT, "拒絕 1", 2), deps, state);
    expect(deps.rejected).toEqual(["only"]);
    expect(deps.replies[1].text).toContain("已拒絕");
  });
  it("N 筆 → 列編號清單（含 workspace 名）、存 snapshot、先不執行", async () => {
    const deps = makeDeps({ listAllPending: () => pending("a", "b", "c") });
    const state = makeInitialState();
    await processUpdate(msg(CHAT, "批准"), deps, state);
    expect(deps.approved).toHaveLength(0);
    const text = deps.replies[0].text;
    expect(text).toContain("1. 摘要-a");
    expect(text).toContain("WS(ws-a)");
    expect(text).toContain("3. 摘要-c");
    expect(state.snapshot?.items).toHaveLength(3);
  });
});

describe("編號批准（對 snapshot 第 N 筆）", () => {
  it("先列清單再「批准 2」→ 執行第 2 筆", async () => {
    const deps = makeDeps({ listAllPending: () => pending("a", "b", "c") });
    const state = makeInitialState();
    await processUpdate(msg(CHAT, "批准", 1), deps, state);       // 列清單
    await processUpdate(msg(CHAT, "批准 2", 2), deps, state);     // 執行第 2 筆
    expect(deps.approved).toEqual(["b"]);
    expect(deps.replies[1].text).toContain("已批准");
  });
  it("編號超出範圍 → 提示，不執行", async () => {
    const deps = makeDeps({ listAllPending: () => pending("a", "b") });
    const state = makeInitialState();
    await processUpdate(msg(CHAT, "批准", 1), deps, state);
    await processUpdate(msg(CHAT, "批准 9", 2), deps, state);
    expect(deps.approved).toHaveLength(0);
    expect(deps.replies[1].text).toContain("超出範圍");
  });
});

describe("snapshot TTL 過期", () => {
  it("超過 10 分鐘的「批准 2」→ snapshot 失效，重新列最新清單（不誤點舊項）", async () => {
    let t = 1_000_000;
    const deps = makeDeps({ listAllPending: () => pending("a", "b", "c"), now: () => t });
    const state = makeInitialState();
    await processUpdate(msg(CHAT, "批准", 1), deps, state);   // 存 snapshot @ t
    t += 11 * 60 * 1000;                                      // 過 11 分鐘
    await processUpdate(msg(CHAT, "批准 2", 2), deps, state); // snapshot 過期
    expect(deps.approved).toHaveLength(0);                    // 不對舊 snapshot 執行
    expect(deps.replies[1].text).toContain("已過期");
    expect(state.snapshot?.items).toHaveLength(3);            // 重新列了最新清單
  });
});

describe("CAS 已處理回「已處理過」", () => {
  it("approve 回 already_handled → 回「此項已處理過」（帶編號確認後）", async () => {
    const deps = makeDeps({
      listAllPending: () => pending("x"),
      approve: (): ApprovalResult => ({ status: "already_handled" }),
    });
    const state = makeInitialState();
    await processUpdate(msg(CHAT, "批准", 1), deps, state);    // 列清單存 snapshot
    await processUpdate(msg(CHAT, "批准 1", 2), deps, state);  // 對第 1 筆執行
    expect(deps.replies[deps.replies.length - 1].text).toContain("已處理過");
  });
  it("not_found → 回「找不到」（帶編號確認後）", async () => {
    const deps = makeDeps({
      listAllPending: () => pending("x"),
      reject: (): ApprovalResult => ({ status: "not_found" }),
    });
    const state = makeInitialState();
    await processUpdate(msg(CHAT, "拒絕", 1), deps, state);
    await processUpdate(msg(CHAT, "拒絕 1", 2), deps, state);
    expect(deps.replies[deps.replies.length - 1].text).toContain("找不到");
  });
});

describe("pollOnce — long-poll + offset + 錯誤退避", () => {
  it("成功一輪：推進 offset、處理 update、failCount 歸零", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, result: [msg(CHAT, "批准", 7)] }),
    });
    const deps = makeDeps({ fetchImpl: fetchImpl as any, listAllPending: () => pending("only") });
    const state = makeInitialState();
    state.failCount = 3;
    await pollOnce(deps, state);
    expect(state.offset).toBe(8);       // update_id 7 + 1
    expect(deps.approved).toHaveLength(0);            // R3：裸「批准」只列清單、不執行
    expect(deps.replies[0].text).toContain("待批 1 筆");
    expect(state.failCount).toBe(0);
    // getUpdates URL 帶 offset 與 long-poll timeout
    expect(String(fetchImpl.mock.calls[0][0])).toContain("getUpdates?offset=0&timeout=25");
  });

  it("fetch 拋錯 → 靜默吞掉、failCount++，絕不往上拋", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("斷網"));
    const deps = makeDeps({ fetchImpl: fetchImpl as any });
    const state = makeInitialState();
    await expect(pollOnce(deps, state)).resolves.toBeUndefined();
    expect(state.failCount).toBe(1);
  });

  it("Telegram 回 ok:false → 當失敗處理（failCount++）", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ json: async () => ({ ok: false }) });
    const deps = makeDeps({ fetchImpl: fetchImpl as any });
    const state = makeInitialState();
    await pollOnce(deps, state);
    expect(state.failCount).toBe(1);
  });

  it("單筆 update 處理丟例外不影響整輪（offset 仍推進、不拋）", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, result: [msg(CHAT, "批准", 5)] }),
    });
    const deps = makeDeps({
      fetchImpl: fetchImpl as any,
      listAllPending: () => { throw new Error("DB 爆了"); },
    });
    const state = makeInitialState();
    await expect(pollOnce(deps, state)).resolves.toBeUndefined();
    expect(state.offset).toBe(6);
  });
});

describe("nextDelayMs — 指數退避到上限 5 分鐘", () => {
  it("成功（failCount=0）→ 基準間隔 3000", () => {
    expect(nextDelayMs({ ...makeInitialState(), failCount: 0 })).toBe(3000);
  });
  it("連續失敗 → 指數上升但不超過 300000", () => {
    expect(nextDelayMs({ ...makeInitialState(), failCount: 1 })).toBe(6000);
    expect(nextDelayMs({ ...makeInitialState(), failCount: 3 })).toBe(24000);
    expect(nextDelayMs({ ...makeInitialState(), failCount: 99 })).toBe(300000);
  });
});

describe("pollOnce — 常駐化 no-op（未設定）與 suspend 互斥", () => {
  beforeEach(() => stopTelegramPoller()); // 清 suspendedUntil，避免測試間污染

  it("未設定 notifier → pollOnce no-op，不打網路（fetch 不被呼叫）", async () => {
    const fetchImpl = vi.fn();
    const deps = makeDeps({ getConfig: () => null, fetchImpl: fetchImpl as any });
    const state = makeInitialState();
    await pollOnce(deps, state);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(state.failCount).toBe(0);
  });

  it("設定後下一輪即開始 poll（fetch 被呼叫）", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ json: async () => ({ ok: true, result: [] }) });
    let cfg: { token: string; chatId: string } | null = null;
    const deps = makeDeps({ getConfig: () => cfg, fetchImpl: fetchImpl as any });
    const state = makeInitialState();
    await pollOnce(deps, state);            // 未設定 → no-op
    expect(fetchImpl).not.toHaveBeenCalled();
    cfg = { token: "t", chatId: CHAT };     // 使用者設定好
    await pollOnce(deps, state);            // 下一輪 → 開打
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("suspend 期間 pollOnce no-op；到期後恢復", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ json: async () => ({ ok: true, result: [] }) });
    const t0 = Date.now();
    suspendTelegramPoller(35_000); // suspendedUntil ≈ t0 + 35s
    // 暫停期間：deps.now 在 suspendedUntil 之前 → no-op
    const suspendedDeps = makeDeps({ fetchImpl: fetchImpl as any, now: () => t0 + 1_000 });
    await pollOnce(suspendedDeps, makeInitialState());
    expect(fetchImpl).not.toHaveBeenCalled();
    // 到期後：deps.now 超過 suspendedUntil → 恢復 poll
    const resumedDeps = makeDeps({ fetchImpl: fetchImpl as any, now: () => t0 + 40_000 });
    await pollOnce(resumedDeps, makeInitialState());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("startTelegramPoller — 啟動守衛（常駐化）", () => {
  beforeEach(() => stopTelegramPoller());

  it("未設定 notifier 也啟動（常駐，回 true）— pollOnce 內部 no-op 短路", () => {
    // fetch 永遠 pending → 迴圈掛在第一個 getUpdates（但 getConfig=null 時根本不會 fetch）
    const fetchImpl = vi.fn().mockReturnValue(new Promise(() => {}));
    const started = startTelegramPoller({ getConfig: () => null, fetchImpl: fetchImpl as any });
    expect(started).toBe(true);
    stopTelegramPoller();
  });

  it("TELEGRAM_TWO_WAY=off → 不啟動", () => {
    const prev = process.env.TELEGRAM_TWO_WAY;
    process.env.TELEGRAM_TWO_WAY = "off";
    try {
      const started = startTelegramPoller({ getConfig: () => ({ token: "t", chatId: CHAT }), fetchImpl: vi.fn() as any });
      expect(started).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.TELEGRAM_TWO_WAY; else process.env.TELEGRAM_TWO_WAY = prev;
    }
  });

  it("已設定且未關 → 啟動（回 true），可停止", () => {
    // fetch 永遠 pending → 迴圈掛在第一個 getUpdates，不會真的打網路循環
    const fetchImpl = vi.fn().mockReturnValue(new Promise(() => {}));
    const started = startTelegramPoller({ getConfig: () => ({ token: "t", chatId: CHAT }), fetchImpl: fetchImpl as any });
    expect(started).toBe(true);
    stopTelegramPoller();
  });
});
