/**
 * routes/watchtower.ts HTTP 端點測試
 *
 * 照 app.test.ts 的 app.listen(0) + fetch 模式。
 * afterAll 清 DB。
 * watchtowerScheduler.sync() 在 routes 被呼叫但 scheduler 未 init 不會爆（sync 只 list+register）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { app } from "./index.js";
import { db } from "./db.js";

let server: Server;
let base: string;
const createdTaskIds: string[] = [];

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  for (const id of createdTaskIds) {
    try { db.prepare("DELETE FROM watchtower_tasks WHERE id = ?").run(id); } catch {}
    try { db.prepare("DELETE FROM watchtower_logs WHERE task_id = ?").run(id); } catch {}
  }
  server?.close();
});

const WS = "ws_route_test";
const headers = {
  "Content-Type": "application/json",
  "x-workspace": WS,
};

// ─── Tasks CRUD ───────────────────────────────────────────────────────────────

describe("GET /api/watchtower/tasks", () => {
  it("回傳 tasks 陣列（可空）", async () => {
    const r = await fetch(`${base}/api/watchtower/tasks`, { headers });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(Array.isArray(j.tasks)).toBe(true);
  });
});

describe("POST /api/watchtower/tasks", () => {
  it("缺必填欄位 → 400", async () => {
    const r = await fetch(`${base}/api/watchtower/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "沒有 cron" }),
    });
    expect(r.status).toBe(400);
  });

  it("無效 cron → 400", async () => {
    const r = await fetch(`${base}/api/watchtower/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "爛 cron", cron: "不是 cron" }),
    });
    expect(r.status).toBe(400);
  });

  it("正確建立 → 201 + task 物件", async () => {
    const r = await fetch(`${base}/api/watchtower/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "每小時看守", cron: "0 * * * *", dailyQuota: 5 }),
    });
    expect(r.status).toBe(201);
    const j = await r.json() as any;
    expect(j.task?.id).toBeTruthy();
    expect(j.task?.name).toBe("每小時看守");
    createdTaskIds.push(j.task.id);
  });
});

describe("GET /api/watchtower/tasks/:id", () => {
  it("不存在 → 404", async () => {
    const r = await fetch(`${base}/api/watchtower/tasks/nonexistent_xxx`, { headers });
    expect(r.status).toBe(404);
  });

  it("其他工作區的 task → 404（工作區隔離）", async () => {
    // 先在 ws_route_test 建
    const cr = await fetch(`${base}/api/watchtower/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "隔離測試", cron: "0 * * * *" }),
    });
    const created = await cr.json() as any;
    createdTaskIds.push(created.task.id);

    // 用另一個 ws 查
    const r = await fetch(`${base}/api/watchtower/tasks/${created.task.id}`, {
      headers: { ...headers, "x-workspace": "ws_other_999" },
    });
    expect(r.status).toBe(404);
  });

  it("正確查到自己工作區的 task", async () => {
    const cr = await fetch(`${base}/api/watchtower/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "查詢測試任務", cron: "0 * * * *" }),
    });
    const created = await cr.json() as any;
    createdTaskIds.push(created.task.id);

    const r = await fetch(`${base}/api/watchtower/tasks/${created.task.id}`, { headers });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.task.name).toBe("查詢測試任務");
  });
});

describe("PATCH /api/watchtower/tasks/:id", () => {
  it("更新 name", async () => {
    const cr = await fetch(`${base}/api/watchtower/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "待更新", cron: "0 * * * *" }),
    });
    const created = await cr.json() as any;
    createdTaskIds.push(created.task.id);

    const r = await fetch(`${base}/api/watchtower/tasks/${created.task.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ name: "已更新" }),
    });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.task.name).toBe("已更新");
  });

  it("其他工作區無法更新 → 404", async () => {
    const cr = await fetch(`${base}/api/watchtower/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "不可改", cron: "0 * * * *" }),
    });
    const created = await cr.json() as any;
    createdTaskIds.push(created.task.id);

    const r = await fetch(`${base}/api/watchtower/tasks/${created.task.id}`, {
      method: "PATCH",
      headers: { ...headers, "x-workspace": "ws_hacker" },
      body: JSON.stringify({ name: "被偷改" }),
    });
    expect(r.status).toBe(404);
  });
});

describe("DELETE /api/watchtower/tasks/:id", () => {
  it("正常刪除 → 200 {ok:true}", async () => {
    const cr = await fetch(`${base}/api/watchtower/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "待刪除", cron: "0 * * * *" }),
    });
    const created = await cr.json() as any;
    // 不加到 createdTaskIds，因為要測刪除
    const id = created.task.id;

    const r = await fetch(`${base}/api/watchtower/tasks/${id}`, {
      method: "DELETE",
      headers,
    });
    expect(r.status).toBe(200);
    expect((await r.json() as any).ok).toBe(true);

    // 確認已刪
    const check = await fetch(`${base}/api/watchtower/tasks/${id}`, { headers });
    expect(check.status).toBe(404);
  });

  it("其他工作區無法刪除 → 404", async () => {
    const cr = await fetch(`${base}/api/watchtower/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "不可刪", cron: "0 * * * *" }),
    });
    const created = await cr.json() as any;
    createdTaskIds.push(created.task.id);

    const r = await fetch(`${base}/api/watchtower/tasks/${created.task.id}`, {
      method: "DELETE",
      headers: { ...headers, "x-workspace": "ws_hacker" },
    });
    expect(r.status).toBe(404);
  });
});

// ─── Logs ──────────────────────────────────────────────────────────────────────

describe("GET /api/watchtower/logs", () => {
  it("不帶 taskId → 回傳工作區全部 logs（可空）", async () => {
    const r = await fetch(`${base}/api/watchtower/logs`, { headers });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(Array.isArray(j.logs)).toBe(true);
  });

  it("taskId 不屬於此工作區 → 404", async () => {
    // 先在 ws_route_test 建任務
    const cr = await fetch(`${base}/api/watchtower/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "log 隔離任務", cron: "0 * * * *" }),
    });
    const created = await cr.json() as any;
    createdTaskIds.push(created.task.id);

    // 用另一個 ws 查 logs → 404
    const r = await fetch(
      `${base}/api/watchtower/logs?taskId=${created.task.id}`,
      { headers: { ...headers, "x-workspace": "ws_evil" } },
    );
    expect(r.status).toBe(404);
  });

  it("正確 taskId + 工作區 → 200 + logs 陣列", async () => {
    const cr = await fetch(`${base}/api/watchtower/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "有 log 的任務", cron: "0 * * * *" }),
    });
    const created = await cr.json() as any;
    createdTaskIds.push(created.task.id);

    const r = await fetch(
      `${base}/api/watchtower/logs?taskId=${created.task.id}`,
      { headers },
    );
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(Array.isArray(j.logs)).toBe(true);
  });
});
