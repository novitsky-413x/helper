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

  const metaIntent =
    /(запомни|запомнить|remember|сохрани|сохранить|store|save|memo|забудь|forget|удали.*пам|delete.*mem|инструкц|instruction|правил|rule|факт|fact|нельзя|запрет|prohibit|forbid|ban)\b/.test(t);
  if (metaIntent) return false;

  const audioIntent =
    /(music|song|melody|audio|sound|voice|speech|podcast|tts|read.*aloud)\b/.test(t) ||
    /(музык|песн|мелоди|аудио|звук|голос|речь|подкаст|озвуч|прочит|прочт|зачит|прослуш)/.test(t);
  if (audioIntent) return false;

  const imageIntent =
    /(generate|create|draw|render|make|illustrate|paint|design)\b/.test(t) ||
    /(сгенерир|созда(й|ть)|нарису(й|йте|ть)|картинк|изображен|иллюстрац|рендер)/.test(t);
  if (!imageIntent) return false;

  const nonGenOnly =
    /(analy[sz]e|describe|ocr|caption|upscale|edit|crop|resize)\b/.test(t) ||
    /(опиш|описа|анализ|распозна|ocr|обреж|измени|улучши|увелич|что.*изображен|что.*на.*картинк)/.test(t);
  return !nonGenOnly;
}

/** Detect audio/speech/music generation requests. */
export function isLikelyAudioRequest(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;

  const metaIntent =
    /(запомни|запомнить|remember|сохрани|сохранить|store|save|memo|забудь|forget|удали.*пам|delete.*mem|инструкц|instruction|правил|rule)\b/.test(t);
  if (metaIntent) return false;

  return (
    /(generat|creat|mak|play|synthesiz|read.*aloud)\b/.test(t) &&
    /(audio|sound|voice|speech|music|song|melody|podcast|tts|narrat)\b/.test(t)
  ) ||
    /(озвуч|сгенерир.*(?:аудио|звук|голос|речь|музык)|прочит.*вслух|прочт|зачит|прослуш|воспроизвед|сделай.*(?:аудио|звук|озвучк)|генер.*(?:звук|аудио|музык|голос|речь))/.test(t) ||
    /(generate.*audio|generate.*speech|generate.*sound|text.to.speech|tts\b|read.*aloud|voice.*over|narrat)/.test(t);
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
  const feedbackOnImage =
    /(не\s*(совсем|так|то|тот|та|те|похож)|не\s+получил|неправильн|некорректн|не\s+та порода|not\s+(quite|right|correct)|wrong|incorrect)\b/.test(t) ||
    /(нужен|нужна|нужно|а\s*(можно|можешь|давай)|попроб|try\s+again|redo|ещ[ёе]\s+раз|заново|снова)\b/.test(t) ||
    /(должен|должна|должно|выглядит|выглядел|look\s*like|supposed|should\s+be)\b/.test(t) ||
    /(но\s+(это|он|она|оно|чтоб|чтобы)|but\s+(it|this|that|make))\b/.test(t);
  return editVerb || feedbackOnImage || (refersPriorImage && t.length <= 220);
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
