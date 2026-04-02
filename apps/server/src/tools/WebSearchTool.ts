import { z } from "zod";
import { generateText } from "ai";
import { buildTool } from "./buildTool.js";
import { togetherLlm } from "../pipeline/chatHelpers.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const SEARCH_MAX_ATTEMPTS = 3;
const SEARCH_INITIAL_BACKOFF_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchWithRetries<T>(
  query: string,
  searchFn: () => Promise<T>,
): Promise<T> {
  let delayMs = SEARCH_INITIAL_BACKOFF_MS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= SEARCH_MAX_ATTEMPTS; attempt++) {
    try {
      return await searchFn();
    } catch (e) {
      lastError = e;
      if (attempt === SEARCH_MAX_ATTEMPTS) break;
      logger.warn(
        { err: e, query, attempt },
        `web_search DuckDuckGo attempt ${attempt} failed, retrying after backoff`,
      );
      await sleep(delayMs);
      delayMs *= 2;
    }
  }
  throw lastError;
}

export const WebSearchTool = buildTool({
  name: "web_search",
  description:
    "Search the web using DuckDuckGo. Returns search results with titles, URLs, and snippets. " +
    "Optionally summarizes results using an LLM.",
  inputSchema: z.object({
    query: z.string().min(1).describe("Search query"),
    maxResults: z.number().int().min(1).max(20).optional().default(8),
    summarize: z.boolean().optional().default(false),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,

  async call(input) {
    try {
      const dds = await import("duck-duck-scrape");
      const searchResults = await searchWithRetries(input.query, () =>
        dds.search(input.query, {
          safeSearch: dds.SafeSearchType.MODERATE,
        }),
      );

      if (!searchResults.results?.length) {
        return `No search results for "${input.query}"`;
      }

      const results = searchResults.results.slice(0, input.maxResults).map((r: any) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.description ?? "",
      }));

      const formatted = results
        .map((r: any, i: number) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`)
        .join("\n\n");

      if (!input.summarize) return formatted;

      try {
        const summary = await generateText({
          model: togetherLlm(config.togetherBaseModel),
          temperature: 0,
          maxTokens: 800,
          prompt: `Summarize these search results for the query "${input.query}" concisely:\n\n${formatted}`,
        });
        return `## Summary\n${summary.text}\n\n## Sources\n${formatted}`;
      } catch (e) {
        logger.warn({ err: e }, "web_search summarization failed, returning raw results");
        return formatted;
      }
    } catch (e: any) {
      logger.warn({ err: e, query: input.query }, "web_search failed");
      return `Web search failed: ${e.message}. DuckDuckGo may be temporarily unavailable.`;
    }
  },
});
