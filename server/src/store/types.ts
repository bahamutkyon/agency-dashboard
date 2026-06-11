// store 領域共用型別（從 store.ts 抽出）。

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  ts: number;
}

export type Provider = "claude" | "codex" | "gemini";

export interface SessionRecord {
  id: string;
  workspaceId: string;
  agentId: string;
  title: string;
  provider: Provider;
  claudeSessionId?: string;
  codexThreadId?: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  tags?: string[];
}

/** Session 摘要：list view 需要的欄位 + 訊息數 + 最後一句預覽，但不含全部訊息。 */
export interface SessionSummary extends Omit<SessionRecord, "messages"> {
  messageCount: number;
  lastSnippet: string | null;
  lastRole: Message["role"] | null;
}

export interface Schedule {
  id: string;
  workspaceId: string;
  name: string;
  agentId: string;
  prompt: string;
  cron: string;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
}

export interface PromptTemplate {
  id: string;
  workspaceId: string;
  name: string;
  body: string;
  agentId?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id: string;
  workspaceId: string;
  title: string;
  body: string;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  standingContext: string;
  memory: string;
  enabledMcps: string[];   // names of MCP servers enabled for this workspace
  chromeCdpPort?: number;  // 此工作區專屬 Chrome 的 CDP port（playwright MCP 連這個）
  workingDir?: string;     // 工作區沙箱工作目錄（sandbox working directory）
  createdAt: number;
}

export interface AgentMemory {
  workspaceId: string;
  agentId: string;
  content: string;
  updatedAt: number;
  distilledFromSessionId: string | null;
}

export interface WorkflowStep {
  id?: string;               // auto-generated `step_N` if missing
  agentId: string;
  prompt: string;            // can include {{out}} (last completed dep) or {{stepId.out}}
  dependsOn?: string[];      // step ids this step depends on. empty/undefined = depends on previous-in-array (linear default)
  dependsOnMode?: "all" | "any"; // "all" (default): all deps must complete; "any": fire when first dep completes (race / fan-in)
  pauseBefore?: boolean;     // pause + wait for user approval before this step
  skipIfMatch?: string;      // regex on previous {{out}}; match → skip this step
  retries?: number;          // override default retry count (default 2 attempts after first try)
  provider?: Provider | "auto"; // which AI provider to use; "auto" = smart router decides; default claude
}

export interface Workflow {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  maxConcurrency?: number;   // override default 2; 1 = strict serial; >2 = more parallel
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workspaceId: string;
  status: "running" | "paused" | "done" | "error" | "cancelled";
  currentStep: number;
  sessionIds: string[];
  // step outputs keyed by step id; populated as each step completes.
  // Used for resume + multi-variable interpolation across runs.
  stepOutputs?: Record<string, string>;
  // per-step loop iteration count. Capped to prevent infinite loops.
  iterations?: Record<string, number>;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export interface SearchHit {
  sessionId: string;
  title: string;
  agentId: string;
  workspaceId: string;
  updatedAt: number;
  titleHit: boolean;
  matchCount: number;
  matches: { ts: number; role: string; snippet: string }[];
}

export interface DailyEntry {
  date: string;
  costUSD: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  turns: number;
}

export const MAX_LOOP_ITERATIONS = 5;
