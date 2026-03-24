/**
 * Profile + MCP persistence: MongoDB when MONGODB_URI is set, else JSON under apps/server/data/.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient, type Collection, type Db, type OptionalId } from "mongodb";
import { config } from "./config.js";
import { memoryDeleteAllForUser } from "./mem0Service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../data");
const profilesPath = () => path.join(dataDir, "profiles.json");
const mcpPath = () => path.join(dataDir, "mcp-servers.json");

export type MemoryProfile = {
  id: string;
  name: string;
  mem0UserId: string;
  createdAt: string;
  updatedAt: string;
};

export type McpTransport = "http" | "stdio";

export type McpServerRecord = {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransport;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

type ProfilesFile = { profiles: MemoryProfile[] };
type McpFile = { servers: McpServerRecord[] };

let mongo: { client: MongoClient; db: Db } | null = null;

async function getMongo(): Promise<{ client: MongoClient; db: Db } | null> {
  if (!config.mongoUri) return null;
  if (!mongo) {
    const client = new MongoClient(config.mongoUri);
    await client.connect();
    const db = client.db("helper");
    mongo = { client, db };
  }
  return mongo;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

async function colProfiles(): Promise<Collection<MemoryProfile> | null> {
  const m = await getMongo();
  return m ? m.db.collection<MemoryProfile>("profiles") : null;
}

async function colMcp(): Promise<Collection<McpServerRecord> | null> {
  const m = await getMongo();
  return m ? m.db.collection<McpServerRecord>("mcp_servers") : null;
}

function ensureDefaultProfile(profiles: MemoryProfile[]): MemoryProfile[] {
  if (profiles.length) return profiles;
  const now = new Date().toISOString();
  const p: MemoryProfile = {
    id: crypto.randomUUID(),
    name: "Default",
    mem0UserId: `profile:${crypto.randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  };
  return [p];
}

export async function listProfiles(): Promise<MemoryProfile[]> {
  const c = await colProfiles();
  if (c) {
    let list = (await c.find().sort({ createdAt: 1 }).toArray()) as MemoryProfile[];
    if (!list.length) {
      const def = ensureDefaultProfile([])[0]!;
      await c.insertOne(def as OptionalId<MemoryProfile>);
      list = [def];
    }
    return list;
  }
  const f = await readJson<ProfilesFile>(profilesPath(), { profiles: [] });
  f.profiles = ensureDefaultProfile(f.profiles);
  if (f.profiles.length === 1 && f.profiles[0]!.name === "Default") {
    await writeJson(profilesPath(), f);
  }
  return f.profiles;
}

export async function createProfile(name: string): Promise<MemoryProfile> {
  const now = new Date().toISOString();
  const p: MemoryProfile = {
    id: crypto.randomUUID(),
    name: name.trim() || "Untitled",
    mem0UserId: `profile:${crypto.randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  };
  const c = await colProfiles();
  if (c) {
    await c.insertOne(p as OptionalId<MemoryProfile>);
    return p;
  }
  const f = await readJson<ProfilesFile>(profilesPath(), { profiles: [] });
  f.profiles.push(p);
  await writeJson(profilesPath(), f);
  return p;
}

export async function updateProfile(id: string, name: string): Promise<MemoryProfile | null> {
  const c = await colProfiles();
  const now = new Date().toISOString();
  if (c) {
    const cur = await c.findOne({ id });
    if (!cur) return null;
    const next = { ...cur, name: name.trim() || "Untitled", updatedAt: now };
    await c.replaceOne({ id }, next);
    return next;
  }
  const f = await readJson<ProfilesFile>(profilesPath(), { profiles: [] });
  const i = f.profiles.findIndex((x) => x.id === id);
  if (i < 0) return null;
  f.profiles[i] = { ...f.profiles[i], name: name.trim() || "Untitled", updatedAt: now };
  await writeJson(profilesPath(), f);
  return f.profiles[i];
}

export async function deleteProfile(id: string): Promise<boolean> {
  const c = await colProfiles();
  let mem0UserId: string | undefined;
  if (c) {
    const doc = await c.findOne({ id });
    if (!doc) return false;
    mem0UserId = doc.mem0UserId;
    await c.deleteOne({ id });
  } else {
    const f = await readJson<ProfilesFile>(profilesPath(), { profiles: [] });
    const i = f.profiles.findIndex((x) => x.id === id);
    if (i < 0) return false;
    mem0UserId = f.profiles[i].mem0UserId;
    f.profiles.splice(i, 1);
    await writeJson(profilesPath(), f);
  }
  if (mem0UserId) {
    await memoryDeleteAllForUser(mem0UserId);
  }
  return true;
}

export async function getProfileById(id: string): Promise<MemoryProfile | null> {
  const all = await listProfiles();
  return all.find((p) => p.id === id) ?? null;
}

export async function listMcpServers(): Promise<McpServerRecord[]> {
  const c = await colMcp();
  if (c) {
    return c.find().sort({ name: 1 }).toArray();
  }
  const f = await readJson<McpFile>(mcpPath(), { servers: [] });
  return f.servers;
}

export async function saveMcpServers(servers: McpServerRecord[]): Promise<void> {
  const c = await colMcp();
  if (c) {
    await c.deleteMany({});
    if (servers.length) await c.insertMany(servers);
    return;
  }
  await writeJson(mcpPath(), { servers });
}

export async function upsertMcpServer(
  record: Omit<McpServerRecord, "id"> & { id?: string }
): Promise<McpServerRecord> {
  const id = record.id || crypto.randomUUID();
  const row: McpServerRecord = {
    id,
    name: record.name,
    enabled: record.enabled,
    transport: record.transport,
    url: record.url,
    command: record.command,
    args: record.args,
    env: record.env,
    cwd: record.cwd,
  };
  const list = await listMcpServers();
  const i = list.findIndex((s) => s.id === id);
  if (i >= 0) list[i] = row;
  else list.push(row);
  await saveMcpServers(list);
  return row;
}

export async function deleteMcpServer(id: string): Promise<boolean> {
  const list = await listMcpServers();
  const next = list.filter((s) => s.id !== id);
  if (next.length === list.length) return false;
  await saveMcpServers(next);
  return true;
}
