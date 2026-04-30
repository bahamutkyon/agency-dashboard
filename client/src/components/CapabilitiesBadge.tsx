import { useEffect, useState } from "react";

type Tier = "baseline" | "recommended" | "optional";

interface SkillItem { name: string; from: string; protected: boolean; installed: boolean; }
interface MCPItem {
  name: string;
  tier: Tier;
  description: string;
  installed: boolean;
  hasEnvKeys: boolean;
  manualSetupNote?: string;
  installCommand: string;
}
interface CLIItem { name: string; tier: "required" | "optional"; description: string; installed: boolean; installCommand: string; }
interface CapSummary {
  manifest_version: string;
  skills: { expected: number; installed: number; items: SkillItem[] };
  mcps: { expected: number; installed: number; items: MCPItem[] };
  agents: { expected: number; installed: number; categoriesCount: number };
  cli: CLIItem[];
  health: { healthy: boolean; missing_count: number; missing_critical: number };
}

type Tab = "skills" | "mcps" | "agents" | "cli";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-emerald-300 transition-colors"
      title="複製安裝指令"
    >
      {copied ? "✓ 已複製" : "📋 複製"}
    </button>
  );
}

export function CapabilitiesBadge() {
  const [s, setS] = useState<CapSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("skills");

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      fetch("/api/capabilities")
        .then((r) => r.json())
        .then((d) => alive && setS(d))
        .catch(() => {});
    refresh();
    const t = setInterval(refresh, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!s) return <div className="px-2 text-xs text-zinc-500">🧠 …</div>;

  const totalExpected = s.skills.expected + s.mcps.expected + 1 + s.cli.length;
  const totalInstalled = s.skills.installed + s.mcps.installed
    + (s.agents.installed >= s.agents.expected - 5 ? 1 : 0)
    + s.cli.filter((c) => c.installed).length;

  const dotColor = s.health.healthy ? "bg-emerald-400"
    : s.health.missing_critical > 0 ? "bg-rose-500"
    : "bg-amber-400";
  const labelColor = s.health.healthy ? "text-emerald-300"
    : s.health.missing_critical > 0 ? "text-rose-300"
    : "text-amber-300";

  const tip = s.health.healthy
    ? `所有能力已就位 (${totalInstalled}/${totalExpected})`
    : `缺 ${s.health.missing_count} 項${s.health.missing_critical > 0 ? `(其中 ${s.health.missing_critical} 個關鍵)` : ""}`;

  const skillsPanel = (
    <div className="space-y-1">
      <div className="text-zinc-400 text-[11px] mb-2">
        Skills 來自 superpowers-zh + 本 repo bundled,影響每位 dashboard agent 的協作流程
      </div>
      {s.skills.items.map((sk) => (
        <div key={sk.name} className="flex items-center gap-2">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${sk.installed ? "bg-emerald-400" : "bg-rose-500"}`} />
          <span className="font-mono text-zinc-200 text-[11px]">{sk.name}</span>
          {sk.protected && <span className="text-[9px] px-1 rounded bg-blue-500/20 text-blue-300">protected</span>}
          {sk.from !== "superpowers-zh" && <span className="text-[9px] text-zinc-500">{sk.from}</span>}
        </div>
      ))}
      {s.skills.installed < s.skills.expected && (
        <div className="mt-3 p-2 rounded bg-amber-500/10 text-amber-200 text-[11px]">
          缺 {s.skills.expected - s.skills.installed} 個 skill。執行 <code className="bg-zinc-800 px-1 rounded">npm run setup:full</code> 自動安裝。
        </div>
      )}
    </div>
  );

  const mcpsPanel = (
    <div className="space-y-2">
      <div className="text-zinc-400 text-[11px] mb-2">
        MCPs 是 dashboard agent 能呼叫的外部能力。baseline 強制注入,其他工作區可選擇性啟用。
      </div>
      {s.mcps.items.map((m) => (
        <div key={m.name} className="border border-zinc-800 rounded p-2">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${m.installed ? "bg-emerald-400" : "bg-rose-500"}`} />
            <span className="font-mono text-zinc-200 text-[11px]">{m.name}</span>
            <span className={`text-[9px] px-1 rounded ${
              m.tier === "baseline" ? "bg-emerald-500/20 text-emerald-300" :
              m.tier === "recommended" ? "bg-blue-500/20 text-blue-300" :
              "bg-zinc-700 text-zinc-300"
            }`}>{m.tier}</span>
            {m.hasEnvKeys && <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300">需 API key</span>}
          </div>
          <div className="text-[10px] text-zinc-400 mt-1 ml-3">{m.description}</div>
          {!m.installed && (
            <div className="mt-1 ml-3 flex items-center gap-2">
              <code className="text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-200 font-mono">{m.installCommand}</code>
              <CopyButton text={m.installCommand} />
            </div>
          )}
          {!m.installed && m.manualSetupNote && (
            <div className="text-[10px] text-amber-300 mt-1 ml-3">⚠️ {m.manualSetupNote}</div>
          )}
        </div>
      ))}
    </div>
  );

  const agentsPanel = (
    <div className="space-y-2">
      <div className="text-zinc-400 text-[11px] mb-2">
        Agents 是 dashboard 的核心 — 211 位中文專家來自 agency-agents-zh
      </div>
      <div className="flex items-center gap-2">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${s.agents.installed >= s.agents.expected - 5 ? "bg-emerald-400" : "bg-rose-500"}`} />
        <span className="font-mono text-zinc-200 text-[11px]">{s.agents.installed} / {s.agents.expected} ({s.agents.categoriesCount} 類)</span>
      </div>
      {s.agents.installed < s.agents.expected - 5 && (
        <div className="mt-2 p-2 rounded bg-rose-500/10 text-rose-200 text-[11px] space-y-1">
          <div>缺很多 agent — 還沒裝 agency-agents-zh?</div>
          <div className="flex items-center gap-2">
            <code className="text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded">git clone https://github.com/jnMetaCode/agency-agents-zh.git</code>
            <CopyButton text="git clone https://github.com/jnMetaCode/agency-agents-zh.git" />
          </div>
          <div>然後到該目錄跑 <code className="bg-zinc-800 px-1 rounded">bash scripts/install.sh --tool claude-code</code></div>
        </div>
      )}
    </div>
  );

  const cliPanel = (
    <div className="space-y-2">
      <div className="text-zinc-400 text-[11px] mb-2">
        CLI tools 是底層 LLM provider — Claude 必裝,Codex / Gemini 可選備胎
      </div>
      {s.cli.map((c) => (
        <div key={c.name} className="border border-zinc-800 rounded p-2">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${c.installed ? "bg-emerald-400" : "bg-rose-500"}`} />
            <span className="font-mono text-zinc-200 text-[11px]">{c.name}</span>
            <span className={`text-[9px] px-1 rounded ${c.tier === "required" ? "bg-emerald-500/20 text-emerald-300" : "bg-zinc-700 text-zinc-300"}`}>{c.tier}</span>
          </div>
          <div className="text-[10px] text-zinc-400 mt-1 ml-3">{c.description}</div>
          {!c.installed && (
            <div className="mt-1 ml-3 flex items-center gap-2">
              <code className="text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-200 font-mono">{c.installCommand}</code>
              {c.installCommand.startsWith("npm") && <CopyButton text={c.installCommand} />}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs hover:bg-zinc-800 ${labelColor}`}
        title={tip}
      >
        <span className="text-sm">🧠</span>
        <span className="text-[11px] font-mono">{totalInstalled}/{totalExpected}</span>
        <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-96 max-h-[70vh] overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-3 z-50 text-xs">
          <div className="flex items-center justify-between mb-3">
            <div className="font-medium text-zinc-100">能力總覽</div>
            <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300">×</button>
          </div>

          <div className={`flex items-center gap-2 mb-3 px-2 py-1.5 rounded ${
            s.health.healthy ? "bg-emerald-500/10 text-emerald-300" :
            s.health.missing_critical > 0 ? "bg-rose-500/10 text-rose-300" :
            "bg-amber-500/10 text-amber-300"
          }`}>
            <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} />
            <span className="font-medium">{tip}</span>
          </div>

          <div className="flex border-b border-zinc-800 mb-3 -mx-3 px-3">
            {([
              ["skills", `🛠 Skills (${s.skills.installed}/${s.skills.expected})`],
              ["mcps", `🔌 MCPs (${s.mcps.installed}/${s.mcps.expected})`],
              ["agents", `👥 Agents (${s.agents.installed})`],
              ["cli", `⌨️ CLI (${s.cli.filter(c => c.installed).length}/${s.cli.length})`],
            ] as [Tab, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-2 py-1.5 text-[11px] border-b-2 transition-colors ${
                  tab === key
                    ? "border-blue-400 text-blue-300"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "skills" && skillsPanel}
          {tab === "mcps" && mcpsPanel}
          {tab === "agents" && agentsPanel}
          {tab === "cli" && cliPanel}

          <div className="border-t border-zinc-800 pt-2 mt-3 text-[10px] text-zinc-500 leading-relaxed">
            來自 <code className="bg-zinc-800 px-1 rounded">capabilities.manifest.json</code> 的單一真相源。
            執行 <code className="bg-zinc-800 px-1 rounded">npm run doctor</code> 看 CLI 報告,
            <code className="bg-zinc-800 px-1 rounded">npm run setup:full</code> 一鍵補齊缺項。
          </div>
        </div>
      )}
    </div>
  );
}
