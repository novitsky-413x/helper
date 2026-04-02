import { z } from "zod";
import { createRequire } from "node:module";
import { buildTool } from "./buildTool.js";
import { logger } from "../logger.js";

const require = createRequire(import.meta.url);

export const WebFetchTool = buildTool({
  name: "web_fetch",
  description:
    "Fetch a URL and return its content as readable markdown text. " +
    "Useful for reading web pages, documentation, articles.",
  inputSchema: z.object({
    url: z.string().url().describe("The URL to fetch"),
    maxChars: z.number().optional().default(100000),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,

  async call(input) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(input.url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; HelperBot/1.0)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return `HTTP ${response.status}: ${response.statusText}`;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("html") && !contentType.includes("text")) {
        return `Non-text content type: ${contentType}. Cannot extract readable content.`;
      }

      const html = await response.text();

      const { JSDOM } = require("jsdom") as typeof import("jsdom");
      const { Readability } = require("@mozilla/readability") as typeof import("@mozilla/readability");
      const TurndownService = require("turndown") as any;

      const dom = new JSDOM(html, { url: input.url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      if (!article?.content) {
        return `Could not extract readable content from ${input.url}`;
      }

      const turndown = new TurndownService({ headingStyle: "atx" });
      let markdown: string = turndown.turndown(article.content);

      const limit = input.maxChars ?? 100000;
      if (markdown.length > limit) {
        markdown = markdown.slice(0, limit) + `\n\n... [truncated at ${limit} chars]`;
      }

      const header = article.title ? `# ${article.title}\n\n` : "";
      return `${header}${markdown}`;
    } catch (e: any) {
      logger.warn({ err: e, url: input.url }, "web_fetch failed");
      if (e.name === "AbortError") return `Fetch timeout (15s) for ${input.url}`;
      return `Fetch error: ${e.message}`;
    }
  },
});
