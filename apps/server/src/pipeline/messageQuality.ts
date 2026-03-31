import type { CoreMessage } from "ai";
import { logger } from "../logger.js";

const MODEL_ARTIFACT_RE =
  /<\|im_(end|start)\|>[^\n]?|<\|endoftext\|>|<\|eot_id\|>|<\|end_header_id\|>/g;

export function stripModelArtifacts(text: string): string {
  return text.replace(MODEL_ARTIFACT_RE, "").trim();
}

/**
 * Score from 0..100 indicating how "useful" a text response is.
 * 0 = definitely garbage / error;  100 = looks normal.
 * Thresholds are deliberately generous — we only want to catch clear junk.
 */
export function qualityScore(text: string): number {
  if (!text || !text.trim()) return 0;

  let score = 100;
  const t = text.trim();

  // ---------- structural signals ----------
  if (t.length < 5) return 0;
  if (t.length < 15) score -= 50;
  else if (t.length < 40) score -= 15;

  // model artifact leakage
  if (MODEL_ARTIFACT_RE.test(t)) score -= 30;
  MODEL_ARTIFACT_RE.lastIndex = 0;

  // ---------- content signals (error / fallback / canned) ----------
  const ERROR_SIGNALS = [
    /temporarily unavailable/i,
    /provider issues?\b/i,
    /Specialist execution failed/i,
    /Please try (again|another)/i,
    /Could not (generate|process|complete)/i,
    /due to a temporary/i,
    /I (was unable|couldn't|cannot|can't) (to )?(generate|process|complete|analyze|access)/i,
    /^I received your (image|file|message), but/i,
    /Image generation failed/i,
  ];
  let errorHits = 0;
  for (const re of ERROR_SIGNALS) {
    if (re.test(t)) errorHits++;
  }
  score -= errorHits * 25;

  // repetitive single-character / whitespace filler
  if (/^(.)\1{10,}$/.test(t.replace(/\s/g, ""))) score -= 70;

  return Math.max(0, Math.min(100, score));
}

const LOW_QUALITY_THRESHOLD = 40;

export function isLowQuality(text: string): boolean {
  return qualityScore(text) < LOW_QUALITY_THRESHOLD;
}

function getMessageText(msg: CoreMessage): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((p) => ("text" in p && typeof p.text === "string" ? p.text : ""))
      .join(" ");
  }
  return "";
}

function hasToolCalls(msg: CoreMessage): boolean {
  if (msg.role !== "assistant") return false;
  if (!Array.isArray(msg.content)) return false;
  return msg.content.some(
    (p) => "type" in p && (p as { type: string }).type === "tool-call",
  );
}

function cleanMessage(msg: CoreMessage): CoreMessage {
  if (msg.role === "tool") return msg;
  if (typeof msg.content !== "string") return msg;
  const cleaned = stripModelArtifacts(msg.content);
  if (cleaned === msg.content) return msg;
  return { ...msg, content: cleaned } as CoreMessage;
}

/**
 * Single-pass conversation sanitiser:
 *  1. Strip model artifacts from every message
 *  2. Drop low-quality assistant messages (+ orphaned preceding user msg)
 *     BUT never drop assistant messages that contain tool calls or
 *     precede a tool result (would break OpenAI API message ordering).
 *  3. Deduplicate consecutive identical assistant messages
 */
export function sanitizeConversation(messages: CoreMessage[]): CoreMessage[] {
  const result: CoreMessage[] = [];
  let dropped = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = cleanMessage(messages[i]);
    const text = getMessageText(msg);

    if (msg.role === "assistant") {
      // Never drop assistant messages that contain tool calls —
      // removing them would orphan the subsequent tool-result messages
      // and cause "Input validation error" from the LLM API.
      if (hasToolCalls(msg)) {
        result.push(msg);
        continue;
      }

      // Never drop if the next message is a tool result
      if (i + 1 < messages.length && messages[i + 1].role === "tool") {
        result.push(msg);
        continue;
      }

      // ---- drop low-quality assistant messages ----
      if (isLowQuality(text)) {
        if (result.length > 0 && result[result.length - 1].role === "user") {
          result.pop();
        }
        dropped++;
        continue;
      }

      // ---- deduplicate consecutive assistant messages ----
      if (result.length > 0) {
        const prev = result[result.length - 1];
        if (prev.role === "assistant" && getMessageText(prev) === text) {
          dropped++;
          continue;
        }
      }
    }

    result.push(msg);
  }

  if (dropped > 0) {
    logger.debug({ dropped, before: messages.length, after: result.length }, "sanitizeConversation removed messages");
  }
  return result;
}
