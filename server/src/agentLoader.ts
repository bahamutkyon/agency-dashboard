import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface AgentMeta {
  id: string;
  name: string;
  description: string;
  color?: string;
  category: string;
}

const AGENTS_DIR = path.join(os.homedir(), ".claude", "agents");

// Default repo location (relative to dashboard project root). User can override
// with AGENT_REPO_PATH env var.
const DEFAULT_REPO_CANDIDATES = [
  path.resolve(process.cwd(), "..", "..", "agency-agents-zh", "agency-agents-zh"),
  path.resolve(process.cwd(), "..", "agency-agents-zh", "agency-agents-zh"),
  path.resolve(process.cwd(), "..", "agency-agents-zh"),
  path.resolve(os.homedir(), "Desktop", "claude", "agency-agents-zh", "agency-agents-zh"),
];

// Folder name → 繁體中文部門名 (Taiwan terminology)
const CATEGORY_LABELS: Record<string, string> = {
  academic: "學術部",
  design: "設計部",
  engineering: "工程部",
  finance: "財務部",
  "game-development": "遊戲開發部",
  hr: "人資部",
  legal: "法務部",
  marketing: "行銷部",
  "paid-media": "付費媒體部",
  product: "產品部",
  "project-management": "專案管理部",
  sales: "銷售部",
  "spatial-computing": "空間運算部",
  specialized: "專項部",
  "supply-chain": "供應鏈部",
  support: "客戶支援部",
  testing: "測試部",
  other: "其他",
};

const CATEGORY_ORDER = [
  "engineering", "design", "product", "marketing", "paid-media",
  "sales", "support", "finance", "hr", "legal",
  "project-management", "supply-chain", "game-development",
  "spatial-computing", "academic", "testing", "specialized", "other",
];

function findRepoPath(): string | null {
  if (process.env.AGENT_REPO_PATH && fs.existsSync(process.env.AGENT_REPO_PATH)) {
    return process.env.AGENT_REPO_PATH;
  }
  for (const p of DEFAULT_REPO_CANDIDATES) {
    if (fs.existsSync(p) && fs.existsSync(path.join(p, "academic"))) return p;
  }
  return null;
}

function parseFrontmatter(text: string): { name?: string; description?: string; color?: string } {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end < 0) return {};
  const fm = text.slice(3, end);
  const out: Record<string, string> = {};
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z_]+)\s*:\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/**
 * Build a (basename → category) map by walking the cloned repo. The folder
 * name is the source of truth for categorization. Files in `specialized/`
 * often have no prefix (e.g. accounts-payable-agent.md), which is why we
 * can't just match filename patterns.
 */
function buildRepoCategoryMap(repo: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of fs.readdirSync(repo, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!CATEGORY_LABELS[entry.name]) continue;
    const dir = path.join(repo, entry.name);
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".md")) map.set(f.replace(/\.md$/, ""), entry.name);
    }
  }
  return map;
}

let repoMapCache: Map<string, string> | null = null;
let repoPathCache: string | null | undefined;

function categoryFor(id: string): string {
  if (repoPathCache === undefined) {
    repoPathCache = findRepoPath();
    if (repoPathCache) {
      repoMapCache = buildRepoCategoryMap(repoPathCache);
      console.log(`[agentLoader] using repo categories from ${repoPathCache} (${repoMapCache.size} files mapped)`);
    } else {
      console.log(`[agentLoader] repo not found — using filename heuristic`);
    }
  }
  if (repoMapCache) {
    const cat = repoMapCache.get(id);
    if (cat) return cat;
  }
  // fallback heuristic: filename prefix
  for (const cat of Object.keys(CATEGORY_LABELS)) {
    if (id.startsWith(cat + "-") || id.startsWith(cat + "_")) return cat;
  }
  return "other";
}

export function loadAgents(): AgentMeta[] {
  if (!fs.existsSync(AGENTS_DIR)) return [];
  const files = fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));
  const agents: AgentMeta[] = [];
  for (const file of files) {
    try {
      const full = path.join(AGENTS_DIR, file);
      const text = fs.readFileSync(full, "utf8");
      const fm = parseFrontmatter(text);
      const id = file.replace(/\.md$/, "");
      agents.push({
        id,
        name: fm.name || id,
        description: fm.description || "",
        color: fm.color,
        category: categoryFor(id),
      });
    } catch (e) {
      console.warn(`[agentLoader] skip ${file}:`, e);
    }
  }
  return agents.sort((a, b) => {
    const oa = CATEGORY_ORDER.indexOf(a.category);
    const ob = CATEGORY_ORDER.indexOf(b.category);
    if (oa !== ob) return oa - ob;
    return a.id.localeCompare(b.id);
  });
}

export function categoryLabel(c: string): string {
  return CATEGORY_LABELS[c] || c;
}

export function getCategoryOrder(): string[] {
  return CATEGORY_ORDER;
}
