import { defineConfig } from "vitest/config";

// SQLite store 是單一檔案 DB（data/store.db）。多個測試檔並行寫入會觸發
// "database is locked"。強制單一 fork 序列執行，犧牲一點速度換穩定。
export default defineConfig({
  test: {
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
