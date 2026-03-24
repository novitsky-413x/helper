import Together from "together-ai";
import { config } from "./config.js";

type Cached = { at: number; models: TogetherModelRow[] };
let cache: Cached | null = null;
const TTL_MS = 10 * 60 * 1000;

export type TogetherModelRow = {
  id: string;
  display_name?: string | null;
  type?: string;
  context_length?: number | null;
};

export async function listChatModelsCached(): Promise<TogetherModelRow[]> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.models;

  if (!config.togetherApiKey) {
    return [];
  }

  const client = new Together({ apiKey: config.togetherApiKey });
  const list = await client.models.list();
  const chat = list
    .filter((m) => m.type === "chat")
    .map((m) => ({
      id: m.id,
      display_name: m.display_name ?? null,
      type: m.type,
      context_length: m.context_length ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  cache = { at: now, models: chat };
  return chat;
}
