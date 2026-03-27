import express from "express";
import cors from "cors";
import { z } from "zod";
import { streamText, generateText, convertToCoreMessages, tool, type Message, type ToolSet } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import Together from "together-ai";
import path from "node:path";
import { existsSync } from "node:fs";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { pinoHttp } from "pino-http";
import { listChatModelsCached } from "./togetherModels.js";
import {
  getModelCatalog,
  refreshModelCatalog,
  resolveCategoryOrder,
  inferSimpleRequest,
  type TaskCategory,
} from "./modelCatalog.js";
import {
  searchMemoryForUser,
  buildMemoryContext,
  addConversationToMemory,
  getMemoryWriteStats,
  isMemoryAvailable,
  memoryGetAll,
  memoryUpdate,
  memoryDelete,
} from "./mem0Service.js";
import {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  getProfileById,
  listMcpServers,
  upsertMcpServer,
  deleteMcpServer,
  type McpServerRecord,
} from "./store.js";
import {
  buildMcpToolSet,
  testMcpServer,
  disconnectAllMcp,
  disconnectMcp,
} from "./mcpRuntime.js";
import {
  isLikelyImageGenerationRequest,
  isLikelyImageEditGenerationRequest,
  isLikelyPriorImageFollowupEditRequest,
  lastAssistantImageUrlFromMessages,
  lastUserMessageSummary,
  lastUserTextFromMessages,
} from "./messageUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(
  cors({
    origin: config.webOrigin,
    credentials: true,
    exposedHeaders: ["x-helper-resolved-model", "x-helper-base-model"],
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(
  pinoHttp({
    logger,
    customLogLevel: (req: IncomingMessage, res: ServerResponse, err?: Error) => {
      if (err) return "error";
      if (res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      const u = req.url ?? "";
      if (u === "/api/health" || u.startsWith("/api/health?")) return "debug";
      return "info";
    },
  })
);

const togetherLlm = createOpenAI({
  baseURL: "https://api.together.xyz/v1",
  apiKey: config.togetherApiKey,
});
const togetherClient = new Together({ apiKey: config.togetherApiKey });

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/models", async (_req, res) => {
  try {
    if (!config.togetherApiKey) {
      res.status(503).json({ error: "TOGETHER_API_KEY not configured" });
      return;
    }
    const models = await listChatModelsCached();
    res.json({ models });
  } catch (e) {
    logger.error({ err: e }, "GET /api/models failed");
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/model-catalog", async (_req, res) => {
  try {
    if (!config.togetherApiKey) {
      res.status(503).json({ error: "TOGETHER_API_KEY not configured" });
      return;
    }
    const catalog = await getModelCatalog();
    res.json({ catalog });
  } catch (e) {
    logger.error({ err: e }, "GET /api/model-catalog failed");
    res.status(500).json({ error: String(e) });
  }
});

const ChatBody = z.object({
  messages: z.array(z.unknown()),
  model: z.string().optional(),
  profileId: z.string().optional(),
});

type UsageSnapshot = {
  ts: string;
  resolvedModel: string;
  delegatedCategory?: string;
  profileId: string | null;
  messageCount: number;
  lastUserChars: number;
  memoryHits: number;
  memoryBlockChars: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  requestCostUsd: number | null;
  sessionCostUsd: number | null;
  memoryWriteOkTotal: number;
  memoryWriteFailTotal: number;
  memoryWriteLastOk: boolean | null;
};

const usageByProfile = new Map<string, UsageSnapshot>();
const sessionCostByProfile = new Map<string, number>();
const unavailableModelsUntil = new Map<string, number>();
const MODEL_UNAVAILABLE_TTL_MS = 15 * 60 * 1000;

function normalizePerMillion(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  if (value > 0 && value < 0.001) return value * 1_000_000;
  return value;
}

function estimateRequestCostUsd(params: {
  modelInputPer1M: number | null | undefined;
  modelOutputPer1M: number | null | undefined;
  promptTokens: number | null | undefined;
  completionTokens: number | null | undefined;
}): number | null {
  const inPrice = normalizePerMillion(params.modelInputPer1M);
  const outPrice = normalizePerMillion(params.modelOutputPer1M);
  const pt = typeof params.promptTokens === "number" ? params.promptTokens : null;
  const ct = typeof params.completionTokens === "number" ? params.completionTokens : null;
  if ((inPrice === null && outPrice === null) || (pt === null && ct === null)) return null;
  const inCost = inPrice !== null && pt !== null ? (pt / 1_000_000) * inPrice : 0;
  const outCost = outPrice !== null && ct !== null ? (ct / 1_000_000) * outPrice : 0;
  return inCost + outCost;
}

function isModelNotAvailableError(err: unknown): boolean {
  const e = err as { data?: { error?: { code?: string; message?: string } }; message?: string };
  const code = String(e?.data?.error?.code ?? "").toLowerCase();
  const msg = String(e?.data?.error?.message ?? e?.message ?? "").toLowerCase();
  return code === "model_not_available" || msg.includes("non-serverless model");
}

function markModelUnavailable(modelId: string) {
  unavailableModelsUntil.set(modelId, Date.now() + MODEL_UNAVAILABLE_TTL_MS);
}

function isModelTemporarilyUnavailable(modelId: string): boolean {
  const until = unavailableModelsUntil.get(modelId);
  if (!until) return false;
  if (Date.now() > until) {
    unavailableModelsUntil.delete(modelId);
    return false;
  }
  return true;
}

function pickFirstRoutableModel(candidates: string[]): string | null {
  for (const modelId of candidates) {
    if (!isModelTemporarilyUnavailable(modelId)) return modelId;
  }
  return null;
}

type ModalityRoute = "text_chat" | "image_gen" | "vision_understand";

function inferModalityRoute(params: {
  lastUserText: string;
  imageInputCount: number;
  likelyImageRequest: boolean;
  likelyImageEditRequest: boolean;
}): ModalityRoute {
  if (params.likelyImageRequest || params.likelyImageEditRequest) return "image_gen";
  if (params.imageInputCount > 0) return "vision_understand";
  return "text_chat";
}

function estimateTokensFromText(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.ceil(trimmed.length / 4);
}

function buildVisionMessages(
  uiMessages: Array<{ role: string; content?: unknown; parts?: Array<Record<string, unknown>> }>
): Array<{ role: "system" | "user" | "assistant"; content: string | Array<Record<string, unknown>> }> {
  const recent = uiMessages.slice(-8);
  const out: Array<{ role: "system" | "user" | "assistant"; content: string | Array<Record<string, unknown>> }> = [];
  for (const m of recent) {
    if (m.role !== "user" && m.role !== "assistant" && m.role !== "system") continue;
    const role = m.role as "system" | "user" | "assistant";
    const parts = Array.isArray(m.parts)
      ? m.parts
      : Array.isArray(m.content)
        ? (m.content as Array<Record<string, unknown>>)
        : [];
    if (!parts.length) {
      if (typeof m.content === "string" && m.content.trim()) out.push({ role, content: m.content });
      continue;
    }
    const contentParts: Array<Record<string, unknown>> = [];
    for (const p of parts) {
      const type = String(p.type ?? "").toLowerCase();
      const text = typeof p.text === "string" ? p.text : typeof p.content === "string" ? p.content : "";
      const imageUrl =
        typeof p.image_url === "string"
          ? p.image_url
          : typeof p.imageUrl === "string"
            ? p.imageUrl
            : typeof p.url === "string"
              ? p.url
              : typeof (p.image_url as { url?: unknown } | undefined)?.url === "string"
                ? ((p.image_url as { url?: string }).url as string)
                : "";
      if ((type === "text" || type === "input_text") && text) {
        contentParts.push({ type: "text", text });
      } else if (type.includes("image") || imageUrl) {
        contentParts.push({ type: "image_url", image_url: { url: imageUrl } });
      }
    }
    if (contentParts.length) {
      out.push({ role, content: contentParts });
    }
  }
  return out;
}

async function generateVisionReply(params: {
  uiMessages: Array<{ role: string; content?: unknown; parts?: Array<Record<string, unknown>> }>;
  candidateModels: string[];
}): Promise<{ text: string; usedModel: string } | null> {
  const candidates = [...new Set(params.candidateModels)].filter((id) => !isModelTemporarilyUnavailable(id));
  const messages = buildVisionMessages(params.uiMessages);
  if (!messages.length) return null;
  for (const candidate of candidates) {
    try {
      const response = (await (togetherClient as any).chat.completions.create({
        model: candidate,
        messages: [
          {
            role: "system",
            content:
              "You are a multimodal assistant. If user included images, analyze them accurately. " +
              "If user asks to generate a new image, explain that generation is handled separately.",
          },
          ...messages,
        ],
        temperature: 0.2,
      })) as { choices?: Array<{ message?: { content?: string } }> };
      const text = String(response.choices?.[0]?.message?.content ?? "").trim();
      if (!text) continue;
      return { text, usedModel: candidate };
    } catch (e) {
      const errObj = e as { data?: { error?: { code?: string; message?: string } }; message?: string };
      if (isModelNotAvailableError(e)) markModelUnavailable(candidate);
      logger.warn(
        {
          err: e,
          model: candidate,
          providerCode: errObj?.data?.error?.code ?? null,
          providerMessage: errObj?.data?.error?.message ?? errObj?.message ?? null,
        },
        "vision route failed"
      );
    }
  }
  return null;
}

async function buildImageEditPromptFromContext(params: {
  uiMessages: Array<{ role: string; content?: unknown; parts?: Array<Record<string, unknown>> }>;
  userInstruction: string;
  candidateModels: string[];
}): Promise<{ prompt: string; usedModel: string } | null> {
  const candidates = [...new Set(params.candidateModels)].filter((id) => !isModelTemporarilyUnavailable(id));
  const messages = buildVisionMessages(params.uiMessages);
  if (!messages.length) return null;
  for (const candidate of candidates) {
    try {
      const response = (await (togetherClient as any).chat.completions.create({
        model: candidate,
        messages: [
          {
            role: "system",
            content:
              "You create compact production-ready image generation prompts. " +
              "Given the uploaded image and user instruction, produce ONE final English prompt that preserves key elements of the original image while applying requested changes. " +
              "Return only the prompt text without markdown, explanation, or quotes.",
          },
          ...messages,
          {
            role: "user",
            content:
              `User instruction for editing/regeneration:\n${params.userInstruction || "(none)"}` +
              "\n\nOutput format: one single prompt line in English.",
          },
        ],
        temperature: 0.1,
      })) as { choices?: Array<{ message?: { content?: string } }> };
      const prompt = String(response.choices?.[0]?.message?.content ?? "").trim();
      if (!prompt) continue;
      return { prompt, usedModel: candidate };
    } catch (e) {
      if (isModelNotAvailableError(e)) markModelUnavailable(candidate);
      logger.warn({ err: e, model: candidate }, "image edit prompt synthesis failed");
    }
  }
  return null;
}

async function generateImageMarkdown(params: {
  prompt: string;
  preferredModel?: string;
  candidateModels: string[];
}): Promise<{ markdown: string; usedModel: string } | null> {
  const prioritized = params.preferredModel?.trim()
    ? [params.preferredModel.trim(), ...params.candidateModels]
    : params.candidateModels;
  const candidates = [...new Set(prioritized)].filter((id) => !isModelTemporarilyUnavailable(id));
  for (const candidate of candidates) {
    try {
      const response = (await togetherClient.images.create({
        model: candidate,
        prompt: params.prompt,
        width: 1024,
        height: 1024,
        response_format: "url",
        output_format: "png",
      })) as {
        data?: Array<{ url?: string; b64_json?: string; type?: string }>;
      };
      const first = response.data?.[0];
      const url = first?.url;
      const b64 = first?.b64_json;
      const imageRef = url || (b64 ? `data:image/png;base64,${b64}` : "");
      if (!imageRef) {
        logger.warn({ model: candidate }, "image fast-path returned empty result");
        continue;
      }
      return {
        markdown: `![generated image](${imageRef})\n\n[Open original](${imageRef})`,
        usedModel: candidate,
      };
    } catch (e) {
      const errObj = e as { data?: { error?: { code?: string; message?: string } }; message?: string };
      if (isModelNotAvailableError(e)) markModelUnavailable(candidate);
      logger.warn(
        {
          err: e,
          model: candidate,
          providerCode: errObj?.data?.error?.code ?? null,
          providerMessage: errObj?.data?.error?.message ?? errObj?.message ?? null,
        },
        "image fast-path generation failed"
      );
    }
  }
  return null;
}

app.post("/api/chat", async (req, res) => {
  const parsed = ChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(parsed.error.flatten());
    return;
  }
  if (!config.togetherApiKey) {
    res.status(503).json({ error: "TOGETHER_API_KEY not configured" });
    return;
  }

  const { messages, model: requestedModel, profileId } = parsed.data;
  const uiMessages = messages as Message[];
  const autoRequested = !requestedModel || requestedModel === "auto";

  const lastUserText = lastUserTextFromMessages(
    uiMessages as { role: string; content?: string; parts?: { type: string; text?: string }[] }[]
  );
  const lastUserSummary = lastUserMessageSummary(uiMessages as { role: string; content?: unknown; parts?: Record<string, unknown>[] }[]);
  const likelyImageRequest = isLikelyImageGenerationRequest(lastUserText);
  const priorAssistantImageUrl = lastAssistantImageUrlFromMessages(
    uiMessages as { role: string; content?: unknown; parts?: Array<Record<string, unknown>> }[]
  );
  const likelyImageEditRequest = isLikelyImageEditGenerationRequest(lastUserText);
  const likelyPriorImageFollowupEdit =
    !!priorAssistantImageUrl && isLikelyPriorImageFollowupEditRequest(lastUserText);
  const hasImageContext = lastUserSummary.imagePartCount > 0 || !!priorAssistantImageUrl;
  const modalityRoute = inferModalityRoute({
    lastUserText,
    imageInputCount: hasImageContext ? 1 : 0,
    likelyImageRequest,
    likelyImageEditRequest: (likelyImageEditRequest && hasImageContext) || likelyPriorImageFollowupEdit,
  });

  try {
    const catalog = await getModelCatalog();
    const profile = profileId ? await getProfileById(profileId) : null;
    const primaryCandidates = resolveCategoryOrder("primary", profile?.modelPreferences, catalog);
    const selectedModel = autoRequested
      ? pickFirstRoutableModel([config.togetherBaseModel, ...primaryCandidates]) ?? config.togetherBaseModel
      : requestedModel!;
    let delegatedCategory: TaskCategory | undefined;
    const usageKey = profileId ?? "__default__";
    const modelPrice = catalog.models.find((m) => m.id === selectedModel)?.pricing;

    const finalizeUsageSnapshot = (params?: {
      promptTokens?: number | null;
      completionTokens?: number | null;
      totalTokens?: number | null;
      resolvedModel?: string;
      modelInputPer1M?: number | null;
      modelOutputPer1M?: number | null;
      requestCostUsd?: number | null;
      memoryWriteLastOk?: boolean | null;
    }) => {
      const promptTokens =
        typeof params?.promptTokens === "number" ? params.promptTokens : null;
      const completionTokens =
        typeof params?.completionTokens === "number" ? params.completionTokens : null;
      const totalTokens = typeof params?.totalTokens === "number" ? params.totalTokens : null;
      const requestCostUsd =
        typeof params?.requestCostUsd === "number"
          ? params.requestCostUsd
          : estimateRequestCostUsd({
              modelInputPer1M: params?.modelInputPer1M ?? modelPrice?.input ?? null,
              modelOutputPer1M: params?.modelOutputPer1M ?? modelPrice?.output ?? null,
              promptTokens,
              completionTokens,
            });
      const memStats = getMemoryWriteStats();
      const prevSessionCost = sessionCostByProfile.get(usageKey) ?? 0;
      const nextSessionCost = prevSessionCost + (requestCostUsd ?? 0);
      sessionCostByProfile.set(usageKey, nextSessionCost);
      usageByProfile.set(usageKey, {
        ts: new Date().toISOString(),
        resolvedModel: params?.resolvedModel ?? selectedModel,
        delegatedCategory,
        profileId: profileId ?? null,
        messageCount: uiMessages.length,
        lastUserChars: lastUserText.length,
        memoryHits,
        memoryBlockChars: memoryBlock.length,
        promptTokens,
        completionTokens,
        totalTokens,
        requestCostUsd,
        sessionCostUsd: nextSessionCost,
        memoryWriteOkTotal: memStats.ok,
        memoryWriteFailTotal: memStats.fail,
        memoryWriteLastOk:
          typeof params?.memoryWriteLastOk === "boolean" ? params.memoryWriteLastOk : null,
      });
    };

    logger.info(
      {
        route: "POST /api/chat",
        resolvedModel: selectedModel,
        modalityRoute,
        routedCandidates: primaryCandidates.slice(0, 5),
        profileId: profileId ?? null,
        lastUserChars: lastUserText.length,
        imageInputs: lastUserSummary.imagePartCount,
        priorAssistantImage: !!priorAssistantImageUrl,
        likelyImageRequest,
        likelyImageEditRequest,
        likelyPriorImageFollowupEdit,
        messageCount: uiMessages.length,
      },
      "chat request"
    );
    res.setHeader("x-helper-resolved-model", selectedModel);
    res.setHeader("x-helper-base-model", config.togetherBaseModel);

    const mem0UserId = profile?.mem0UserId;

    let memoryBlock = "";
    let memoryHits = 0;
    if (mem0UserId) {
      const memCtx = await buildMemoryContext({
        query: lastUserText || "hello",
        userId: mem0UserId,
        pinned: profile?.memoryPins ?? [],
        policy: profile?.memoryPolicy,
        isSimpleRequest: inferSimpleRequest(lastUserText || ""),
      });
      memoryBlock = memCtx.block;
      memoryHits = memCtx.hits;
    }

    const mcpRows = await listMcpServers();
    const mcpTools = await buildMcpToolSet(mcpRows);
    let precomposedImageReply: string | null = null;
    let precomposedImageModel: string | null = null;
    let precomposedImagePromptModel: string | null = null;
    if (modalityRoute === "image_gen") {
      const imageCandidates = resolveCategoryOrder("image_gen", profile?.modelPreferences, catalog);
      const visionCandidates = resolveCategoryOrder("vision", profile?.modelPreferences, catalog);
      let imagePrompt = lastUserText || "A high quality image";
      if ((likelyImageEditRequest || likelyPriorImageFollowupEdit) && lastUserSummary.imagePartCount > 0) {
        const synthesized = await buildImageEditPromptFromContext({
          uiMessages: uiMessages as Array<{ role: string; content?: unknown; parts?: Array<Record<string, unknown>> }>,
          userInstruction: lastUserText,
          candidateModels: visionCandidates,
        });
        if (synthesized?.prompt) {
          imagePrompt = synthesized.prompt;
          precomposedImagePromptModel = synthesized.usedModel;
        } else if (lastUserSummary.imageUrls[0]) {
          imagePrompt =
            `${lastUserText || "Create a variation of the attached image"}. ` +
            `Use this source image as visual reference: ${lastUserSummary.imageUrls[0]}`;
        }
      } else if ((likelyImageEditRequest || likelyPriorImageFollowupEdit) && priorAssistantImageUrl) {
        imagePrompt =
          `${lastUserText || "Create an edited version of the previous image"}. ` +
          `Use this source image as visual reference: ${priorAssistantImageUrl}`;
      }
      logger.info(
        {
          route: "POST /api/chat",
          imageIntent: true,
          imageEditIntent: likelyImageEditRequest,
          promptChars: imagePrompt.length,
          imageInputs: lastUserSummary.imagePartCount,
          promptSynthModel: precomposedImagePromptModel,
          candidates: imageCandidates.slice(0, 8),
        },
        "image fast-path start"
      );
      const generated = await generateImageMarkdown({
        prompt: imagePrompt,
        candidateModels: imageCandidates,
      });
      if (generated) {
        precomposedImageReply = generated.markdown;
        precomposedImageModel = generated.usedModel;
        logger.info(
          { route: "POST /api/chat", imageIntent: true, usedModel: generated.usedModel },
          "image fast-path generated"
        );
      } else {
        logger.warn(
          {
            route: "POST /api/chat",
            imageIntent: true,
            promptPreview: lastUserText.slice(0, 160),
            imageInputs: lastUserSummary.imagePartCount,
          },
          "image fast-path failed for all candidates"
        );
      }
    }
    if (modalityRoute === "image_gen") {
      const fallbackText =
        "I could not generate the image right now due to a temporary provider issue. Please try again in a moment with the same prompt.";
      const finalImageReply = precomposedImageReply ?? fallbackText;
      const imageResolvedModel = precomposedImageModel ?? selectedModel;
      res.setHeader("x-helper-resolved-model", imageResolvedModel);
      const imageReplyStream = streamText({
        model: togetherLlm(selectedModel),
        temperature: 0,
        maxTokens: 220,
        prompt:
          "Output exactly the following text and nothing else:\n" +
          finalImageReply,
        onFinish: async ({ usage }) => {
          const usageSafe = usage as
            | {
                promptTokens?: number;
                completionTokens?: number;
                totalTokens?: number;
              }
            | undefined;
          delegatedCategory = "image_gen";
          const generatedModelPrice =
            precomposedImageModel ? catalog.models.find((m) => m.id === precomposedImageModel)?.pricing : null;
          const estimatedPromptTokens =
            typeof usageSafe?.promptTokens === "number" ? usageSafe.promptTokens : estimateTokensFromText(lastUserText);
          const estimatedCompletionTokens =
            typeof usageSafe?.completionTokens === "number"
              ? usageSafe.completionTokens
              : estimateTokensFromText(finalImageReply);
          let memoryWriteLastOk: boolean | null = null;
          if (mem0UserId && lastUserText && finalImageReply) {
            try {
              memoryWriteLastOk = await addConversationToMemory(mem0UserId, lastUserText, finalImageReply);
            } catch (e) {
              memoryWriteLastOk = false;
              logger.warn({ err: e, mem0UserId }, "mem0 addConversation failed");
            }
          }
          finalizeUsageSnapshot({
            resolvedModel: imageResolvedModel,
            modelInputPer1M: generatedModelPrice?.input ?? null,
            modelOutputPer1M: generatedModelPrice?.output ?? null,
            promptTokens: estimatedPromptTokens,
            completionTokens: estimatedCompletionTokens,
            totalTokens:
              typeof usageSafe?.totalTokens === "number"
                ? usageSafe.totalTokens
                : estimatedPromptTokens + estimatedCompletionTokens,
            memoryWriteLastOk,
          });
        },
      });
      imageReplyStream.pipeDataStreamToResponse(res);
      return;
    }
    if (modalityRoute === "vision_understand") {
      const visionCandidates = resolveCategoryOrder("vision", profile?.modelPreferences, catalog);
      logger.info(
        {
          route: "POST /api/chat",
          modalityRoute,
          imageInputs: lastUserSummary.imagePartCount,
          candidates: visionCandidates.slice(0, 8),
        },
        "vision route start"
      );
      const vision = await generateVisionReply({
        uiMessages: uiMessages as Array<{ role: string; content?: unknown; parts?: Array<Record<string, unknown>> }>,
        candidateModels: visionCandidates,
      });
      const finalVisionReply =
        vision?.text ??
        "I received your image, but analysis is temporarily unavailable due to provider issues. Please retry in a moment.";
      const visionResolvedModel = vision?.usedModel ?? selectedModel;
      res.setHeader("x-helper-resolved-model", visionResolvedModel);
      if (vision) {
        logger.info(
          { route: "POST /api/chat", modalityRoute, usedModel: vision.usedModel },
          "vision route generated"
        );
      } else {
        logger.warn(
          { route: "POST /api/chat", modalityRoute, imageInputs: lastUserSummary.imagePartCount },
          "vision route failed for all candidates"
        );
      }
      const visionReplyStream = streamText({
        model: togetherLlm(selectedModel),
        temperature: 0,
        maxTokens: 500,
        prompt: "Output exactly the following text and nothing else:\n" + finalVisionReply,
        onFinish: async ({ usage }) => {
          const usageSafe = usage as
            | {
                promptTokens?: number;
                completionTokens?: number;
                totalTokens?: number;
              }
            | undefined;
          delegatedCategory = "vision";
          const visionModelPrice =
            vision?.usedModel ? catalog.models.find((m) => m.id === vision.usedModel)?.pricing : null;
          const estimatedPromptTokens =
            typeof usageSafe?.promptTokens === "number" ? usageSafe.promptTokens : estimateTokensFromText(lastUserText);
          const estimatedCompletionTokens =
            typeof usageSafe?.completionTokens === "number"
              ? usageSafe.completionTokens
              : estimateTokensFromText(finalVisionReply);
          let memoryWriteLastOk: boolean | null = null;
          if (mem0UserId && lastUserText && finalVisionReply) {
            try {
              memoryWriteLastOk = await addConversationToMemory(mem0UserId, lastUserText, finalVisionReply);
            } catch (e) {
              memoryWriteLastOk = false;
              logger.warn({ err: e, mem0UserId }, "mem0 addConversation failed");
            }
          }
          finalizeUsageSnapshot({
            resolvedModel: visionResolvedModel,
            modelInputPer1M: visionModelPrice?.input ?? null,
            modelOutputPer1M: visionModelPrice?.output ?? null,
            promptTokens: estimatedPromptTokens,
            completionTokens: estimatedCompletionTokens,
            totalTokens:
              typeof usageSafe?.totalTokens === "number"
                ? usageSafe.totalTokens
                : estimatedPromptTokens + estimatedCompletionTokens,
            memoryWriteLastOk,
          });
        },
      });
      visionReplyStream.pipeDataStreamToResponse(res);
      return;
    }
    const imageTools: ToolSet = {
      generate_image: tool({
        description: "Generate an image for the user request and return a markdown image link.",
        parameters: z.object({
          prompt: z.string().min(4),
          width: z.number().int().min(256).max(2048).optional(),
          height: z.number().int().min(256).max(2048).optional(),
          model: z.string().optional(),
        }),
        execute: async ({ prompt, width, height, model }) => {
          const ordered = resolveCategoryOrder("image_gen", profile?.modelPreferences, catalog);
          const generated = await generateImageMarkdown({
            prompt,
            preferredModel: model,
            candidateModels: ordered,
          });
          if (generated) return generated.markdown;
          return "Image generation failed. Please try another prompt.";
        },
      }),
    };
    const delegateTool: ToolSet = {
      delegate_to_category: tool({
        description:
          "Delegate a sub-task to a specialist model category (code_mcp, reasoning, vision, image_gen, audio, memory).",
        parameters: z.object({
          category: z.enum(["primary", "code_mcp", "reasoning", "vision", "image_gen", "audio", "memory"]),
          task: z.string().min(1),
        }),
        execute: async ({ category, task }) => {
          delegatedCategory = category;
          const ordered = resolveCategoryOrder(category, profile?.modelPreferences, catalog);
          const picked = pickFirstRoutableModel(ordered) ?? selectedModel;
          try {
            const answer = await generateText({
              model: togetherLlm(picked),
              temperature: 0.1,
              maxTokens: 1200,
              prompt: `You are a specialist assistant for category "${category}".
Use this memory context when relevant:
${memoryBlock || "(none)"}

User task:
${task}`,
            });
            return answer.text || "";
          } catch (e) {
            if (isModelNotAvailableError(e)) {
              markModelUnavailable(picked);
            }
            logger.warn({ err: e, category, picked }, "delegate_to_category failed");
            return `Specialist execution failed for ${category}.`;
          }
        },
      }),
    };

    const systemParts = [
      "You are Helper, a capable assistant. Be concise and accurate. Use tools when they clearly help.",
      "When task needs deeper coding/system work, strong reasoning, or multimodal processing, call delegate_to_category.",
      "When user asks to create/generate an image, call generate_image and include returned markdown image in your final answer.",
      "Never invent image URLs or markdown links. If an image URL is needed, it must come only from tool output.",
    ];
    if (likelyImageRequest) {
      systemParts.push(
        "Current user message is an image-generation request. Do not say that you cannot generate images. Call generate_image immediately."
      );
    }
    if (precomposedImageReply) {
      systemParts.push(
        `Image has already been generated server-side using model "${precomposedImageModel}". ` +
          "Return exactly the following markdown and nothing else:\n" +
          precomposedImageReply
      );
    }
    if (memoryBlock) systemParts.push(memoryBlock);
    const system = systemParts.join("\n\n");

    const core = convertToCoreMessages(uiMessages);

    const result = streamText({
      model: togetherLlm(selectedModel),
      system,
      messages: core,
      maxSteps: config.maxToolRounds,
      tools: { ...mcpTools, ...delegateTool, ...imageTools },
      toolChoice: likelyImageRequest || likelyImageEditRequest ? { type: "tool", toolName: "generate_image" } : "auto",
      onFinish: async ({ text, usage }) => {
        const usageSafe = usage as
          | {
              promptTokens?: number;
              completionTokens?: number;
              totalTokens?: number;
            }
          | undefined;
        let memoryWriteLastOk: boolean | null = null;
        if (mem0UserId && lastUserText && text) {
          try {
            memoryWriteLastOk = await addConversationToMemory(mem0UserId, lastUserText, text);
          } catch (e) {
            memoryWriteLastOk = false;
            logger.warn({ err: e, mem0UserId }, "mem0 addConversation failed");
          }
        }
        finalizeUsageSnapshot({
          promptTokens:
            typeof usageSafe?.promptTokens === "number" ? usageSafe.promptTokens : null,
          completionTokens:
            typeof usageSafe?.completionTokens === "number" ? usageSafe.completionTokens : null,
          totalTokens:
            typeof usageSafe?.totalTokens === "number" ? usageSafe.totalTokens : null,
          memoryWriteLastOk,
        });
      },
    });

    result.pipeDataStreamToResponse(res);
  } catch (e) {
    logger.error({ err: e, route: "POST /api/chat" }, "chat handler failed");
    if (!res.headersSent) {
      res.status(500).json({ error: String(e) });
    }
  }
});

const ChatUsageQuery = z.object({
  profileId: z.string().optional(),
});

app.get("/api/chat/usage", (req, res) => {
  const parsed = ChatUsageQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json(parsed.error.flatten());
    return;
  }
  // This endpoint is profile-sensitive and should never be served from cache,
  // otherwise UI can show usage from a different profile (304 replay).
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  const key = parsed.data.profileId || "__default__";
  const usage = usageByProfile.get(key) ?? null;
  res.json({ usage });
});

