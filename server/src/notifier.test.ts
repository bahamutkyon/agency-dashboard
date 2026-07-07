import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  notify, isNotifierConfigured, _resetNotifierForTest,
  _setNotifierConfigPathForTest, discoverChatId,
  getNotifierStatus, writeNotifierConfig,
} from "./notifier.js";

const ENV_KEYS = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] as const;
const saved: Record<string, string | undefined> = {};
let tmpDir: string;

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  _resetNotifierForTest();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "notifier-test-"));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
  _resetNotifierForTest();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

function configure() {
  process.env.TELEGRAM_BOT_TOKEN = "123:abc";
  process.env.TELEGRAM_CHAT_ID = "42";
}

describe("notifier — Telegram 推播", () => {
  it("未設定 env → isNotifierConfigured false、notify 回 false 且不打網路", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(isNotifierConfigured()).toBe(false);
    const ok = await notify({ kind: "test", title: "標題" });
    expect(ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("已設定 → 打 Telegram sendMessage API，帶 chat_id 與訊息文字，回 true", async () => {
    configure();
    const f = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", f);
    const ok = await notify({ kind: "交辦完成", title: "上架任務", body: "10 件完成" });
    expect(ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toContain("api.telegram.org/bot123:abc/sendMessage");
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload.chat_id).toBe("42");
    expect(payload.text).toContain("交辦完成");
    expect(payload.text).toContain("上架任務");
    expect(payload.text).toContain("10 件完成");
  });

  it("fetch 拋錯 → notify 回 false、絕不往上拋", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("網路炸了")));
    await expect(notify({ kind: "x", title: "y" })).resolves.toBe(false);
  });

  it("HTTP 非 2xx → 回 false", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(notify({ kind: "x", title: "y" })).resolves.toBe(false);
  });

  it("訊息過長 → 截斷到 Telegram 上限內（4096）", async () => {
    configure();
    const f = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", f);
    await notify({ kind: "k", title: "t", body: "很長".repeat(5000) });
    const payload = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(payload.text.length).toBeLessThanOrEqual(4096);
  });
});

describe("notifier — 設定檔 fallback（免環境變數）", () => {
  it("env 沒設但 notifier.json 有 → 視為已設定，用檔案裡的 token/chatId 發送", async () => {
    const p = path.join(tmpDir, "notifier.json");
    fs.writeFileSync(p, JSON.stringify({ botToken: "999:file", chatId: "77" }), "utf8");
    _setNotifierConfigPathForTest(p);
    const f = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", f);
    expect(isNotifierConfigured()).toBe(true);
    await notify({ kind: "k", title: "t" });
    expect(String(f.mock.calls[0][0])).toContain("bot999:file/sendMessage");
    expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string).chat_id).toBe("77");
  });

  it("env 優先於檔案", async () => {
    const p = path.join(tmpDir, "notifier.json");
    fs.writeFileSync(p, JSON.stringify({ botToken: "999:file", chatId: "77" }), "utf8");
    _setNotifierConfigPathForTest(p);
    configure(); // env: 123:abc / 42
    const f = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", f);
    await notify({ kind: "k", title: "t" });
    expect(String(f.mock.calls[0][0])).toContain("bot123:abc/sendMessage");
  });

  it("檔案格式壞掉 → 視為未設定，不炸", () => {
    const p = path.join(tmpDir, "notifier.json");
    fs.writeFileSync(p, "{not json", "utf8");
    _setNotifierConfigPathForTest(p);
    expect(isNotifierConfigured()).toBe(false);
  });
});

