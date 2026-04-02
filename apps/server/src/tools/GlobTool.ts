import { z } from "zod";
import { createRequire } from "node:module";
import { buildTool } from "./buildTool.js";

const require = createRequire(import.meta.url);

export const GlobTool = buildTool({
  name: "glob",
  description: "Find files matching a glob pattern. Returns file paths sorted by modification time.",
  inputSchema: z.object({
    pattern: z.string().min(1).describe("Glob pattern (e.g. **/*.ts)"),
    cwd: z.string().optional().describe("Override working directory"),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,

  async call(input, context) {
    try {
      const fg = require("fast-glob") as (pattern: string, opts: Record<string, unknown>) => Promise<string[]>;
      const files = await fg(input.pattern, {
        cwd: input.cwd ?? context.workingDirectory,
        dot: false,
        ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
      });
      if (files.length === 0) return `No files matching "${input.pattern}"`;

      const result = files
        .slice(0, 100)
        .join("\n");

      return files.length > 100
        ? `${result}\n\n... and ${files.length - 100} more files`
        : result;
    } catch (e: any) {
      return `Glob error: ${e.message}`;
    }
  },
});
