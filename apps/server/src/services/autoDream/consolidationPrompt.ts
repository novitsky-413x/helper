export function buildConsolidationPrompt(
  memories: Array<{ id: string; text: string }>,
  recentSessionSummaries: string[],
): string {
  const memoryList = memories
    .map((m, i) => `[${i + 1}] (id: ${m.id}) ${m.text}`)
    .join("\n");

  const sessionsBlock = recentSessionSummaries.length > 0
    ? `\n\nRecent session summaries:\n${recentSessionSummaries.join("\n---\n")}`
    : "";

  return `You are a memory consolidation engine. Your task is to analyze and optimize the user's memory store.

## Current Memories
${memoryList}
${sessionsBlock}

## Instructions

Perform the following 4-phase analysis:

### Phase 1 - Orient
Read all memories. Identify themes, categories, and relationships.

### Phase 2 - Gather  
From the recent session summaries, identify NEW facts, preferences, rules, or skills that should be added to memory but aren't there yet.

### Phase 3 - Consolidate
- Find duplicate or overlapping memories → merge them
- Find contradictions → resolve (newer info wins)
- Create higher-level summaries where appropriate

### Phase 4 - Prune & Index
- Identify outdated or irrelevant memories → mark for deletion
- Assign categories to each memory: fact, preference, rule, skill, goal

## Output Format
Return a JSON object with this structure:
{
  "merge": [
    { "keepId": "id-to-keep", "removeIds": ["id1", "id2"], "newText": "merged text" }
  ],
  "create": [
    { "text": "new memory text", "category": "fact|preference|rule|skill|goal" }
  ],
  "delete": ["id1", "id2"],
  "stats": {
    "totalAnalyzed": 0,
    "merged": 0,
    "created": 0,
    "deleted": 0,
    "unchanged": 0
  }
}

IMPORTANT: Return ONLY the JSON object. No markdown, no explanations.`;
}
