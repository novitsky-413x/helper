import { z } from "zod";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { buildTool } from "./buildTool.js";

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", ".next", "__pycache__", ".cache"]);
const MAX_RESULTS = 50;
const MAX_FILE_SIZE = 1024 * 1024;

export const GrepTool = buildTool({
  name: "grep",
  description: "Search for a regex pattern in file contents. Returns matching lines with file paths and line numbers.",
  inputSchema: z.object({
    pattern: z.string().min(1).describe("Regex pattern to search for"),
    path: z.string().optional().describe("Directory or file to search in"),
    glob: z.string().optional().describe("Glob filter for file names (e.g. *.ts)"),
    caseSensitive: z.boolean().optional().default(true),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,

  async call(input, context) {
    const root = path.resolve(context.workingDirectory, input.path ?? ".");
    const flags = input.caseSensitive ? "" : "i";
    let regex: RegExp;
    try {
      regex = new RegExp(input.pattern, flags);
    } catch (e: any) {
      return `Invalid regex: ${e.message}`;
    }

    const results: string[] = [];
    const globFilter = input.glob
      ? new RegExp(input.glob.replace(/\./g, "\\.").replace(/\*/g, ".*"))
      : null;

    async function searchDir(dir: string, depth: number) {
      if (depth > 8 || results.length >= MAX_RESULTS) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= MAX_RESULTS) break;
        if (entry.isDirectory()) {
          if (!IGNORE_DIRS.has(entry.name)) {
            await searchDir(path.join(dir, entry.name), depth + 1);
          }
        } else if (entry.isFile()) {
          if (globFilter && !globFilter.test(entry.name)) continue;
          const fp = path.join(dir, entry.name);
          try {
            const s = await stat(fp);
            if (s.size > MAX_FILE_SIZE) continue;
            const content = await readFile(fp, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
              if (regex.test(lines[i]!)) {
                const rel = path.relative(context.workingDirectory, fp);
                results.push(`${rel}:${i + 1}:${lines[i]!.slice(0, 200)}`);
              }
            }
          } catch { /* skip unreadable files */ }
        }
      }
    }

    try {
      const rootStat = await stat(root);
      if (rootStat.isFile()) {
        const content = await readFile(root, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
          if (regex.test(lines[i]!)) {
            results.push(`${path.relative(context.workingDirectory, root)}:${i + 1}:${lines[i]!.slice(0, 200)}`);
          }
        }
      } else {
        await searchDir(root, 0);
      }
    } catch (e: any) {
      return `Search error: ${e.message}`;
    }

    if (results.length === 0) return `No matches for "${input.pattern}"`;
    const header = results.length >= MAX_RESULTS ? `[showing first ${MAX_RESULTS} results]\n` : "";
    return header + results.join("\n");
  },
});