app.get("/api/profiles", async (_req, res) => {
  try {
    const profiles = await listProfiles();
    res.json({ profiles });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const ProfileCreate = z.object({ name: z.string() });
app.post("/api/profiles", async (req, res) => {
  const p = ProfileCreate.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const profile = await createProfile(p.data.name);
  res.json(profile);
});

const ProfilePatch = z.object({ name: z.string() });
app.patch("/api/profiles/:id", async (req, res) => {
  const p = ProfilePatch.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const updated = await updateProfile(req.params.id!, { name: p.data.name });
  if (!updated) return res404(res);
  res.json(updated);
});

const ProfileModelPrefsPatch = z.object({
  modelPreferences: z.object({
    categories: z.record(z.object({ order: z.array(z.string()) })).default({}),
    updatedAt: z.string().optional(),
  }),
});
app.patch("/api/profiles/:id/model-preferences", async (req, res) => {
  const p = ProfileModelPrefsPatch.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const updated = await updateProfile(req.params.id!, {
    modelPreferences: {
      ...p.data.modelPreferences,
      updatedAt: p.data.modelPreferences.updatedAt ?? new Date().toISOString(),
    },
  });
  if (!updated) return res404(res);
  res.json(updated);
});

const ProfileMemoryPolicyPatch = z.object({
  topK: z.number().int().min(1).max(30).optional(),
  maxChars: z.number().int().min(200).max(12000).optional(),
  pinnedOnlyForSimple: z.boolean().optional(),
});
app.patch("/api/profiles/:id/memory-policy", async (req, res) => {
  const p = ProfileMemoryPolicyPatch.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const updated = await updateProfile(req.params.id!, { memoryPolicy: p.data });
  if (!updated) return res404(res);
  res.json(updated);
});

app.get("/api/profiles/:id/memory-pins", async (req, res) => {
  const profile = await getProfileById(req.params.id!);
  if (!profile) return res404(res);
  res.json({ memoryPins: profile.memoryPins ?? [] });
});

const ProfileMemoryPinsPatch = z.object({ memoryPins: z.array(z.string()) });
app.patch("/api/profiles/:id/memory-pins", async (req, res) => {
  const p = ProfileMemoryPinsPatch.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const updated = await updateProfile(req.params.id!, { memoryPins: p.data.memoryPins });
  if (!updated) return res404(res);
  res.json(updated);
});

app.delete("/api/profiles/:id", async (req, res) => {
  const ok = await deleteProfile(req.params.id!);
  if (!ok) return res404(res);
  res.json({ ok: true });
});

function res404(res: express.Response) {
  res.status(404).json({ error: "Not found" });
}

const MemoryQuery = z.object({
  userId: z.string(),
  q: z.string().optional(),
});

app.get("/api/memory", async (req, res) => {
  const p = MemoryQuery.safeParse(req.query);
  if (!p.success) return res.status(400).json(p.error.flatten());
  if (!isMemoryAvailable()) {
    return res.json({ results: [], unavailable: true });
  }
  try {
    if (p.data.q) {
      const results = await searchMemoryForUser(p.data.q, p.data.userId, 50);
      return res.json({ results });
    }
    const list = await memoryGetAll(p.data.userId, 120);
    const results = list.map((r) => ({
      id: r.id,
      memory: r.text,
      metadata: { createdAt: r.createdAt, updatedAt: r.updatedAt },
    }));
    return res.json({ results });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const MemoryUpdate = z.object({ text: z.string() });
app.patch("/api/memory/:id", async (req, res) => {
  const p = MemoryUpdate.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  if (!isMemoryAvailable()) return res.status(503).json({ error: "Memory unavailable" });
  try {
    await memoryUpdate(req.params.id!, p.data.text);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.delete("/api/memory/:id", async (req, res) => {
  if (!isMemoryAvailable()) return res.status(503).json({ error: "Memory unavailable" });
  try {
    await memoryDelete(req.params.id!);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const McpUpsert = z.object({
  id: z.string().optional(),
  name: z.string(),
  enabled: z.boolean(),
  transport: z.enum(["http", "stdio"]),
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
});

app.get("/api/mcp/servers", async (_req, res) => {
  try {
    const servers = await listMcpServers();
    res.json({ servers });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/mcp/servers", async (req, res) => {
  const p = McpUpsert.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const row = await upsertMcpServer(p.data as Omit<McpServerRecord, "id"> & { id?: string });
  res.json(row);
});

app.delete("/api/mcp/servers/:id", async (req, res) => {
  const id = req.params.id!;
  const ok = await deleteMcpServer(id);
  await disconnectMcp(id);
  if (!ok) return res404(res);
  res.json({ ok: true });
});

app.post("/api/mcp/servers/:id/test", async (req, res) => {
  const servers = await listMcpServers();
  const s = servers.find((x) => x.id === req.params.id);
  if (!s) return res404(res);
  try {
    const r = await testMcpServer(s);
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

const webDist = path.resolve(__dirname, "../../web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(webDist, "index.html"), (err) => {
      if (err) next();
    });
  });
}

async function bootstrapRuntime() {
  if (!config.togetherApiKey) return;
  try {
    const catalog = await refreshModelCatalog();
    logger.info(
      {
        models: catalog.models.length,
        chatModels: catalog.chatModels.length,
        baseModel: config.togetherBaseModel,
      },
      "model catalog refreshed at startup"
    );
  } catch (e) {
    logger.warn({ err: e }, "model catalog startup refresh failed");
  }
}

void bootstrapRuntime();

const httpServer = app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      webOrigin: config.webOrigin,
      logFile: config.logFile || null,
      logPretty: config.logPretty,
      voice: {
        browserAudioOnly: true,
      },
    },
    "HTTP server listening"
  );
});

let shuttingDown = false;
async function shutdown(reason: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ reason }, "shutdown started");
  const forceTimer = setTimeout(() => {
    logger.error({ reason }, "forced shutdown timeout");
    process.exit(1);
  }, 8000);
  forceTimer.unref?.();
  try {
    // Stop accepting new connections first.
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
      // Ensure keep-alive sockets don't block shutdown indefinitely.
      (httpServer as any).closeIdleConnections?.();
      (httpServer as any).closeAllConnections?.();
    });
    await disconnectAllMcp();
    logger.info({ reason }, "shutdown completed");
    clearTimeout(forceTimer);
    process.exit(exitCode);
  } catch (e) {
    logger.error({ err: e, reason }, "shutdown failed");
    clearTimeout(forceTimer);
    process.exit(1);
  }
}

httpServer.on("error", (err) => {
  logger.fatal({ err }, "HTTP server failed to bind or accept");
  process.exit(1);
});

process.on("SIGINT", () => void shutdown("SIGINT", 0));
process.on("SIGTERM", () => void shutdown("SIGTERM", 0));
process.on("SIGHUP", () => void shutdown("SIGHUP", 0));

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception");
  void shutdown("uncaughtException", 1);
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "unhandled rejection");
  void shutdown("unhandledRejection", 1);
});
