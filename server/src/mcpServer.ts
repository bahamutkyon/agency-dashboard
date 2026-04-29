#!/usr/bin/env node
/**
 * Agency Dashboard MCP Server.
 *
 * Exposes the dashboard's workflow / agent / notes capabilities as MCP tools
 * so external tools (Cursor, Claude Code, Continue, etc.) can call them.
 *
 * Architecture: this is a thin proxy. It expects the main dashboard server
 * to be running at http://localhost:5191 (or DASHBOARD_URL env). Each MCP
 * tool call translates to a REST/Socket call against the dashboard.
 *
 * Why a proxy instead of duplicating logic? The dashboard already has the
 * runner, scheduler, retry, DAG engine. We don't want two copies that drift.
 *
 * Usage:
 *   1. Start dashboard:  npm run dev  (or `npm start` for prod)
 *   2. Register MCP server in your Claude Code / Cursor config:
 *        {
 *          "mcpServers": {
 *            "agency-dashboard": {
 *              "command": "node",
 *              "args": ["/abs/path/to/server/dist-mcp.mjs"]
 *            }
 *          }
 *        }
 *   3. Restart your AI tool. It'll see tools like:
 *        - agency_list_workflows
 *        - agency_run_workflow
 *        - agency_chat_with_agent
 *        - agency_list_agents
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const DASHBOARD_URL = process.env.DASHBOARD_URL || "http://localhost:5191";
const WORKSPACE = process.env.AGENCY_WORKSPACE || "default";

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const url = `${DASHBOARD_URL}${path}${path.includes("?") ? "&" : "?"}workspace=${encodeURIComponent(WORKSPACE)}`;
  const r = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`${r.status}: ${text}`);
  }
  return r.json();
}

const server = new Server(
  { name: "agency-dashboard", version: "0.10.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "agency_list_workflows",
      description: "列出當前工作區的所有 workflow(自動接力流程)。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "agency_run_workflow",
      description: "執行某個 workflow,等所有步驟完成後回傳每步輸出。",
      inputSchema: {
        type: "object",
        properties: {
          workflow_id: { type: "string", description: "workflow id (可從 agency_list_workflows 取得)" },
          initial_input: { type: "string", description: "起始輸入(第一步的 {{out}})" },
        },
        required: ["workflow_id"],
      },
    },
    {
      name: "agency_list_agents",
      description: "列出所有可用的中文 agent(211 位專家),可用 category 過濾。",
      inputSchema: {
        type: "object",
        properties: {
          category: { type: "string", description: "可選:engineering / design / marketing / 等" },
          search: { type: "string", description: "可選:關鍵字搜尋名稱或描述" },
        },
      },
    },
    {
      name: "agency_chat_with_agent",
      description: "跟某位 agent 一次性對話(單輪),回傳完整回應。適合快速請教專家。",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "例如 design-ui-designer" },
          message: { type: "string", description: "要問的問題" },
        },
        required: ["agent_id", "message"],
      },
    },
    {
      name: "agency_list_notes",
      description: "列出當前工作區的所有筆記(品牌、產品、流程等知識庫)。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "agency_search_sessions",
      description: "全文搜尋過往對話紀錄。",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "搜尋關鍵字" } },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req: any) => {
  const name = req.params.name;
  const args = (req.params.arguments || {}) as any;

  try {
    switch (name) {
      case "agency_list_workflows": {
        const wfs = await api("/api/workflows");
        return { content: [{ type: "text", text: JSON.stringify(
          wfs.map((w: any) => ({
            id: w.id, name: w.name, description: w.description,
            stepCount: w.steps.length,
          })), null, 2) }] };
      }

      case "agency_run_workflow": {
        if (!args.workflow_id) throw new Error("workflow_id required");
        const run = await api(`/api/workflows/${args.workflow_id}/run`, {
          method: "POST",
          body: JSON.stringify({ initialInput: args.initial_input }),
        });
        // Poll until done or 5min timeout
        const deadline = Date.now() + 5 * 60 * 1000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2000));
          const r2 = await api(`/api/runs/${run.id}`);
          if (r2.status === "done" || r2.status === "error" || r2.status === "cancelled") {
            return { content: [{ type: "text", text: JSON.stringify({
              status: r2.status,
              error: r2.error,
              outputs: r2.stepOutputs,
            }, null, 2) }] };
          }
        }
        return { content: [{ type: "text", text: `Workflow run ${run.id} 仍在執行中(超過 5 分鐘),回 dashboard 查看` }] };
      }

      case "agency_list_agents": {
        const data = await api("/api/agents");
        let agents = data.agents;
        if (args.category) agents = agents.filter((a: any) => a.category === args.category);
        if (args.search) {
          const q = String(args.search).toLowerCase();
          agents = agents.filter((a: any) =>
            a.id.toLowerCase().includes(q) ||
            a.name.toLowerCase().includes(q) ||
            a.description.toLowerCase().includes(q)
          );
        }
        return { content: [{ type: "text", text: JSON.stringify(
          agents.slice(0, 30).map((a: any) => ({ id: a.id, name: a.name, category: a.category, description: a.description })),
          null, 2) }] };
      }

      case "agency_chat_with_agent": {
        if (!args.agent_id || !args.message) throw new Error("agent_id and message required");
        const sess = await api("/api/sessions", {
          method: "POST",
          body: JSON.stringify({ agentId: args.agent_id, title: `[MCP] ${args.message.slice(0, 30)}` }),
        });

        // We can't easily talk to socket.io from here without lots of infra,
        // so we use a polling approach: send via REST shim (we don't have one yet).
        // For now, instruct the user that streaming chat via MCP needs more work.
        return { content: [{ type: "text", text:
          `已建立 session ${sess.id}。請在 dashboard 中查看完整對話。\n\n` +
          `(MCP 單輪對話的 streaming 整合在 v0.11+ 提供 — 目前 MCP 主要用來觸發 workflow)`
        }] };
      }

      case "agency_list_notes": {
        const notes = await api("/api/notes");
        return { content: [{ type: "text", text: JSON.stringify(
          notes.map((n: any) => ({ title: n.title, body: n.body, pinned: n.pinned })),
          null, 2) }] };
      }

      case "agency_search_sessions": {
        if (!args.query) throw new Error("query required");
        const hits = await api(`/api/search?q=${encodeURIComponent(args.query)}`);
        return { content: [{ type: "text", text: JSON.stringify(
          hits.slice(0, 10).map((h: any) => ({
            title: h.title, agentId: h.agentId, matchCount: h.matchCount,
            preview: h.matches[0]?.snippet,
          })), null, 2) }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (e: any) {
    return {
      content: [{ type: "text", text: `Error: ${e.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[mcp] Agency Dashboard MCP server connected via stdio");
