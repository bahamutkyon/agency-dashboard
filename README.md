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
- 🛡️ **基線安全防護(Shellward)** — 偵測到就強制注入,prompt injection / 危險命令 / PII 外洩 / 資料外送鏈一律攔下,工作區關不掉。右上角護盾即時顯示「保護中 / 未啟用 + 已保護幾場對話」
- 🧠 **能力總覽徽章** — 右上 🧠 一眼看出你機器上 21 skills + 7 MCPs + 211 agents 是否全到位,缺項有一鍵複製的 fix 指令
- 🩺 **`npm run doctor` + `npm run setup:full`** — 體檢報告 + 互動式安裝精靈,新機器 / 朋友 clone 後 5 分鐘搞定
- 📱 **手機 / 遠端存取(可選)** — 透過 Tailscale 或 Cloudflare Tunnel 從手機 / 平板用 dashboard,內建 PWA(可加到主畫面),預設關閉不影響本機使用
- 🛠️ **內建 workflow 範本庫** — 一鍵跑「AI 編程工具諮詢 → 配置檔產出」「品牌定位 → 內容生產 → 多平台分發」等多步驟協作模板

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

### 🌟 推薦:一鍵完整安裝(新機器 / 朋友 clone 用這個)

```bash
git clone <this-repo>
cd agency-dashboard
npm install
npm run setup:full   # 互動式精靈,逐步問你要不要裝 skills / agents / 7 個 MCP
npm run doctor       # 體檢,確認所有能力都到位
start.bat            # Windows 啟動 / Linux/Mac: ./start.sh
```

`setup:full` 會自動帶你裝齊:
- 📚 21 個 skills(superpowers-zh + bundled chinese-presentation-style)
- 👥 211 位 agents(agency-agents-zh)
- 🔌 7 個 MCP servers(shellward / playwright / doc-ops / excel / powerpoint / gemini-image / google-workspace)
- ⌨️ Codex / Gemini CLI(可選)

**每一步都先問你**,絕不偷偷動家目錄。`~/.claude.json` 修改前會自動備份。

---

### 🛠 手動分步安裝(進階)

#### 1️⃣ 安裝 Claude CLI 並登入

```bash
# 跨平台安裝(細節參照官方文件)
# 安裝完成後:
claude /login
# 或設定 API key:
# export ANTHROPIC_API_KEY=sk-...
```

#### 2️⃣ 安裝 agents 庫(211 位中文 agent)

```bash
git clone https://github.com/jnMetaCode/agency-agents-zh.git
cd agency-agents-zh
./scripts/install.sh --tool claude-code
# Windows 改用:bash scripts/install.sh --tool claude-code
```

這會把 211 個 .md 複製到 `~/.claude/agents/`。

#### 3️⃣ 啟動 dashboard

```bash
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

如果出問題,單獨執行 `npm run check` 看錯誤訊息;`npm run doctor` 看完整體檢報告。

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

## 🧠 站在 Claude Code 全域配置之上(三層繼承)

dashboard 不是孤島,它**站在你 Claude Code 的家目錄配置之上**。每個 agent 對話都會自動繼承你機器上裝的東西:

```
~/CLAUDE.md          ← 你的全域指令(中文團隊規範等)
~/.claude/
  ├── skills/        ← 21 個 skills(思考框架、品味規範)
  ├── agents/        ← 211 位 agent 的人設
  └── ...
