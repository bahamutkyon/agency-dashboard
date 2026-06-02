/**
 * 依 review.json 批次執行 promote / delete，透過 API 打到正在跑的 dashboard。
 */
import { readFileSync, writeFileSync } from "node:fs";
const review = JSON.parse(readFileSync("scripts/review.json", "utf8"));

const BASE = "http://127.0.0.1:5191";

async function callPromote(kind, id, toScope, toWorkspaceId = "") {
  const url = `${BASE}/api/learning/legacy/${kind}/${encodeURIComponent(id)}/promote`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toScope, toWorkspaceId }),
  });
  if (!r.ok) {
    const e = await r.text();
    throw new Error(`HTTP ${r.status}: ${e}`);
  }
  return r.json();
}

async function callDelete(kind, id) {
  const url = `${BASE}/api/learning/legacy/${kind}/${encodeURIComponent(id)}`;
  const r = await fetch(url, { method: "DELETE" });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  return r.json();
}

const log = { ok: [], failed: [] };

async function executeOne(kind, item) {
  try {
    if (item.action === "promote-global") {
      await callPromote(kind, item.id, "global");
    } else if (item.action === "promote-workspace") {
      await callPromote(kind, item.id, "workspace", item.toWorkspaceId);
    } else if (item.action === "delete") {
      await callDelete(kind, item.id);
    } else {
      throw new Error(`unknown action: ${item.action}`);
    }
    log.ok.push({ kind, id: item.id, action: item.action });
  } catch (e) {
    log.failed.push({ kind, id: item.id, action: item.action, error: e.message });
  }
}

console.log(`執行 ${review.craft.length} craft + ${review.category.length} category…\n`);

// 並行 5 條一批，避免炸後端
const all = [
  ...review.craft.map((v) => ({ kind: "craft", item: v })),
  ...review.category.map((v) => ({ kind: "category", item: v })),
];

const BATCH = 5;
for (let i = 0; i < all.length; i += BATCH) {
  const batch = all.slice(i, i + BATCH);
  await Promise.all(batch.map(({ kind, item }) => executeOne(kind, item)));
  process.stdout.write(`\r進度: ${Math.min(i + BATCH, all.length)} / ${all.length}`);
}
console.log("");

console.log("\n--- 結果 ---");
console.log(`成功: ${log.ok.length}`);
console.log(`失敗: ${log.failed.length}`);
if (log.failed.length) {
  console.log("\n失敗清單:");
  for (const f of log.failed) {
    console.log(`  - ${f.kind}/${f.id}: ${f.error}`);
  }
}

writeFileSync("scripts/execute-log.json", JSON.stringify(log, null, 2));
console.log("\n寫入 scripts/execute-log.json");
