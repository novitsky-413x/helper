# QA findings (manual + automated smoke)

Session notes from dev-server runs, browser (Chrome MCP), API checks, and log review.

## Fixed in repo

### 1. Empty profile list left stale active profile (`useBackendData.loadProfiles`)

If all memory profiles were deleted, `localStorage` still held the old `helper-active-profile` id and React state could keep a stale `activeProfileId` with an empty `profiles` array.

**Fix:** When `profiles.length === 0`, clear `activeProfileId` and remove `helper-active-profile` from `localStorage`.

### 2. `addProfile` ignored HTTP errors

Failed `POST /api/profiles` still cleared the name field and called `onProfileChange` with `undefined` if the body had no `id`.

**Fix:** Require `r.ok` and `p.id`; on failure log with `console.warn` and keep the input.

### 3. `removeProfile` used stale `profiles` after delete

After `await loadProfiles()`, the callback still read `profiles` from the closure to pick the “next” profile, which could be wrong across renders. Active profile after delete is already reconciled inside `loadProfiles` (valid `localStorage` id or first profile).

**Fix:** Drop the extra `onProfileChange`; check `DELETE` response with `r.ok`.

## Observed (no code change yet)

- **Vite build:** Main JS chunk > 500 kB — consider route-based code splitting and lazy-loading heavy panels (Learning, Wiki, xterm).
- **Model `<select>`:** Long option list — header filter + lazy chunks help; a full combobox could still replace the native **`<select>`** later.
- **Server log:** Together marks some catalog models unhealthy at runtime (non-serverless) — expected noise; auto-routing should prefer healthy models.

### 4. Persona editor stayed stale when switching memory profile (`SettingsModal`)

With Settings open, changing the active memory profile in the header did not refresh the persona fields (initial state was only applied on mount).

**Fix:** `PersonaEditForm` is remounted when the active profile changes via `key={activeProfileId}` (avoids `setState` inside `useEffect`, which ESLint flags and can cascade renders).

### 5. Persona section not localized (`SettingsModal`)

Russian UI still showed English labels (“Profile Persona”, “Save Persona”, etc.).

**Fix:** New `uiText` keys (`personaTitle`, `personaAvatar`, …) and wire `PersonaEditForm` to `tx`.

## Browser / console (sample run)

- `POST /api/profiles` → **200** after creating “QA Memory Profile”; follow-up `GET /api/profiles`, `/api/chat-sessions`, `/api/memory`, `/api/chat/usage` succeeded.
- **Socket.io:** occasional console warning `WebSocket is closed before the connection is established` — often from React Strict Mode double-mount or HMR reconnecting three namespaces (`/agent`, `/autopilot`, `/terminal`). Harmless if UI shows Connected.
- **Chrome issues panel:** missing `id`/`name` on some fields — partially addressed by adding `name` on new-profile and persona inputs.

### 6. Profile creation errors only logged to console

Users saw no in-app feedback when `POST /api/profiles` failed.

**Fix:** `onProfileAddFailed` callback from `App` pushes an **`error`** toast via `useAppStore.addNotification` (RU/EN copy in `profileAddFailedTitle` / `profileAddFailedBody`).

### 7. Several mutating fetches refreshed UI even on HTTP error

`renameProfile`, `saveCategoryOrder` (via model-preferences PATCH), `saveMemoryPolicy`, `saveMemory`, and `removeMemory` called `loadProfiles` / `loadMemory` without checking `response.ok`, so the UI could look “saved” while the server rejected the request.

**Fix:** `if (!r.ok) return` before reloading state in those paths.

## UX / performance suggestions

- Settings modal: scroll long sections; consider tabs (Profiles / Models / Memory policy / Persona).
- Analytics on narrow viewports: **#26** collapses the drawer when the viewport is **≤640px** (or crosses that breakpoint); optional future work is debounce or default-collapsed on first paint only.
- Toasts for other failures: **#23** adds a generic error toast for rename profile, memory policy, model order, memory row save/delete, and profile delete when the server rejects the request (same copy as MCP/persona failures). **#25** adds the same toast when **MCP delete** fails.

