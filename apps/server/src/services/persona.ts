import type { MemoryProfile } from "../store.js";

/**
 * Build the persona layer for the system prompt from profile data.
 */
export function buildPersonaPromptLayer(profile: MemoryProfile | null): string {
  if (!profile) return "";

  const parts: string[] = [];

  if (profile.personality) {
    parts.push(`## Your Persona: ${profile.name}`);
    parts.push(profile.personality);
  }
  if (profile.voiceStyle) {
    parts.push(`Communication style: ${profile.voiceStyle}`);
  }
  if (profile.customSystemPrompt) {
    if (profile.systemPromptMode === "replace") {
      return profile.customSystemPrompt;
    }
    parts.push(profile.customSystemPrompt);
  }

  return parts.join("\n");
}