~/.claude.json       ← 7 個 MCP servers(瀏覽器、Office、安全防護)
```

→ **每位 dashboard agent 都會自動拿到這些 buff**,不需要任何整合工作。

### 你機器上完整一套 = 朋友 clone 也要一套

| 層 | 來源 | 沒裝會怎樣 |
|---|---|---|
| 🎭 **Agents (211)** | `agency-agents-zh` | dashboard 沒專家可選,核心功能掛掉 |
| 📚 **Skills (21)** | `superpowers-zh` + 本 repo bundled | agent 行為變單薄,不會自動跑 TDD / brainstorm 等流程 |
| 🔌 **MCPs (7)** | npm-global / pip(每個獨立裝) | 該功能就沒了(但 baseline shellward 沒裝會跳警示) |
| ⌨️ **CLI** | claude / codex / gemini | 沒 claude 就動不了,codex/gemini 是備胎 |

朋友 clone 之後**只要跑 `npm run setup:full`**,精靈會比對 `capabilities.manifest.json` 自動補齊缺項。

### UI 上隨時看狀態

dashboard 右上角:
- 🛡️ **SecurityBadge** — baseline 防護是否啟用(shellward)
- 🧠 **CapabilitiesBadge** — 28/29 之類的數字,點開分四個 tab(Skills / MCPs / Agents / CLI)詳列每一項狀態 + 缺項的 fix 指令(可一鍵複製)

### CLI 體檢

```bash
npm run doctor      # 比對 manifest,輸出彩色報告 + fix 指令(只讀,不改)
npm run setup:full  # 互動式安裝精靈(改檔但每步先問)
```

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

## 📱 手機 / 遠端存取(可選功能,預設關閉)

dashboard 預設只綁 `127.0.0.1`(只有你電腦本機能連),跟筆電上的本機 server 一樣安全。
**沒做任何設定就保持這樣**,不用擔心 clone 下來莫名暴露。

如果你想從**手機 / 平板 / 另一台筆電**用 dashboard,以下三條路任選。

---

### 🤔 先選對工具

| 場景 | 推薦方案 | 為什麼 |
|---|---|---|
| 只在家裡用(同 WiFi) | **LAN-only**(下面 ⓒ) | 最簡單,不用裝任何 app |
| 出門 / 通勤 / 咖啡店都想用 | **🌟 Tailscale**(下面 ⓐ) | 完全私密、跨網路、永久免費 |
| 想用「任何電腦」連(別人筆電 / 客戶辦公室) | **Cloudflare Tunnel**(下面 ⓑ) | 拿 https URL 隨便連,但要設 token |
| 多人共用同一台 dashboard | **不建議**,改各自部署 | 認證系統不夠完善,容易踩坑 |

---

### ⓐ 🌟 Tailscale(推薦 — 免費、完全私密、無流量限制)

Tailscale 是 P2P VPN — 你的裝置之間直接連,流量**不過第三方伺服器**(Tailscale 只負責協調 NAT 穿透)。
**個人方案永久免費**:100 個裝置、3 個帳號、無流量上限、無連線數限制。

#### 設定步驟

```bash
# === 你電腦上 ===

# 1. 裝 Tailscale 並登入(用 Google / GitHub / Microsoft 帳號都行)
#    https://tailscale.com/download

# 2. 在 dashboard 根目錄建立 .env.local
cp .env.example .env.local

# 3. 編輯 .env.local,把這行解註解:
#    ENABLE_REMOTE_ACCESS=true

# 4. 重啟 dashboard(關掉 cmd 視窗,重開 start.bat)
#    啟動 log 應該看到:
#    [agency-dashboard] 🌐 listening on http://0.0.0.0:5191 (REMOTE ACCESS ENABLED)
#    [vite] 🌐 ENABLE_REMOTE_ACCESS=true → binding 0.0.0.0
```

```bash
# === 手機上 ===

# 1. App Store / Play Store 裝 Tailscale,用同一個帳號登入

# 2. 打開 Tailscale app 切到 ON,看「Devices」清單裡你電腦的 100.x.x.x IP
#    (例:你電腦顯示 100.64.0.5,以下用這個示意)

# 3. 手機瀏覽器開:
#    http://100.64.0.5:5190
```

#### 確認設定生效

| 檢查項目 | 怎麼看 |
|---|---|
| Server 開了 0.0.0.0 | dashboard 啟動 log 看到 `🌐 ... REMOTE ACCESS ENABLED` |
| 手機有連到 Tailscale | Tailscale app 裡你電腦那一行是綠點 |
| 兩端互通 | 手機瀏覽器能載入 dashboard 首頁 |
| UI 確認 | 右上角出現 📱 徽章(關閉時不會出現) |

---

### ⓑ 🌐 Cloudflare Tunnel(進階 — 公網存取、免費)

想**不靠 VPN、隨便哪台電腦都能連**?用 Cloudflare Tunnel 把 `localhost:5190` 暴露成 `https://xxx.trycloudflare.com` 公網 URL。

⚠️ **這時候務必設 `ACCESS_TOKEN`**,否則任何人拿到 URL 就能用你的 Claude 訂閱、看你的對話。

#### 設定步驟

```bash
# 1. 編輯 .env.local
ENABLE_REMOTE_ACCESS=true
ACCESS_TOKEN=<隨機強密碼,32 字元以上>

# 產生 token 的方法(任選):
# macOS / Linux:  openssl rand -base64 32
# Windows PS:     [Convert]::ToBase64String((1..32 | %{Get-Random -Max 256}))

# 2. 重啟 dashboard

# 3. 裝 Cloudflare Tunnel(只要裝一次)
# Windows: winget install Cloudflare.cloudflared
# macOS:   brew install cloudflared
# Linux:   見 https://github.com/cloudflare/cloudflared

# 4. 另開 terminal 跑 tunnel(這個視窗別關)
cloudflared tunnel --url http://localhost:5190

# 5. 看到輸出類似:
#    +--------------------------------------------------------------------------------------------+
#    |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
#    |  https://random-words-here.trycloudflare.com                                                |
#    +--------------------------------------------------------------------------------------------+
```

