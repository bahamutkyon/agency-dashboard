# 🏢 專家團隊儀表板

把 [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) 211 位中文 agent
變成一個**多工協作、可排程、可分專案**的本地儀表板。

> **不夾帶任何認證**:你跑這份 dashboard 用的是**你自己**的 Claude Code 登入。
> 別人下載這份 repo,用他自己的 Claude 訂閱(或 API key)就能完整使用。

---

## ✨ 功能

- 🏢 **211 位 agent** 可同時開多個對話 tab,並行作業
- 👨‍💼 **專案經理(Orchestrator)** — 給它一個專案描述,它推薦該找哪幾位 agent + 派工順序
- 🎯 **批次同題** — 同一個 prompt 派給多位 agent,並排比較
- → **一鍵接力** — 任何訊息可一鍵轉交給其他 agent 接著處理
- 📒 **共享筆記** — 寫一次品牌語氣 / 產品資訊,任何對話可附加為 context
- 📋 **Prompt 模板庫** — 對話框打 `/` 快速插入常用指令
- ⏰ **cron 排程** — 讓 agent 在指定時間自動跑(週報、選題、追蹤等)
- 🏷️ **Tag / 全文搜尋** — 對話多了也找得到舊資料
- 💰 **用量顯示** — 即時看 5 小時 quota、今日成本、7 天統計
- ✨ **對話摘要** — 一鍵把長對話濃縮成結論 + 重點 + 下一步
- 🗂️ **多工作區隔離** — 不同專案完全分開,每個工作區自帶「專案備忘錄」自動注入給每位 agent
- 🌙 **深 / 淺主題** + 字體大小 + 桌面通知(`⚙️ 設定`入口)
- 📝 **Markdown 渲染** + 訊息一鍵複製 + 編輯重送 / 重新產生
- 📎 **拖曳上傳檔案** — 直接把圖片 / 文件丟進對話框

---

## 📋 系統需求

