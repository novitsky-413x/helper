import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { jsonSchema, tool, type ToolSet } from "ai";
import type { McpServerRecord } from "./store.js";

type Conn = { client: Client; record: McpServerRecord };

const connections = new Map<string, Conn>();

async function connectServer(record: McpServerRecord): Promise<Client> {
  const client = new Client({ name: "helper", version: "1.0.0" });
  if (record.transport === "http") {
    if (!record.url) throw new Error("MCP HTTP server needs url");
    const transport = new StreamableHTTPClientTransport(new URL(record.url));
    await client.connect(transport);
  } else {
    if (!record.command) throw new Error("MCP stdio server needs command");
    const transport = new StdioClientTransport({
      command: record.command,
      args: record.args || [],
      env: record.env,
      cwd: record.cwd,
      stderr: "pipe",
    });
    await client.connect(transport);
  }
  return client;
}

export async function ensureMcpClient(record: McpServerRecord): Promise<Client> {
  const existing = connections.get(record.id);
  if (existing && shallowEqualConfig(existing.record, record)) {
    return existing.client;
  }
  await disconnectMcp(record.id);
  const client = await connectServer(record);
  connections.set(record.id, { client, record: { ...record } });
  return client;
}

function shallowEqualConfig(a: McpServerRecord, b: McpServerRecord) {
  return (
    a.transport === b.transport &&
    a.url === b.url &&
    a.command === b.command &&
    JSON.stringify(a.args || []) === JSON.stringify(b.args || []) &&
    JSON.stringify(a.env || {}) === JSON.stringify(b.env || {}) &&
    a.cwd === b.cwd
  );
}

export async function disconnectMcp(serverId: string) {
  const c = connections.get(serverId);
  if (!c) return;
  try {
    await c.client.close();
  } catch {
    /* ignore */
  }
  connections.delete(serverId);
}

export async function disconnectAllMcp() {
  for (const id of [...connections.keys()]) {
    await disconnectMcp(id);
  }
}

export async function testMcpServer(record: McpServerRecord) {
  const client = await connectServer(record);
  try {
    const tools = await client.listTools();
    return {
      ok: true as const,
      tools: tools.tools.map((t) => ({ name: t.name, description: t.description })),
    };
  } finally {
    await client.close();
  }
}

function sanitizeToolName(serverId: string, i: number, raw: string): string {
  const tail = raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
  const prefix = `m${i}_`;
  const id = serverId.replace(/-/g, "").slice(0, 8);
  const name = `${prefix}${id}_${tail}`.slice(0, 64);
  return name || `mcp_tool_${i}`;
}

/** Build AI SDK tools from enabled MCP servers */
export async function buildMcpToolSet(servers: McpServerRecord[]): Promise<ToolSet> {
  const enabled = servers.filter((s) => s.enabled);
  const tools: ToolSet = {};
  let toolIdx = 0;

  for (const s of enabled) {
    let client: Client;
    try {
      client = await ensureMcpClient(s);
    } catch (e) {
      console.warn("[mcp] skip server (connect failed)", s.name, e);
      continue;
    }
    const listed = await client.listTools();
    for (const t of listed.tools) {
      const openAiName = sanitizeToolName(s.id, toolIdx++, t.name);
      const raw = t.inputSchema as Record<string, unknown> | undefined;
      const schema =
        raw && typeof raw === "object"
          ? { type: "object" as const, ...raw }
          : { type: "object" as const, properties: {} };
      tools[openAiName] = tool({
        description: `[${s.name}] ${t.description ?? t.name}`,
        parameters: jsonSchema(schema as any),
        execute: async (args) => {
          const c = connections.get(s.id)?.client;
          if (!c) throw new Error(`MCP client not connected: ${s.id}`);
          const res = await c.callTool({ name: t.name, arguments: args as Record<string, unknown> });
          const parts = res.content as { type: string; text?: string }[] | undefined;
          if (parts?.length) {
            return parts
              .map((p) => (p.type === "text" && p.text ? p.text : JSON.stringify(p)))
              .join("\n");
          }
          return JSON.stringify(res);
        },
      });
    }
  }

  return tools;
}