#### 第一次連線

手機 / 任何瀏覽器打:
```
https://random-words-here.trycloudflare.com/?token=<你的 ACCESS_TOKEN>
```

成功後 cookie 會自動存,之後**直接打 URL 不用再帶 token**(同一台裝置 30 天內有效)。

#### Cloudflare Tunnel 的注意事項

- **`trycloudflare.com` 是免費快速 tunnel**,**每次重啟 cloudflared URL 會變**(隨機域名)
- 想要固定 URL → 用自己的網域(免費):https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
- 免費版**頻寬不限**、**連線數不限**,但 ToS 寫不能拿來做大流量影音串流(對 dashboard 完全夠用)

---

### ⓒ 🏠 LAN-only(最簡單 — 只在家用)

只在家裡 WiFi 內用,不開公網,設定最少:

```bash
# .env.local
ENABLE_REMOTE_ACCESS=true
# 限縮白名單只接受 192.168.x.x 的家用 WiFi 網段:
ALLOW_RANGES=127.0.0.1,::1,192.168.0.0/16

# 重啟 dashboard,然後:
# Windows 找你電腦 IP:ipconfig | findstr IPv4
# macOS:           ifconfig | grep "inet "
# 找到 192.168.x.x 那一行,假設 192.168.1.100

# 手機(同一 WiFi)打:http://192.168.1.100:5190
```

⚠️ **離開家就連不到了** — 出門想用就要切到 Tailscale 或 Cloudflare Tunnel。

---

### 📲 加到手機主畫面(PWA)

dashboard 內建 PWA(Progressive Web App)。**任一上述方案連得上後**,手機都能加到主畫面,從此像 app 一樣用:

| 手機 | 步驟 |
|---|---|
| **iOS Safari** | 連到 dashboard → 底部「分享」按鈕 → 「加入主畫面」 |
| **Android Chrome** | 連到 dashboard → 右上 ⋮ → 「加入主畫面」或「安裝應用程式」 |

加入後:
- 桌面圖示是 dashboard 自己的 icon(深藍底 AD 字)
- 點開後**全螢幕**,沒有瀏覽器網址列
- 處理 iPhone 瀏海與底部 home indicator
- 對話輸入框字級調整成 16px,**不會觸發 iOS 自動 zoom**

---

### 🛡️ 安全機制(深度說明)

開啟 `ENABLE_REMOTE_ACCESS` 後,後端自動啟用三層獨立防護(每層可單獨配置):

#### 第 1 層:Bind host

| 設定 | 行為 |
|---|---|
| 預設(沒設 / 設 false) | server 綁 `127.0.0.1`,**只有電腦本機**能連,跟以前一樣 |
| `ENABLE_REMOTE_ACCESS=true` | server 綁 `0.0.0.0`,網卡上的所有介面都接受連線 |

#### 第 2 層:IP 白名單(只在 ENABLE_REMOTE_ACCESS=true 時生效)

預設允許**所有不可能是公網**的 IP 範圍:

| 網段 | 用途 |
|---|---|
| `127.0.0.1`, `::1` | localhost |
| `192.168.0.0/16` | 一般家用 WiFi |
| `10.0.0.0/8` | 公司 / 進階家用 / Docker |
| `172.16.0.0/12` | Docker / 部分企業網 |
| `100.64.0.0/10` | Tailscale CGNAT |

來自其他網段(例如公網 IP)的請求**直接 403 拒絕**,console 會 log warning。
→ **這就是為什麼即使你哪天不小心 port forward 5191 到公網,也不會立刻被打爆**。

想限縮成「**只 Tailscale**」(最私密):
```bash
ALLOW_RANGES=127.0.0.1,::1,100.64.0.0/10
```

想限縮成「**只家裡 WiFi**」:
```bash
ALLOW_RANGES=127.0.0.1,::1,192.168.0.0/16
```

#### 第 3 層:Token 認證(可選,公網場景必設)

```bash
ACCESS_TOKEN=<你的 token>
```

設了之後**所有 API 請求都要帶 token**,支援四種傳遞方式:

| 方式 | 用法 | 適合 |
|---|---|---|
| Authorization header | `Authorization: Bearer <token>` | 程式呼叫 |
| Custom header | `X-Access-Token: <token>` | 程式呼叫 |
| Query param | `?token=<token>` | 第一次瀏覽器連,自動存 cookie |
| Cookie | `agency_token=<token>` | 之後自動帶,免再輸 |

cookie 存活 30 天,過期後再用 `?token=...` 一次即可。