describe("discoverChatId — 自動抓 chat id", () => {
  it("無 token → 回 ok:false 帶說明", async () => {
    const r = await discoverChatId();
    expect(r.ok).toBe(false);
    expect(r.error).toContain("token");
  });

  it("有 token（檔案）+ getUpdates 有訊息 → 抓最新 chat.id 並寫回設定檔", async () => {
    const p = path.join(tmpDir, "notifier.json");
    fs.writeFileSync(p, JSON.stringify({ botToken: "555:tok" }), "utf8");
    _setNotifierConfigPathForTest(p);
    const f = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        result: [
          { message: { chat: { id: 111, first_name: "舊" } } },
          { message: { chat: { id: 22233, first_name: "Dannis" } } },
        ],
      }),
    });
    vi.stubGlobal("fetch", f);
    const r = await discoverChatId();
    expect(String(f.mock.calls[0][0])).toContain("bot555:tok/getUpdates");
    expect(r.ok).toBe(true);
    expect(r.chatId).toBe("22233");
    // 寫回設定檔（token 保留）
    const savedCfg = JSON.parse(fs.readFileSync(p, "utf8"));
    expect(savedCfg.botToken).toBe("555:tok");
    expect(savedCfg.chatId).toBe("22233");
    // 之後 isNotifierConfigured 直接 true
    expect(isNotifierConfigured()).toBe(true);
  });

  it("token 來自 env（檔案沒 token）→ 寫回設定檔只寫 chatId，env token 絕不落地", async () => {
    const p = path.join(tmpDir, "notifier.json");
    _setNotifierConfigPathForTest(p); // 檔案不存在——token 只在 env
    process.env.TELEGRAM_BOT_TOKEN = "999:secret-env-token";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        result: [{ message: { chat: { id: 777, first_name: "Dannis" } } }],
      }),
    }));
    const r = await discoverChatId();
    expect(r.ok).toBe(true);
    expect(r.chatId).toBe("777");
    const savedCfg = JSON.parse(fs.readFileSync(p, "utf8"));
    expect(savedCfg.chatId).toBe("777");
    // 機密不落地：env 的 token 不可被寫進檔案
    expect(savedCfg.botToken).toBeUndefined();
    expect(fs.readFileSync(p, "utf8")).not.toContain("secret-env-token");
  });

  it("getUpdates 沒有任何訊息 → ok:false 提示先跟 bot 說話", async () => {
    const p = path.join(tmpDir, "notifier.json");
    fs.writeFileSync(p, JSON.stringify({ botToken: "555:tok" }), "utf8");
    _setNotifierConfigPathForTest(p);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: [] }),
    }));
    const r = await discoverChatId();
    expect(r.ok).toBe(false);
    expect(r.error).toContain("先");
  });

  it("網路炸掉 → ok:false 不拋錯", async () => {
    const p = path.join(tmpDir, "notifier.json");
    fs.writeFileSync(p, JSON.stringify({ botToken: "555:tok" }), "utf8");
    _setNotifierConfigPathForTest(p);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("斷網")));
    await expect(discoverChatId()).resolves.toMatchObject({ ok: false });
  });

  it("token 錯（Telegram 回 ok:false）→ 帶回 Telegram 錯誤原話，不誤導成沒訊息", async () => {
    const p = path.join(tmpDir, "notifier.json");
    fs.writeFileSync(p, JSON.stringify({ botToken: "bad:token" }), "utf8");
    _setNotifierConfigPathForTest(p);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 401,
      json: () => Promise.resolve({ ok: false, description: "Unauthorized" }),
    }));
    const r = await discoverChatId();
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Unauthorized");
  });
});

