# Helper

Local full-stack helper app: React chat UI, Express backend, [Together.ai](https://www.together.ai/) for LLM/embeddings, **[Mem0 OSS](https://docs.mem0.ai/open-source/overview)** (`mem0ai/oss`) for per-profile semantic memory (Together-backed LLM + embeddings, in-memory vectors + SQLite history by default), optional MongoDB for profile/MCP metadata, and [MCP](https://modelcontextprotocol.io/) tools via `@modelcontextprotocol/sdk`.

## Prerequisites

- **Node.js ≥ 22.12** or **≥ 20.19** (matches Vite 8 and other toolchain `engines`; **22.13+** recommended)
- Together API key ([Together dashboard](https://api.together.xyz/))

## Setup

1. Copy `.env.example` to `.env` in the repo root and set `TOGETHER_API_KEY`.

2. Install dependencies (from repo root). After switching Node versions, a clean install avoids native-module mismatches:

   ```bash
   # optional: remove old installs first
   rm -rf node_modules apps/*/node_modules
   npm install
   ```

3. Development (API server + Vite):

   ```bash
   npm run dev
   ```

   - UI: [http://localhost:5173](http://localhost:5173) (proxies `/api` to the server)
   - API: [http://localhost:3001](http://localhost:3001)

4. Production build (serves static UI from the server when `apps/web/dist` exists):

   ```bash
   npm run build
   npm run start -w @helper/server
   ```

## Configuration

| Variable | Purpose |
|----------|---------|
| `TOGETHER_API_KEY` | Required. Chat, classifier, Mem0 LLM/embeddings. |
| `MONGODB_URI` | Optional. If set, profiles and MCP server definitions are stored in MongoDB (`helper` DB). If unset, the same data lives in JSON files under `apps/server/data/` (see [`store.ts`](apps/server/src/store.ts)). |
| `WEB_ORIGIN` | CORS origin for the SPA (default `http://localhost:5173`). |
| `PORT` | API port (default `3001`). |
| `CHAT_MODEL_LOW` / `MED` / `HIGH` | Together model IDs for auto routing. |
| `CLASSIFIER_MODEL` | Small/cheap model for complexity tier (default Gemma 3n). |
| `MEM0_EMBEDDING_MODEL` / `MEM0_EMBEDDING_DIMS` | Together embedding model + dimension (1024 for `intfloat/multilingual-e5-large-instruct`). |
| `MEM0_LLM_MODEL` | Together chat model Mem0 uses to infer memories. |
| `MEM0_HISTORY_DB` | SQLite path for Mem0 history (default under `apps/server/data/`). |
| `MAX_TOOL_ROUNDS` | Max agent steps when MCP tools are used (default `8`). |

## Auto mode and cost

When the UI model is **Auto**, the server runs a short classifier on Together (plus a small-message heuristic to skip the call sometimes), then picks `CHAT_MODEL_LOW`, `CHAT_MODEL_MED`, or `CHAT_MODEL_HIGH`.

## MongoDB vs JSON

MongoDB is **only used when `MONGODB_URI` is set** in `.env`. Otherwise the app never opens a Mongo connection; profile and MCP config use `profiles.json` and `mcp-servers.json` in `apps/server/data/`. Chat, Mem0, and Together do not require MongoDB.

## Memory persistence (Mem0 OSS)

By default Mem0 OSS uses an **in-memory vector store** (cleared on process restart) plus **SQLite history** at `MEM0_HISTORY_DB`. For durable vectors without Docker, see Mem0 docs for Qdrant/Redis or use **Mem0 Platform** (hosted API).

## MCP servers

Configure **HTTP (streamable)** or **stdio** MCP servers in the UI. Tool calls are executed in a multi-step loop via the Vercel AI SDK `streamText` + Together function calling. Treat MCP access as **trusted operator only** if you expose the API beyond localhost.

## API summary

- `GET /api/models` — cached Together chat models  
- `POST /api/chat` — AI SDK data stream (compatible with `useChat`)  
- `GET|POST|PATCH|DELETE /api/profiles` — memory profiles (Mem0 `userId` per profile)  
- `GET|PATCH|DELETE /api/memory*` — inspect/edit/delete memories  
- `GET|POST|DELETE /api/mcp/servers` — MCP config; `POST /api/mcp/servers/:id/test` lists tools  