---

### 🔐 你的個人設定不會被推上 GitHub

`.gitignore` 已加入:

```
.env
.env.local
.env.*.local
```

repo 裡只追蹤 `.env.example` — **它只放佔位符與通用網段**(`192.168.0.0/16`、`100.64.0.0/10`),
**沒有任何你機器上的真實 IP / 主機名 / token**。

朋友 clone 下來,他們**完全不會看到**你的:
- Tailscale IP
- Cloudflare Tunnel URL
- ACCESS_TOKEN
- 任何 API key

他們需要自己 `cp .env.example .env.local` 然後填**他們自己**的設定。

---

### 🐛 故障排除

#### 手機連不到 dashboard?

依序檢查:

```bash
# 1. 確認 .env.local 有開 remote
cat .env.local | grep ENABLE_REMOTE_ACCESS
# 應該看到:ENABLE_REMOTE_ACCESS=true

# 2. 確認 dashboard 真的綁了 0.0.0.0
# 啟動 log 應該有:🌐 ... REMOTE ACCESS ENABLED
# 沒看到?→ 重啟 dashboard(關 cmd 視窗,重開 start.bat)

# 3. 確認手機與電腦在同一網路
#    Tailscale:兩邊 app 都是綠點
#    LAN:兩邊接同一個 WiFi SSID

# 4. 從電腦自己測一下對外 IP 通不通
#    PowerShell:Test-NetConnection <你的 LAN/Tailscale IP> -Port 5190
#    應該回 TcpTestSucceeded : True

# 5. Windows 防火牆可能擋 5190/5191
#    cmd 系統管理員身份:
#    netsh advfirewall firewall add rule name="agency-dashboard" dir=in action=allow protocol=TCP localport=5190-5191
```

#### 連到了但 API 都 403 / 401?

- 403:你的 IP 不在 `ALLOW_RANGES` 範圍內 → 改 `.env.local` 加進你的網段
- 401:你設了 `ACCESS_TOKEN` 但請求沒帶 token → URL 加 `?token=<你的 token>`

#### 右上角沒看到 📱 徽章?

徽章**只在 `ENABLE_REMOTE_ACCESS=true` 時才顯示**,沒看到代表 server 沒收到 env。檢查:
1. `.env.local` 是否在專案根目錄(不是 server/ 或 client/ 子目錄)
2. dashboard 是否真的重啟過(改 env 不會 hot reload)

#### Cloudflare Tunnel 用了一陣子被斷線?

- `trycloudflare.com` 免費 tunnel 設計上是**短期測試用**,長時間不穩
- 想要穩定 → 接自己的網域(免費,5 分鐘設定):
  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/

---

### ⚠️ 注意事項彙總

1. **Claude 訂閱額度共用** — 從手機跑 dashboard 用的還是你 Claude OAuth 訂閱,不是另一個額度。批次同題 + 排程同時跑會吃光 5 小時 quota
2. **對話資料不會雲端同步** — 都存在你電腦的 `server/data/store.db`,手機只是 thin client。電腦關機 = 手機連不上
3. **MCP 工具能力以電腦為準** — playwright / excel / powerpoint 等是裝在電腦上的,從手機呼叫等於遠端控制電腦執行
4. **公網場景一定要 token** — 沒設 ACCESS_TOKEN 又走 Cloudflare Tunnel = 任何人有 URL 就能燒你的 Claude 訂閱
5. **token 一旦洩漏立刻換** — 編 `.env.local` 改新 token,重啟,所有舊 cookie 失效

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

## 🤖 多 LLM 支援(Claude / Codex / Gemini)

預設使用 Claude(透過你 Claude Code 訂閱)。可選擇加裝其他 provider:

```bash
# OpenAI Codex(需 ChatGPT Plus / Pro)
npm install -g @openai/codex
codex login

# Google Gemini(需 Google AI Pro 或免費 API key)
npm install -g @google/gemini-cli
gemini auth login   # 或設 GEMINI_API_KEY
```

裝完重啟 dashboard,sidebar 卡片右上 hover 會出現 🧠 / 🤖 / ✨ 三個 provider 按鈕。

**Smart Router**(預設啟用)會自動為你選 provider — 規則優先,模糊問題用 Haiku 分類。**預設 Claude**,Codex / Gemini 是備胎。

---

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

## 📜 版本紀錄

每個版本的新功能與修復記錄在 [`CHANGELOG.md`](./CHANGELOG.md)。
[GitHub Releases](https://github.com/bahamutkyon/agency-dashboard/releases) 頁面可直接下載特定版本的 zip。

---

## 授權

本儀表板程式碼:MIT
依賴的 agent 內容:依照 [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) 的授權