describe("getNotifierStatus — 新形狀（不洩漏完整 token）", () => {
  it("無設定 → source:none, configured:false, botTokenMasked:null, chatId:null, envLocked:false", () => {
    const s = getNotifierStatus();
    expect(s.configured).toBe(false);
    expect(s.source).toBe("none");
    expect(s.botTokenMasked).toBeNull();
    expect(s.chatId).toBeNull();
    expect(s.envLocked).toBe(false);
  });

  it("env 設定 → source:env, envLocked:true, token 遮罩（不含完整 token）", () => {
    process.env.TELEGRAM_BOT_TOKEN = "7123456789:AAHxAbcdefGHIJKLMNOP";
    process.env.TELEGRAM_CHAT_ID = "42";
    const s = getNotifierStatus();
    expect(s.source).toBe("env");
    expect(s.envLocked).toBe(true);
    expect(s.configured).toBe(true);
    expect(s.chatId).toBe("42");
    // 不洩漏完整 token
    expect(s.botTokenMasked).not.toBe("7123456789:AAHxAbcdefGHIJKLMNOP");
    expect(s.botTokenMasked).toContain("…");
    expect(s.botTokenMasked).toBeTruthy();
    // 前 4 後 4
    expect(s.botTokenMasked).toMatch(/^7123…MNOP$/);
  });

  it("file 設定 → source:file, envLocked:false, token 遮罩", () => {
    const p = path.join(tmpDir, "notifier.json");
    fs.writeFileSync(p, JSON.stringify({ botToken: "555:tok1234", chatId: "77" }), "utf8");
    _setNotifierConfigPathForTest(p);
    const s = getNotifierStatus();
    expect(s.source).toBe("file");
    expect(s.envLocked).toBe(false);
    expect(s.configured).toBe(true);
    expect(s.chatId).toBe("77");
    // 不洩漏完整 token
    expect(s.botTokenMasked).not.toBe("555:tok1234");
    expect(s.botTokenMasked).toBeTruthy();
  });

  it("token 過短（≤8 字元）→ 遮罩為 ****", () => {
    const p = path.join(tmpDir, "notifier.json");
    fs.writeFileSync(p, JSON.stringify({ botToken: "12:abcd" }), "utf8");
    _setNotifierConfigPathForTest(p);
    const s = getNotifierStatus();
    expect(s.botTokenMasked).toBe("****");
  });

  it("env 優先於 file → source:env, envLocked:true", () => {
    const p = path.join(tmpDir, "notifier.json");
    fs.writeFileSync(p, JSON.stringify({ botToken: "999:file", chatId: "77" }), "utf8");
    _setNotifierConfigPathForTest(p);
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    process.env.TELEGRAM_CHAT_ID = "42";
    const s = getNotifierStatus();
    expect(s.source).toBe("env");
    expect(s.envLocked).toBe(true);
    // env 的 chatId 優先
    expect(s.chatId).toBe("42");
  });
});

describe("writeNotifierConfig — 寫入/合併/清除設定檔", () => {
  it("新寫入 botToken + chatId → 設定檔包含兩欄", () => {
    const p = path.join(tmpDir, "notifier.json");
    _setNotifierConfigPathForTest(p);
    const r = writeNotifierConfig({ botToken: "123:abc456", chatId: "42" });
    expect(r.ok).toBe(true);
    const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
    expect(cfg.botToken).toBe("123:abc456");
    expect(cfg.chatId).toBe("42");
  });

  it("合併：只更新有給的欄位，既有欄位不動", () => {
    const p = path.join(tmpDir, "notifier.json");
    fs.writeFileSync(p, JSON.stringify({ botToken: "123:abc456", chatId: "42" }), "utf8");
    _setNotifierConfigPathForTest(p);
    const r = writeNotifierConfig({ chatId: "99" });
    expect(r.ok).toBe(true);
    const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
    expect(cfg.botToken).toBe("123:abc456"); // 未動
    expect(cfg.chatId).toBe("99"); // 更新
  });

  it("空字串清除該欄位", () => {
    const p = path.join(tmpDir, "notifier.json");
    fs.writeFileSync(p, JSON.stringify({ botToken: "123:abc456", chatId: "42" }), "utf8");
    _setNotifierConfigPathForTest(p);
    const r = writeNotifierConfig({ botToken: "" });
    expect(r.ok).toBe(true);
    const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
    expect(cfg.botToken).toBeUndefined(); // 清除
    expect(cfg.chatId).toBe("42"); // 未動
  });

  it("回傳最新 NotifierStatus（source/botTokenMasked 正確）", () => {
    const p = path.join(tmpDir, "notifier.json");
    _setNotifierConfigPathForTest(p);
    const r = writeNotifierConfig({ botToken: "123:abc456", chatId: "42" });
    expect(r.ok).toBe(true);
    expect(r.status?.configured).toBe(true);
    expect(r.status?.source).toBe("file");
    // 不洩漏完整 token
    expect(r.status?.botTokenMasked).not.toBe("123:abc456");
    expect(r.status?.botTokenMasked).toBeTruthy();
  });

  it("configPath 未設定（測試環境 ''）→ ok:false，不拋錯", () => {
    _setNotifierConfigPathForTest("");
    const r = writeNotifierConfig({ botToken: "123:abc456" });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("寫完立即生效：isNotifierConfigured 反映最新狀態（不重啟即生效）", () => {
    const p = path.join(tmpDir, "notifier.json");
    _setNotifierConfigPathForTest(p);
    expect(isNotifierConfigured()).toBe(false);
    writeNotifierConfig({ botToken: "123:abc456", chatId: "42" });
    // readConfig() 每次呼叫都讀檔 → 立即反映
    expect(isNotifierConfigured()).toBe(true);
  });
});
