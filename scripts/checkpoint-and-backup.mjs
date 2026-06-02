import { DatabaseSync } from "node:sqlite";
import { copyFileSync, statSync, existsSync } from "node:fs";

const DB = "server/data/store.db";

console.log("[1/3] WAL checkpoint…");
const db = new DatabaseSync(DB);
const result = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
console.log("  result:", result);
db.close();

console.log("[2/3] 備份 (overwrite)…");
const bak = `${DB}.bak.2026-06-01`;
copyFileSync(DB, bak);
console.log(`  ${bak} - ${statSync(bak).size} bytes`);

console.log("[3/3] WAL/SHM 狀態：");
for (const ext of ["-wal", "-shm"]) {
  const p = DB + ext;
  if (existsSync(p)) {
    const s = statSync(p);
    console.log(`  ${p}: ${s.size} bytes`);
  } else {
    console.log(`  ${p}: (不存在)`);
  }
}
console.log("完成。主 DB 已包含所有資料。");
