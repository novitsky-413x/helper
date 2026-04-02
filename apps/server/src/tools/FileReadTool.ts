import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { buildTool } from "./buildTool.js";

export const FileReadTool = buildTool({
  name: "file_read",
  description: "Read a file from disk. Supports offset/limit for large files.",
  inputSchema: z.object({
    filePath: z.string().min(1),
    offset: z.number().int().optional().describe("Start line (1-based)"),
    limit: z.number().int().optional().describe("Max lines to read"),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,

  async call(input, context) {
    const resolved = path.resolve(context.workingDirectory, input.filePath);
    try {
      const info = await stat(resolved);
      if (!info.isFile()) return `Error: ${resolved} is not a file.`;
      if (info.size > 5 * 1024 * 1024) {
        return `Error: File too large (${(info.size / 1024 / 1024).toFixed(1)}MB). Use offset/limit.`;
      }

      const raw = await readFile(resolved, "utf-8");
      const lines = raw.split("\n");

      if (input.offset || input.limit) {
        const start = Math.max(0, (input.offset ?? 1) - 1);
        const end = input.limit ? start + input.limit : lines.length;
        const sliced = lines.slice(start, end);
        return sliced
          .map((line, i) => `${String(start + i + 1).padStart(6)}|${line}`)
          .join("\n");
      }

      return lines
        .map((line, i) => `${String(i + 1).padStart(6)}|${line}`)
        .join("\n");
    } catch (e: any) {
      if (e.code === "ENOENT") return `File not found: ${resolved}`;
      return `Error reading file: ${e.message}`;
    }
  },
});
