import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { buildTool } from "./buildTool.js";

export const FileWriteTool = buildTool({
  name: "file_write",
  description: "Write content to a file. Creates the file and parent directories if they don't exist.",
  inputSchema: z.object({
    filePath: z.string().min(1),
    content: z.string(),
  }),
  isReadOnly: false,
  isConcurrencySafe: false,

  async call(input, context) {
    const resolved = path.resolve(context.workingDirectory, input.filePath);
    try {
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, input.content, "utf-8");
      return `File written: ${resolved} (${input.content.length} chars)`;
    } catch (e: any) {
      return `Error writing file: ${e.message}`;
    }
  },
});
