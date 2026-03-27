type UiLikeMessage = {
  role: string;
  content?: unknown;
  parts?: Array<Record<string, unknown>>;
};

function textFromPart(part: Record<string, unknown>): string {
  const type = String(part.type ?? "").toLowerCase();
  if (type === "text" || type === "input_text") {
    if (typeof part.text === "string") return part.text;
    if (typeof part.content === "string") return part.content;
    if (typeof part.value === "string") return part.value;
  }
  return "";
}

function isImagePart(part: Record<string, unknown>): boolean {
  const type = String(part.type ?? "").toLowerCase();
  if (type.includes("image")) return true;
  if (typeof part.image_url === "string" || typeof part.imageUrl === "string") return true;
  if (typeof part.url === "string" && type === "file") return true;
  return false;
}

function imageUrlFromPart(part: Record<string, unknown>): string {
  if (typeof part.image_url === "string") return part.image_url;
  if (typeof part.imageUrl === "string") return part.imageUrl;
  if (typeof part.url === "string") return part.url;
  const nested = part.image_url as { url?: unknown } | undefined;
  if (nested && typeof nested.url === "string") return nested.url;
  return "";
}

/** Best-effort last user message summary from AI SDK UI messages */
export function lastUserMessageSummary(messages: UiLikeMessage[]): {
  text: string;
  imagePartCount: number;
  imageUrls: string[];
} {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return { text: "", imagePartCount: 0, imageUrls: [] };

  const parts = Array.isArray(last.parts)
    ? last.parts
    : Array.isArray(last.content)
      ? (last.content as Array<Record<string, unknown>>)
      : [];

  if (parts.length) {
    const text = parts.map(textFromPart).join("");
    const imageUrls = parts.filter(isImagePart).map(imageUrlFromPart).filter(Boolean);
    return { text, imagePartCount: imageUrls.length, imageUrls };
  }

  if (typeof last.content === "string") {
    return { text: last.content, imagePartCount: 0, imageUrls: [] };
  }
  return { text: "", imagePartCount: 0, imageUrls: [] };
}

/** Backward-compatible text extractor */
export function lastUserTextFromMessages(messages: UiLikeMessage[]): string {
  return lastUserMessageSummary(messages).text;
}

/** Fast heuristic: do we likely need image generation right now? */
export function isLikelyImageGenerationRequest(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;

  // Broad multilingual triggers to avoid extra classifier calls.
  const imageIntent =
    /(generate|create|draw|render|make|illustrate|paint|design)\b/.test(t) ||
    /(сгенерир|созда(й|ть)|нарису(й|йте|ть)|картинк|изображен|иллюстрац|рендер)/.test(t);
  if (!imageIntent) return false;

  // Ignore requests that are very likely about existing images editing/viewing only.
  const nonGenOnly =
    /(analy[sz]e|describe|ocr|caption|upscale|edit|crop|resize)\b/.test(t) ||
    /(опиши|анализ|распозна|ocr|обреж|измени|улучши|увелич)/.test(t);
  return !nonGenOnly;
}

/** Heuristic for "improve this image" requests with an attached image. */
export function isLikelyImageEditGenerationRequest(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;

  const editIntent =
    /(edit|improv|enhanc|restyl|variation|variant|rework|remix|retouch|recreate|make it|make this|change|modify|adjust|add|remove|replace)\b/.test(t) ||
    /(доработ|улучши|улучш|перерис|вариац|вариант|сделай.*(нов|друг)|измени стиль|ретуш|измени|поменяй|добавь|убери|замени|сделай)\b/.test(t);
  if (!editIntent) return false;

  const stillOnlyAnalysis =
    /(analy[sz]e|describe|ocr|caption|what is in|что на|опиши|анализ|распозна)/.test(t);
  return !stillOnlyAnalysis;
}

/** Follow-up edit request against the previously generated assistant image. */
export function isLikelyPriorImageFollowupEditRequest(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  const analysisOnly =
    /(analy[sz]e|describe|ocr|caption|what is in|что на|опиши|анализ|распозна)/.test(t);
  if (analysisOnly) return false;
  const editVerb =
    /(change|modify|adjust|tweak|make|add|remove|replace|turn|set|give)\b/.test(t) ||
    /(измени|поменяй|сделай|добавь|убери|замени|сделать|переделай|подправь|сделай так|пусть)/.test(t);
  const refersPriorImage =
    /(it|this|that|same|previous)\b/.test(t) ||
    /(ее|её|эту|эту же|ту же|предыдущ|картинку|изображение)/.test(t);
  // Short imperative follow-ups often omit explicit "image" keywords.
  return editVerb || (refersPriorImage && t.length <= 220);
}

function markdownImageUrls(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const re = /!\[[^\]]*]\(([^)\s]+)\)|\[Open original]\(([^)\s]+)\)/gi;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(text))) {
    const u = (m[1] || m[2] || "").trim();
    if (u) out.push(u);
  }
  return out;
}

export function lastAssistantImageUrlFromMessages(messages: UiLikeMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || m.role !== "assistant") continue;
    const parts = Array.isArray(m.parts)
      ? m.parts
      : Array.isArray(m.content)
        ? (m.content as Array<Record<string, unknown>>)
        : [];
    if (parts.length) {
      const partUrl = parts.filter(isImagePart).map(imageUrlFromPart).find(Boolean);
      if (partUrl) return partUrl;
    }
    if (typeof m.content === "string") {
      const fromMd = markdownImageUrls(m.content)[0];
      if (fromMd) return fromMd;
    }
  }
  return "";
}