### 8. MCP save / test / delete and persona PATCH ignored HTTP errors

`saveMcp` reset the form after failed `POST`; `deleteMcp` reloaded the list after failed `DELETE`; `testMcp` showed success-shaped JSON on errors; persona save in Settings always called `loadProfiles()` after `PATCH`.

**Fix:** `r.ok` guards; `testMcp` surfaces error JSON; persona `PATCH` uses `notifyGenericFailed` toast on failure; `onMcpSaveFailed` uses the same generic toast (`genericRequestFailedTitle` / `Body`). Failed MCP **delete** now calls the same callback (**#25**).

### 9. Autopilot mode optimistic UI could desync from server

`changeMode` updated local Zustand state before the request; a failed `POST /api/autopilot/mode` left the UI wrong.

**Fix:** Remember previous mode and revert if the request fails. Observations bootstrap fetch only applies `observations` when `r.ok` and body is an array.

### 10. Learning, Wiki, chat-session delete treated error bodies as data

Fetches used `.json()` without checking status, so error HTML/JSON could corrupt state or mislead the user.

**Fix:** `r.ok` checks and `Array.isArray` before `setState` where applicable; chat session delete updates UI only after successful `DELETE`.

### 11. README vs `package.json` (Express)

README claimed Express 5; server depends on Express 4.x.

**Fix:** README tech table updated to Express 4.

### 12. Initial JS bundle size (performance)

**Change:** `React.lazy` + `Suspense` for `LearningDashboard`, `WikiBrowser`, `AutopilotPanel`, and `BottomPanel` (pulls xterm into a separate chunk). Main `index` JS drops substantially; terminal stack loads on demand.

### 13. `/context` slash text vs reality

The `/context` command is handled in `POST /api/chat` **before** any LLM or agent loop; it returned *“Context info will be shown by the agent.”* even though nothing else runs—confusing next to the Analytics panel.

**Fix:** `slashCommands.ts` now tells the user to use **Analytics** under the composer and states that the server does not compute extra context for this command.

### 14. Agent loop: no `toolName` on `agent:progress`, stale turn UI after stream

The main **`runAgentLoop`** only emitted **`turn`** / **`maxTurns`**; **`currentToolName`** in the client stayed empty. After the HTTP stream finished, **`Turn N/M`** stayed visible until the next run.

**Fix:** Emit **`toolName`** before each built-in tool execution; reset agent progress (**`setAgentProgress(0, 0)`**) in **`App`** when **`busy`** goes from true to false.

### 15. Agent hit **`max_turns`** or **Stop** without a clear chat line

Reaching the tool-round cap (without a normal “no tools” finish) did not append an explicit message; **`interrupted`** likewise had no standard footer in the stream.

**Fix:** **`agentLoop.ts`** appends short streamed footers for **`max_turns`** and **`interrupted`** in the language implied by **`uiLang`** (see **#18**). **`max_turns`** is only set when the loop exits because the cap was reached while the model still wanted tools (**`completedNaturally`** flag), not when the model finishes normally on the last allowed turn.

### 16. Composer: DOM-only text (e.g. Chrome MCP **`fill`**) did not enable **Отправить**

Controlled **`textarea`** + automation that sets the DOM without React **`onChange`** left **`input`** state empty.

**Fix:** **`ChatComposer`** attaches a native **`input`** listener to sync **`el.value`** into **`setInput`**, assigns **`textareaRef`**, and **`submitFromComposer`** uses **`flushSync`** to read the textarea before **`handleSubmit`**; image + Enter paths use the ref when reading the draft.

### 17. Chrome Issues: form fields missing **`id` / `name`**

Several controls (header model/profile selects, composer textarea + hidden image input, Settings language/tts/memory numbers, persona fields, **`ProfileRow`**, **`MemoryRowEditor`**, **`McpModal`**, wiki search) triggered “form field should have an id or name” in DevTools.

**Fix:** Stable **`id`** + **`name`** (and **`aria-label`** on the composer textarea via placeholder text) across those components; **`ProfileRow`** takes **`profileId`** for per-row field names.

### 18. Agent stream footers vs UI language

**`max_turns`**, **`interrupted`**, and empty-error agent loop messages were Russian-only in the stream.

**Fix:** **`POST /api/chat`** accepts optional **`uiLang`** (`ru` \| `en`); **`App`** / voice **`chatBody`** send the current UI language. **`runAgentLoop`** uses **`locale`** for footer strings; **`chat.ts`** picks the matching empty-error line.

### 19. **`ChatComposer`** `useEffect` exhaustive-deps warning

The DOM **`input`** sync effect referenced **`props.textareaRef`** / **`props.setInput`** in a way that triggered **`react-hooks/exhaustive-deps`**.

**Fix:** Destructure **`textareaRef`**, **`setInput`**, and **`input`** from props; depend on **`[input, setInput, textareaRef]`**; use **`textareaRef`** consistently on the **`<textarea>`**.

### 20. Agent badge: tool vs LLM, slash menu locale, model filter, bottom panel copy

- **`agent:progress`** had no distinction between “model streaming” and “running a tool”; slash hints were English-only; model **`<select>`** was huge with no filter; bottom panel strings were hardcoded English.

**Fix:** Server emits **`phase: 'llm' | 'tool'`** (see **`agentLoop.ts`**). Client store keeps **`agentProgressPhase`**; **`BottomPanel`** shows **`thinkingInline`** vs **`toolName`**. **`ChatComposer`** slash descriptions use **`uiText`**. **`AppHeader`** adds a filter field and localized auto option. **`BottomPanel`** takes **`tx`** for tab labels and agent copy. Shared socket typing updated in **`@helper/shared`**.

### 21. Agent stream recovery copy + sub-agent progress

- Hardcoded Russian-only text when the agent stream failed with no tools/text.
- Sub-agent loop never emitted **`agent:progress`** with **`phase`**.

**Fix:** **`agentStreamRecoverError(locale)`** in **`agentLoop.ts`** (matches **`uiLang`**). **`runSubAgent`** calls **`emitProgress({ turn, maxTurns, phase: 'llm' })`** each turn before **`generateText`**.

### 22. Sidebar + Learning / Wiki / Autopilot views stayed English in RU UI

Navigation, connection line, dream status, and the three secondary views used hardcoded English strings.

**Fix:** New **`uiText`** keys (**`navChat`**, **`learningTitle`**, **`wikiTitle`**, **`autopilotTitle`**, …). **`Sidebar`**, **`LearningDashboard`**, **`WikiBrowser`**, and **`AutopilotPanel`** take **`tx`** from **`App`**.

### 23. Silent failures on Settings-related API calls

**`renameProfile`**, **`saveMemoryPolicy`**, **`saveCategoryOrder`**, **`removeProfile`**, **`saveMemory`**, and **`removeMemory`** returned early on **`!r.ok`** without user feedback (beyond **#7**’s “do not reload” fix).

**Fix:** Optional **`onSettingsRequestFailed`** on **`useBackendData`**; **`App`** wires **`notifyGenericFailed`** (existing **`genericRequestFailedTitle` / `Body`** toasts).

### 24. Settings route + agent toggle copy; agent prompt verbosity

- **Settings** nav view still showed English **“Open Settings”**; agent mode button used English **`title`** tooltips.
- QA noted long speculative narration in agent mode (**intensive** section).

**Fix:** **`settingsOpenButton`**, **`agentModeTooltipOn` / `Off`** in **`uiText`**. **`buildAgentSystemPrompt`** adds a bullet preferring prompt tool calls over long pre-tool monologue.

### 25. MCP server delete failed silently

**`deleteMcp`** returned early on **`!r.ok`** without user feedback (save/test already surfaced errors per **#8**).

**Fix:** On failed **`DELETE`**, call **`onMcpSaveFailed`** (same generic toast as MCP save).

### 26. Analytics drawer: leftover English labels + narrow screens

Memory-write rows and **mem0 in current prompt** stayed English in RU UI; QA suggested collapsing analytics on small viewports.

**Fix:** New **`uiText`** keys (**`analyticsMemoryWrites`**, **`analyticsLastMemoryWrite`**, **`analyticsMem0InPrompt`**, **`analyticsOk`**, **`analyticsFail`**). **`App`** listens to **`matchMedia('(max-width: 640px)')`** and sets **`analyticsOpen`** to false when the viewport matches or when crossing to narrow.

### 27. Agent mode button and voice status bar English in RU UI

Header toggle showed **“🤖 Agent”** / **“💬 Chat”**; live-voice row used **STT/TTS** and **on/off** in English.

**Fix:** **`agentModeBadgeOn` / `agentModeBadgeOff`**, **`voiceStt`**, **`voiceTts`**, **`toggleOnShort` / `toggleOffShort`** in **`uiText`**.

## Manual pass (Chrome MCP + `server.log`)

**Date note:** ad-hoc session while dev servers were running (`5173` / `3001`).

### Browser (Chrome DevTools MCP)

- Reloaded `http://localhost:5173/` — chat view: **Connected**, **Default** profile, empty sessions, analytics collapsed; composer idle.
- **Learning** — titles/empty state follow **`uiLang`** (see **#22**); `/learn` hint unchanged in meaning.
- **Wiki** — same; search control exposed as `searchbox`.
- **Autopilot** — lazy chunk; mode labels localized when **`ru`** (**#22**); `GET /api/autopilot/observations?limit=30` **200** then **304**.

### Chrome console

- Vite HMR connect messages; React DevTools promo.
- **Warn:** `WebSocket ... socket.io ... closed before the connection is established` (still appears; often reconnect / Strict Mode / multi-namespace teardown).
- **Issue:** “form field should have an id or name” — addressed for main surfaces in **#17**; re-scan Issues after UI changes.

### Network (dev)

- Duplicate **`GET /api/learning/plans`**, **`GET /api/wiki`**, **`GET /api/autopilot/observations`** pairs — consistent with **React Strict Mode** double-mounting effects in dev.
- Profile **`93bb533e-1138-441e-83af-7006af390bee`** used for `chat-sessions`, `usage`, `learning`, `wiki`; mem0 reads use **`userId=profile:a89ffe57-86f3-49e3-ab97-a601f688b2a8`** — different UUIDs by design (**SQLite profile id** vs **mem0 user id**), not a bug.

### Server log (`apps/server/logs/server.log`)

- Steady **`request completed`** for `/api/*` with **200** / **304**; **`responseTime`** usually **0–10 ms** except **`/api/memory`** occasionally **~420 ms** (mem0 path worth watching under load).
- Periodic **`vector store snapshot saved`** (`users: 2`) — background job healthy.

## Agent interaction (Chrome MCP + `server.log`)

Exercised real **`POST /api/chat`** turns (not only shell navigation).

### Standard chat (agent mode OFF)

- Composer → short instruction **“Reply with exactly one word: OK”** → assistant **OK**; **Перегенерировать** visible on assistant bubble.
- **Network:** `POST http://localhost:5173/api/chat` **200** (AI SDK stream).
- **Response headers (via server):** `x-helper-resolved-model: openai/gpt-oss-20b`, `x-helper-base-model` set; `content-type: text/plain; charset=utf-8`, `x-vercel-ai-data-stream: v1`.
- **Server log:** `chat request` with auto-routed **`resolvedModel`** (e.g. `google/gemma-3n-E4B-it`), then **`upgrading to memory-capable model`** from that base to **`openai/gpt-oss-20b`** (`memoryChars: 0`); **`request completed`** **`responseTime`** ~**1s** for this short turn.
- **Analytics:** prompt / completion / total tokens and **estimated cost** filled; mem0 hits **0**; UI **last memory write: fail** on this profile (validate mem0 / policy separately if persistence matters).

### Agent mode ON + slash

- Toggle **🤖 Agent**; send **`/context`**.
- Slash commands are intercepted **before** `runAgentLoop` in `chat.ts`; second turn still **`POST /api/chat`** streaming the slash result (no tool/agent round-trip for this command). Copy clarified per **#13** above.

### Multi-tool agent pass (bash + `file_read`, Windows)

- **Prompt (agent ON):** PowerShell `Set-Content` for `workspace/agent-qa-marker.txt` with line `AGENT_QA_OK`, then `file_read` that path; one short English confirmation.
- **Disk (ground truth):** During the recorded pass, `workspace/agent-qa-marker.txt` contained exactly **`AGENT_QA_OK`** — confirms **`bash`** wrote under the default agent workspace and tooling executed end-to-end. The whole **`workspace/`** directory is listed in the repo **`.gitignore`** (runtime agent files); remove local QA artifacts such as **`agent-qa-marker.txt`** after verification so they do not clutter the tree.
- **`apps/server/logs/server.log` correlation:** preceding **`chat request`** line shows **`lastUserChars`: 158**, **`messageCount`: 1**, same **`profileId`** as other QA; matching **`POST /api/chat`** completed **200** with **`responseTime` ~4492 ms** and AI SDK stream headers (`content-length` **502** on the request body in the sampled run) — consistent with a multi-step agent loop vs a ~1 s single completion.
- **Server log caveat:** access logs do not spell out tool names (`bash`, `file_read`); correlate multi-tool work via long **`responseTime`**, **`chat request`** metadata, and filesystem side effects.
- **Chrome DevTools MCP automation:** **`fill`** should work after **#16** (native **`input`** sync + submit flush); **`evaluate_script`** + synthetic **`input`** remains a fallback if a client does not fire **`input`**.
- **UI scrape caveat:** a snapshot of **`.messages`** `innerText` in one check showed only the **USER** block; do not rely on that alone for assistant or tool-card text — confirm in the live UI or persist the session and re-open.

### Intensive agent interaction (API smoke + architecture)

**Goal:** stress real agent turns, note bottlenecks, and give repeatable browser scenarios.

**Architecture / bottlenecks** (`apps/server/src/agentLoop.ts`, `config.maxToolRounds`)

- Each agent **turn** is a full **`streamText`** call with **`maxSteps: 1`**; the loop appends assistant + tool messages and runs **`trimToContextBudget`** again. Wall time scales with **model latency × turn count** and grows with transcript size.
- Default **`MAX_TOOL_ROUNDS`** is **8** (env override). Hitting the cap while the model still requests tools yields **`max_turns`** with an explicit streamed notice (see **#15**).
- **`agent:progress`** now includes **`toolName`** while each built-in tool runs (see **#14**).
- After the loop, **`addConversationToMemory`** receives the full **`loopResult.text`**. Verbose assistant output (see below) increases mem0 work and cost.

**API smoke** (`POST http://localhost:3001/api/chat`, `agentMode: true`)

- Fixtures in repo: **`scripts/agent-qa-request.json`** (multi-step: list workspace + read a `.md` if present), **`scripts/agent-qa-minimal.json`** (single **`bash`** / `Write-Output`).
- Example: `curl -sS --max-time 120 -H "Content-Type: application/json" -d "@scripts/agent-qa-minimal.json" http://localhost:3001/api/chat -o scripts/agent-qa-minimal-out.txt` — captured bodies are **AI SDK data stream** lines (`0:"…"`). Output captures are **gitignored** (`scripts/agent-qa-*.txt`).
- Observed **wall time:** short tool-style prompt **~4–8 s**; longer chained instructions **~30–50+ s** with matching **`responseTime`** on **`POST /api/chat`** in **`server.log`**.
- **Windows curl gotcha:** in one run, **`curl -N -o file`** reported success but wrote **0 bytes** while the server still logged a long **`responseTime`** — prefer plain **`curl -o`** (buffered) or another client when archiving streams.
- **Model behavior (e.g. `openai/gpt-oss-20b`):** long speculative narration may still appear; **#24** tightens **`buildAgentSystemPrompt`** (tool-first). Further gains may need a different routed model or post-processing.

**Manual scenarios (browser, Agent ON)** — run with **`http://localhost:5173/`**, watch **Turn N/M**, Analytics, and **Network** `POST /api/chat`.

1. **Three-turn dialogue:** factual question → follow-up referencing the first answer → third message that requires **`bash`** (e.g. list `workspace/`). Check context retention and token usage.
2. **Tool failure:** **`file_read`** on a path that does not exist — assistant should surface the tool error and recover with a short plan.
3. **Many steps:** ask for **six** sequential workspace operations — observe approach to the **8**-turn cap and whether the user sees a clear stop reason.
4. **Interrupt:** click **Stop** mid-agent-run — partial assistant text, no hang, socket/analytics sane.
5. **Long paste:** user message **~8k+** characters — watch **`server.log`** for **`context overflow: escalated model`** and UI degradation.

**Chrome DevTools MCP (verified on `http://localhost:5173/`, Agent ON)**

- **Flow:** `navigate_page` → toggle **🤖 Agent** → **Новый чат** → inject composer text with **`evaluate_script`** (native `value` setter + bubbling **`input`**) → programmatic click **Отправить** (same pattern as documented above; avoids **`fill`** breaking React).
- **During run:** a11y snapshot showed **`Размышляет...`**, **`Turn 1`/`8`**, and **Стоп** while the request was in flight.
- **Scenario #2 (missing file):** prompt asked for **`file_read`** on **`does_not_exist_99.txt`**; completed state showed **`ASSISTANT`** in the tree with text quoting **`ENOENT: no such file or directory`**, header **Готово**, **Перегенерировать**, analytics **Total tokens** updated (**~5.4k** in this run), **`Turn 2`/`8`** after completion (counter reflects agent loop progress, not only user sends).
- **Minor quality issue:** assistant text had a small garble (**`finalile`**) and duplicated phrasing — model output, not transport.
- **Method note:** prefer **`take_snapshot`** (a11y tree) over raw **`.messages` `innerText`** alone when automating; the latter can miss assistant rows depending on timing and DOM.

### Follow-ups for deeper agent QA

- **`/learn`**, **`/wiki`**, **`/tasks`** (some return DB-backed text; **`learn`** sets **`action`** for downstream behavior—trace in server).
- Confirm **mem0** write path when the profile has a working mem0 backend.
- Optional: agent turn that exercises **MCP** tools in addition to built-in **bash** / **file_***.
- Sub-agent **`runSubAgent`** emits **`phase: 'llm'`** each turn ( **`orchestrator.ts`** ); per-tool **`phase: 'tool'`** is not wired there (**`generateText`** **`maxSteps: 3`** batches steps).

## Reset checklist for clean QA

1. Delete test profiles in Settings (or via `DELETE /api/profiles/:id`).
2. Truncate or delete `apps/server/logs/server.log` if you need a quiet log tail.
3. Remove any ad-hoc files under `workspace/` left by agent QA (they are not tracked; `workspace/` is gitignored).
4. Delete optional **`scripts/agent-qa-*.txt`** captures if you ran the curl examples (gitignored, safe to leave on disk).
