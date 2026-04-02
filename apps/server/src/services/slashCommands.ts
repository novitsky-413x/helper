import { getDb } from "../db.js";
import { logger } from "../logger.js";

export interface SlashCommandResult {
  handled: boolean;
  response?: string;
  action?: string;
}

export function parseSlashCommand(text: string): { command: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) {
    return { command: trimmed.slice(1).toLowerCase(), args: "" };
  }
  return {
    command: trimmed.slice(1, spaceIdx).toLowerCase(),
    args: trimmed.slice(spaceIdx + 1).trim(),
  };
}

export async function handleSlashCommand(
  command: string,
  args: string,
  profileId?: string,
): Promise<SlashCommandResult> {
  try {
    switch (command) {
      case "compact":
        return { handled: true, action: "compact", response: "Context compaction requested. The agent will compact the conversation on the next turn." };

      case "dream":
        return { handled: true, action: "dream", response: "Memory consolidation (autoDream) triggered manually." };

      case "persona": {
        return { handled: true, response: "Persona settings are now part of your profile. Edit them in Settings." };
      }

      case "context":
        return { handled: true, action: "context_info", response: "Context info will be shown by the agent." };

      case "tasks": {
        const db = getDb();
        const tasks = db.prepare(
          "SELECT id, title, status FROM agent_tasks WHERE profileId = ? ORDER BY updatedAt DESC LIMIT 20"
        ).all(profileId ?? "") as any[];
        if (tasks.length === 0) return { handled: true, response: "No active tasks." };
        const lines = tasks.map((t: any) => {
          const icon = t.status === "completed" ? "✅" : t.status === "in_progress" ? "🔄" : "⏳";
          return `${icon} ${t.title} [${t.status}]`;
        });
        return { handled: true, response: `Tasks:\n${lines.join("\n")}` };
      }

      case "learn":
        if (!args) return { handled: true, response: "Usage: /learn <topic>. Specify a topic to start learning." };
        return { handled: true, action: "learn", response: `Starting learning plan for: ${args}` };

      case "wiki": {
        if (!args) return { handled: true, response: "Usage: /wiki <search query>" };
        const db = getDb();
        const articles = db.prepare(
          "SELECT id, title FROM wiki_articles WHERE profileId = ? AND (title LIKE ? OR content LIKE ?) LIMIT 10"
        ).all(profileId ?? "", `%${args}%`, `%${args}%`) as any[];
        if (articles.length === 0) return { handled: true, response: `No wiki articles found for "${args}".` };
        const lines = articles.map((a: any) => `📖 ${a.title} (${a.id.slice(0, 8)})`);
        return { handled: true, response: `Wiki results:\n${lines.join("\n")}` };
      }

      case "autopilot": {
        const subCmd = args.toLowerCase();
        if (subCmd === "status" || !subCmd) {
          return { handled: true, action: "autopilot_status", response: "Autopilot status will be shown." };
        }
        return { handled: true, response: `Unknown Autopilot subcommand: ${subCmd}` };
      }

      default:
        return { handled: false };
    }
  } catch (e) {
    logger.error({ err: e, command, args }, "slash command error");
    return { handled: true, response: `Command error: ${String(e)}` };
  }
}