| 軟體 | 版本 |
|---|---|
| Node.js | **22 或更高**(推薦 LTS。Windows 用戶 Node 22 開始有內建 SQLite,**不需要 Visual Studio**) |
| Claude CLI | 最新版 — [安裝指南](https://claude.com/claude-code) |
| Claude 訂閱 | Pro / Max(透過 OAuth 用訂閱額度,免 API key);或設定 `ANTHROPIC_API_KEY` |
| agents 庫 | clone [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) 並執行其 install 腳本 |

---

## 🚀 快速開始

### 1️⃣ 安裝 Claude CLI 並登入

```bash
# 跨平台安裝(細節參照官方文件)
# 安裝完成後:
claude /login
# 或設定 API key:
# export ANTHROPIC_API_KEY=sk-...
```

### 2️⃣ 安裝 agents 庫(211 位中文 agent)

```bash
git clone https://github.com/jnMetaCode/agency-agents-zh.git
cd agency-agents-zh
./scripts/install.sh --tool claude-code
# Windows 改用:bash scripts/install.sh --tool claude-code
```

這會把 211 個 .md 複製到 `~/.claude/agents/`。

### 3️⃣ 安裝 dashboard 本身

```bash
git clone <this-repo>
cd agency-dashboard

# Windows
start.bat

# macOS / Linux
chmod +x start.sh
./start.sh
```

`start` 腳本會自動:
1. 第一次安裝 npm 依賴
2. 檢查 Node 版本、claude CLI、登入狀態、agents 是否就位
3. 啟動前後端
4. 提示你開瀏覽器到 **http://localhost:5190**

如果出問題,單獨執行 `npm run check` 看錯誤訊息。

---

## 🗂️ 工作區(專案隔離)

每個工作區是完全獨立的「辦公室」:
- 對話、筆記、模板、排程都只屬於該工作區
- 切換工作區 → 整個 dashboard 換成那個專案的內容
- 每個工作區有「**專案備忘錄**」 — 寫一次,**該工作區所有 agent 對話自動帶上這層 context**

範例配置:

```
工作區「外勞仲介」:
  專案備忘錄:業務領域、客戶類型、合規要點、合作國
  📒 筆記:常用合約模板、客戶名單
  ⏰ 排程:每週客戶回訪提醒

工作區「個人 IP」:
  專案備忘錄:品牌定位、受眾畫像、平台策略、禁用詞
  📒 筆記:內容指南、選題庫
  ⏰ 排程:每週日選題會議
```

同一位 agent 在兩個工作區會收到完全不同的 context,**不會串味**。

---

## 🔐 認證怎麼運作(很重要)

這份 dashboard **不儲存、不傳輸、不夾帶任何認證**。

它的工作方式是:**spawn 你本機的 `claude` 子程序**,並從 stdin / stdout 串流訊息。
所以它能用的認證 = `claude` CLI 在你電腦上能用的認證。

| 你怎麼登入 claude | dashboard 走哪條 |
|---|---|
| `claude /login`(OAuth) | 用你 Claude 訂閱額度(Max / Pro) |
| 設定 `ANTHROPIC_API_KEY` | 用 API 計費 |

朋友拿到這份 repo:
1. 他們各自裝 claude CLI、各自登入
2. 跑同一份 dashboard
3. **完全用他們自己的訂閱**,你看不到他們的對話、他們也看不到你的

對話資料存在 `server/data/store.db`(本機 SQLite),從不離開機器。

---

## 📁 專案結構

```
agency-dashboard/
├── start.bat / start.sh      ← 一鍵啟動
├── package.json               ← 根層 scripts(dev / check / install:all)
├── client/                    ← Vite + React + Tailwind
├── server/                    ← Express + Socket.IO + SQLite + node-cron
│   └── data/store.db          ← 你的資料(對話、筆記、模板、排程)
└── scripts/check-env.mjs      ← 環境檢查
```

---

## 🛠️ 開發指令

```bash
npm run setup        # 一次:安裝 + 環境檢查
npm run check        # 環境檢查
npm run dev          # 啟動前後端
npm run build        # 建構前端 production bundle
```

## 🇹🇼 簡轉繁(可選)

agency-agents-zh 上游是簡體中文。我提供一個一鍵轉繁體腳本(用 OpenCC,業界標準):

```bash
npm run traditionalize:dry      # 試跑(只看會改哪些,不寫檔)
npm run traditionalize          # 實際轉換,原檔備份成 .simplified.bak
npm run traditionalize:revert   # 還原為原始簡體
```

**會自動跳過大陸特定平台**(微信、小紅書、微博、抖音、快手、百度、知乎、B站、釘釘、飛書、高考、政務、中國電商等),這些 agent 針對 CN 平台,保留簡體更貼近原意。

193 / 211 個 agent 會被轉換,18 個 CN 平台 agent 保持原樣。

埠口:
- 前端 Vite dev server: `5190`
- 後端 Express + WebSocket: `5191`

---

## 🐛 常見問題

**Q: `npm run check` 顯示 agents 目錄為空?**
A: 還沒裝 agents 庫,看上面「2️⃣」步驟。

**Q: 開啟對話時超慢、第一句要 30 秒+?**
A: 第一句要載入 agent 系統 prompt + 建立 OAuth session,之後同一個 session 都會很快。

**Q: 為什麼會看到「rate_limit / 已耗盡」?**
A: Max 訂閱有 5 小時滾動視窗額度。同時開太多 agent 並行(批次同題、排程同時跑)會吃光。
看頂部 UsageBar 監控,額度緊張時暫停一些 schedule。

**Q: SQLite 顯示 `ExperimentalWarning`?**
A: Node 內建的 `node:sqlite` 還是 experimental 標籤,但 Node 22+ 跑得很穩定,可以忽略。

**Q: 我能把對話分享給朋友嗎?**
A: 任何對話 → 右上「匯出 .md」,把產生的 Markdown 檔給他即可。

---

## 🔌 當作 MCP server 給其他 AI 工具用(v0.10+)

讓 Cursor / Claude Code / Continue 等 AI 工具能調用我們的 workflow:

### 1. 確認 dashboard 在跑
```bash
npm run dev   # 確保 localhost:5191 有 server
```

### 2. 在你的 AI 工具設定 MCP

**Claude Code** — 編輯 `~/.claude.json`,在 `mcpServers` 加:
```json
{
  "mcpServers": {
    "agency-dashboard": {
      "command": "npx",
      "args": ["-y", "tsx", "/abs/path/to/agency-dashboard/server/src/mcpServer.ts"]
    }
  }
}
```

或用我們提供的 npm script(同 repo 內):
```bash
npm run mcp    # 啟動 stdio MCP server
```

### 3. 你的 AI 工具會看到這些 tool
- `agency_list_workflows` — 列出可用 workflows
- `agency_run_workflow(workflow_id, initial_input)` — 執行 workflow,等完成回傳所有步驟輸出
- `agency_list_agents(category, search)` — 找專家
- `agency_chat_with_agent(agent_id, message)` — 單輪請教
- `agency_list_notes()` — 取工作區筆記
- `agency_search_sessions(query)` — 全文搜過往對話

### 環境變數
- `DASHBOARD_URL`(預設 `http://localhost:5191`)
- `AGENCY_WORKSPACE`(預設 `default`)

可以針對不同工作區開不同 MCP server instance。

---

## 🔖 版本管理(給維護者)

版號遵循 [SemVer](https://semver.org/lang/zh-TW/):**主.次.修**(例 `0.1.0`)。

### 日常修改

```bash
# 改完任何東西
git add .
git commit -m "敘述你做了什麼"
git push
```

對應的修改也順手寫到 [`CHANGELOG.md`](./CHANGELOG.md) 的 `[Unreleased]` 區塊。

### 想發新版

當累積夠多修改、或想標記一個里程碑時:

```bash
npm run release:patch    # 修 bug:0.1.0 → 0.1.1
npm run release:minor    # 加新功能:0.1.0 → 0.2.0
npm run release:major    # 破壞性改動:0.1.0 → 1.0.0
```

這會自動:
1. 把 `package.json` 的版號 bump 一級
2. 建一個 commit `chore: release vX.Y.Z`
3. 打 git tag `vX.Y.Z`
4. push commit + tag 到 GitHub

GitHub repo 的 [Releases](https://github.com/bahamutkyon/agency-dashboard/releases) 頁面會看到所有版本,朋友想下載特定版可以直接抓 tag。

### 改完版號後

把 `CHANGELOG.md` 的 `[Unreleased]` 區塊內容**剪下**,在上面新增 `## [X.Y.Z] — YYYY-MM-DD` 區塊,把內容貼進去。下次 commit 一起推上去。

(之後可以再寫腳本自動化這步,目前手動最簡單。)

---

## 授權

本儀表板程式碼:MIT
依賴的 agent 內容:依照 [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) 的授權
