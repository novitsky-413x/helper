import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
    streamText,
    generateText,
    convertToCoreMessages,
    tool,
    pipeDataStreamToResponse,
    formatDataStreamPart,
    type Message,
    type ToolSet,
} from 'ai';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { listChatModelsCached } from '../togetherModels.js';
import {
    getModelCatalog,
    resolveCategoryOrder,
    inferSimpleRequest,
    type TaskCategory,
} from '../modelCatalog.js';
import {
    buildMemoryContext,
    addConversationToMemory,
    memoryGetAll,
    memoryUpdate,
    memoryDelete,
    getMemoryInstance,
} from '../mem0Service.js';
import { getProfileById, listMcpServers } from '../store.js';
import { buildMcpToolSet } from '../mcpRuntime.js';
import {
    isLikelyImageGenerationRequest,
    isLikelyImageEditGenerationRequest,
    isLikelyPriorImageFollowupEditRequest,
    isLikelyAudioRequest,
    lastAssistantImageUrlFromMessages,
    lastUserMessageSummary,
    lastUserTextFromMessages,
} from '../messageUtils.js';
import {
    togetherLlm,
    usageByProfile,
    isModelNotAvailableError,
    estimateTokensFromText,
    inferModalityRoute,
    createUsageSnapshotFinalizer,
} from '../pipeline/chatHelpers.js';
import {
    getHealthMap,
    checkModelsHealth,
    isHealthCheckRunning,
    runStartupHealthCheck,
    pickFirstHealthyModel,
    isModelHealthy,
    markModelUnhealthy,
} from '../modelHealth.js';
import { buildImageEditPromptFromContext, generateImageMarkdown } from '../pipeline/imageRoute.js';
import { generateAudio, getAudioFile } from '../pipeline/audioRoute.js';
import { generateVisionReply } from '../pipeline/visionRoute.js';
import { buildAgentSystemPrompt, detectUserLanguage } from '../pipeline/agentPrompt.js';
import { getToolMap, buildAIToolSet } from '../tools/index.js';
import type { ToolContext } from '../tools/buildTool.js';
import { getIO } from '../socketServer.js';
import {
    trimToContextBudget,
    estimateTotalTokens,
    getModelContextWindow,
    findLargerContextModel,
} from '../pipeline/contextManager.js';
import { runAgentLoop } from '../agentLoop.js';
import { sanitizeCoreMessages } from '../pipeline/sanitize.js';

const router = Router();

const ChatBody = z.object({
    messages: z.array(z.unknown()),
    model: z.string().optional(),
    profileId: z.string().optional(),
    agentMode: z.boolean().optional(),
});

router.get('/models', async (_req, res) => {
    try {
        if (!config.togetherApiKey) {
            res.status(503).json({ error: 'TOGETHER_API_KEY not configured' });
            return;
        }
        const models = await listChatModelsCached();
        res.json({ models });
    } catch (e) {
        logger.error({ err: e }, 'GET /api/models failed');
        res.status(500).json({ error: String(e) });
    }
});

router.get('/model-catalog', async (_req, res) => {
    try {
        if (!config.togetherApiKey) {
            res.status(503).json({ error: 'TOGETHER_API_KEY not configured' });
            return;
        }
        const catalog = await getModelCatalog();
        const healthByModel = getHealthMap();
        if (!isHealthCheckRunning() && Object.keys(healthByModel).length === 0) {
            void runStartupHealthCheck(catalog.defaults);
        }
        res.json({ catalog: { ...catalog, healthByModel } });
    } catch (e) {
        logger.error({ err: e }, 'GET /api/model-catalog failed');
        res.status(500).json({ error: String(e) });
    }
});

router.get('/models/health', async (_req, res) => {
    const health = getHealthMap();
    const checking = isHealthCheckRunning();
    if (!checking && Object.keys(health).length === 0) {
        try {
            const catalog = await getModelCatalog();
            void runStartupHealthCheck(catalog.defaults);
        } catch {
            /* ignore */
        }
    }
    res.json({ health, checking: checking || isHealthCheckRunning() });
});

const HealthCheckBody = z.object({
    modelIds: z.array(z.string()).min(1).max(20),
});

router.post('/models/health/check', async (req, res) => {
    const parsed = HealthCheckBody.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
    }
    try {
        const results = await checkModelsHealth(parsed.data.modelIds, 4);
        res.json({ health: results });
    } catch (e) {
        logger.error({ err: e }, 'POST /api/models/health/check failed');
        res.status(500).json({ error: String(e) });
    }
});

router.get('/audio/file/:id', (req, res) => {
    const file = getAudioFile(req.params.id);
    if (!file) {
        res.status(404).json({ error: 'Audio not found or expired' });
        return;
    }
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Length', file.buffer.length);
    res.setHeader('Content-Disposition', `inline; filename="audio-${req.params.id.slice(0, 8)}.mp3"`);
    res.setHeader('Cache-Control', 'private, max-age=1800');
    res.send(file.buffer);
});

const ChatUsageQuery = z.object({
    profileId: z.string().optional(),
});

router.get('/chat/usage', (req, res) => {
    const parsed = ChatUsageQuery.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json(parsed.error.flatten());
        return;
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    const key = parsed.data.profileId || '__default__';
    const usage = usageByProfile.get(key) ?? null;
    res.json({ usage });
});

router.post('/chat', async (req, res) => {
    const parsed = ChatBody.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json(parsed.error.flatten());
        return;
    }
    if (!config.togetherApiKey) {
        res.status(503).json({ error: 'TOGETHER_API_KEY not configured' });
        return;
    }

    const { messages, model: requestedModel, profileId, agentMode } = parsed.data;
    const uiMessages = messages as Message[];

    // --- Slash command interception ---
    const lastUserMsg = uiMessages.filter(m => m.role === 'user').at(-1);
    const lastUserRaw = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
    if (lastUserRaw.trim().startsWith('/')) {
        const { parseSlashCommand, handleSlashCommand } = await import('../services/slashCommands.js');
        const cmd = parseSlashCommand(lastUserRaw);
        if (cmd) {
            const result = await handleSlashCommand(cmd.command, cmd.args, profileId ?? undefined);
            if (result.handled) {
                pipeDataStreamToResponse(res, {
                    execute: async (dataStream) => {
                        dataStream.write(formatDataStreamPart('text', result.response ?? 'Command executed.'));
                    },
                });
                return;
            }
        }
    }

    const autoRequested = !requestedModel || requestedModel === 'auto';

    const lastUserText = lastUserTextFromMessages(
        uiMessages as { role: string; content?: string; parts?: { type: string; text?: string }[] }[]
    );
    const lastUserSummary = lastUserMessageSummary(
        uiMessages as { role: string; content?: unknown; parts?: Record<string, unknown>[] }[]
    );
    const likelyImageRequest = isLikelyImageGenerationRequest(lastUserText);
    const likelyAudioRequest = isLikelyAudioRequest(lastUserText);
    const priorAssistantImageUrl = lastAssistantImageUrlFromMessages(
        uiMessages as { role: string; content?: unknown; parts?: Array<Record<string, unknown>> }[]
    );
    const likelyImageEditRequest = isLikelyImageEditGenerationRequest(lastUserText);
    const likelyPriorImageFollowupEdit =
        !!priorAssistantImageUrl && isLikelyPriorImageFollowupEditRequest(lastUserText);
    const userAttachedImages = lastUserSummary.imagePartCount > 0;
    const hasImageContext = userAttachedImages || !!priorAssistantImageUrl;
    const modalityRoute = inferModalityRoute({
        lastUserText,
        imageInputCount: userAttachedImages ? lastUserSummary.imagePartCount : 0,
        likelyImageRequest,
        likelyImageEditRequest: (likelyImageEditRequest && hasImageContext) || likelyPriorImageFollowupEdit,
    });

    try {
        const catalog = await getModelCatalog();
        const profile = profileId ? await getProfileById(profileId) : null;
        const primaryCandidates = resolveCategoryOrder('primary', profile?.modelPreferences, catalog);
        const selectedModel = autoRequested
            ? pickFirstHealthyModel([config.togetherBaseModel, ...primaryCandidates]) ??
              config.togetherBaseModel
            : requestedModel!;
        let delegatedCategory: TaskCategory | undefined;
        const usageKey = profileId ?? '__default__';
        const modelPrice = catalog.models.find((m) => m.id === selectedModel)?.pricing;

        const finalizeUsageSnapshot = createUsageSnapshotFinalizer({
            usageKey,
            profileId: profileId ?? null,
            selectedModel,
            modelPriceInput: modelPrice?.input ?? null,
            modelPriceOutput: modelPrice?.output ?? null,
            uiMessageCount: uiMessages.length,
            lastUserTextLength: lastUserText.length,
            memoryHits: 0,
            memoryBlockLength: 0,
            getDelegatedCategory: () => delegatedCategory,
        });

        logger.info(
            {
                route: 'POST /api/chat',
                resolvedModel: selectedModel,
                modalityRoute,
                routedCandidates: primaryCandidates.slice(0, 5),
                profileId: profileId ?? null,
                lastUserChars: lastUserText.length,
                imageInputs: lastUserSummary.imagePartCount,
                priorAssistantImage: !!priorAssistantImageUrl,
                likelyImageRequest,
                likelyAudioRequest,
                likelyImageEditRequest,
                likelyPriorImageFollowupEdit,
                messageCount: uiMessages.length,
            },
            'chat request'
        );
        res.setHeader('x-helper-resolved-model', selectedModel);
        res.setHeader('x-helper-base-model', config.togetherBaseModel);

        const mem0UserId = profile?.mem0UserId;

        let memoryBlock = '';
        let memoryHits = 0;
        if (mem0UserId) {
            // Image requests must never be treated as "simple" — we need full memory
            // search to find prohibitions/rules that might block generation.
            const isSimple = likelyImageRequest ? false : inferSimpleRequest(lastUserText || '');
            const memCtx = await buildMemoryContext({
                query: lastUserText || 'hello',
                userId: mem0UserId,
                pinned: profile?.memoryPins ?? [],
                policy: profile?.memoryPolicy,
                isSimpleRequest: isSimple,
            });
            memoryBlock = memCtx.block;
            memoryHits = memCtx.hits;
        }

        // Update the finalizer with actual memory data
        const finalizeUsage = createUsageSnapshotFinalizer({
            usageKey,
            profileId: profileId ?? null,
            selectedModel,
            modelPriceInput: modelPrice?.input ?? null,
            modelPriceOutput: modelPrice?.output ?? null,
            uiMessageCount: uiMessages.length,
            lastUserTextLength: lastUserText.length,
            memoryHits,
            memoryBlockLength: memoryBlock.length,
            getDelegatedCategory: () => delegatedCategory,
        });

        const mcpRows = await listMcpServers();
        const mcpTools = await buildMcpToolSet(mcpRows);

        // --- IMAGE GENERATION ROUTE ---
        // When the user has memory enabled, skip the fast-path so the LLM
        // (upgraded to a memory-capable model below) can respect stored preferences.
        if (modalityRoute === 'image_gen' && mem0UserId) {
            logger.info(
                { route: 'POST /api/chat', modalityRoute, memoryChars: memoryBlock.length },
                'image fast-path skipped: user has memory profile, deferring to memory-capable LLM'
            );
        }
        if (modalityRoute === 'image_gen' && !mem0UserId) {
            const imageCandidates = resolveCategoryOrder('image_gen', profile?.modelPreferences, catalog);
            const visionCandidates = resolveCategoryOrder('vision', profile?.modelPreferences, catalog);
            let imagePrompt = lastUserText || 'A high quality image';
            let precomposedImagePromptModel: string | null = null;

            if (
                (likelyImageEditRequest || likelyPriorImageFollowupEdit) &&
                lastUserSummary.imagePartCount > 0
            ) {
                const synthesized = await buildImageEditPromptFromContext({
                    uiMessages: uiMessages as Array<{
                        role: string;
                        content?: unknown;
                        parts?: Array<Record<string, unknown>>;
                    }>,
                    userInstruction: lastUserText,
                    candidateModels: visionCandidates,
                });
                if (synthesized?.prompt) {
                    imagePrompt = synthesized.prompt;
                    precomposedImagePromptModel = synthesized.usedModel;
                } else if (lastUserSummary.imageUrls[0]) {
                    imagePrompt =
                        `${lastUserText || 'Create a variation of the attached image'}. ` +
                        `Use this source image as visual reference: ${lastUserSummary.imageUrls[0]}`;
                }
            } else if ((likelyImageEditRequest || likelyPriorImageFollowupEdit) && priorAssistantImageUrl) {
                imagePrompt =
                    `${lastUserText || 'Create an edited version of the previous image'}. ` +
                    `Use this source image as visual reference: ${priorAssistantImageUrl}`;
            }

            logger.info(
                {
                    route: 'POST /api/chat',
                    imageIntent: true,
                    imageEditIntent: likelyImageEditRequest,
                    promptChars: imagePrompt.length,
                    imageInputs: lastUserSummary.imagePartCount,
                    promptSynthModel: precomposedImagePromptModel,
                    candidates: imageCandidates.slice(0, 8),
                },
                'image fast-path start'
            );

            const generated = await generateImageMarkdown({
                prompt: imagePrompt,
                candidateModels: imageCandidates,
            });
            const fallbackText =
                'I could not generate the image right now due to a temporary provider issue. Please try again in a moment with the same prompt.';
            const finalImageReply = generated?.markdown ?? fallbackText;
            const imageResolvedModel = generated?.usedModel ?? selectedModel;

            if (generated) {
                logger.info(
                    { route: 'POST /api/chat', imageIntent: true, usedModel: generated.usedModel },
                    'image fast-path generated'
                );
            } else {
                logger.warn(
                    { route: 'POST /api/chat', imageIntent: true, promptPreview: lastUserText.slice(0, 160) },
                    'image fast-path failed for all candidates'
                );
            }

            res.setHeader('x-helper-resolved-model', imageResolvedModel);
            pipeDataStreamToResponse(res, {
                execute: async (dataStream) => {
                    dataStream.write(formatDataStreamPart('text', finalImageReply));
                    delegatedCategory = 'image_gen';
                    const generatedModelPrice = generated?.usedModel
                        ? catalog.models.find((m) => m.id === generated.usedModel)?.pricing
                        : null;
                    let memoryWriteLastOk: boolean | null = null;
                    if (mem0UserId && lastUserText && finalImageReply) {
                        try {
                            memoryWriteLastOk = await addConversationToMemory(
                                mem0UserId,
                                lastUserText,
                                finalImageReply
                            );
                        } catch (e) {
                            memoryWriteLastOk = false;
                            logger.warn({ err: e, mem0UserId }, 'mem0 addConversation failed');
                        }
                    }
                    finalizeUsage({
                        resolvedModel: imageResolvedModel,
                        modelInputPer1M: generatedModelPrice?.input ?? null,
                        modelOutputPer1M: generatedModelPrice?.output ?? null,
                        promptTokens: estimateTokensFromText(lastUserText),
                        completionTokens: estimateTokensFromText(finalImageReply),
                        totalTokens:
                            estimateTokensFromText(lastUserText) + estimateTokensFromText(finalImageReply),
                        memoryWriteLastOk,
                    });
                },
            });
            return;
        }

        // --- VISION ROUTE ---
        if (modalityRoute === 'vision_understand') {
            const visionCandidates = resolveCategoryOrder('vision', profile?.modelPreferences, catalog);
            logger.info(
                {
                    route: 'POST /api/chat',
                    modalityRoute,
                    imageInputs: lastUserSummary.imagePartCount,
                    candidates: visionCandidates.slice(0, 8),
                },
                'vision route start'
            );

            const vision = await generateVisionReply({
                uiMessages: uiMessages as Array<{
                    role: string;
                    content?: unknown;
                    parts?: Array<Record<string, unknown>>;
                }>,
                candidateModels: visionCandidates,
            });

            if (vision) {
                logger.info(
                    { route: 'POST /api/chat', modalityRoute, usedModel: vision.usedModel },
                    'vision route generated'
                );
                const finalVisionReply = vision.text;
                const visionResolvedModel = vision.usedModel;
                res.setHeader('x-helper-resolved-model', visionResolvedModel);
                pipeDataStreamToResponse(res, {
                    execute: async (dataStream) => {
                        dataStream.write(formatDataStreamPart('text', finalVisionReply));
                        delegatedCategory = 'vision';
                        const visionModelPrice = catalog.models.find(
                            (m) => m.id === vision.usedModel
                        )?.pricing;
                        let memoryWriteLastOk: boolean | null = null;
                        if (mem0UserId && lastUserText && finalVisionReply) {
                            try {
                                memoryWriteLastOk = await addConversationToMemory(
                                    mem0UserId,
                                    lastUserText,
                                    finalVisionReply
                                );
                            } catch (e) {
                                memoryWriteLastOk = false;
                                logger.warn({ err: e, mem0UserId }, 'mem0 addConversation failed');
                            }
                        }
                        finalizeUsage({
                            resolvedModel: visionResolvedModel,
                            modelInputPer1M: visionModelPrice?.input ?? null,
                            modelOutputPer1M: visionModelPrice?.output ?? null,
                            promptTokens: estimateTokensFromText(lastUserText),
                            completionTokens: estimateTokensFromText(finalVisionReply),
                            totalTokens:
                                estimateTokensFromText(lastUserText) +
                                estimateTokensFromText(finalVisionReply),
                            memoryWriteLastOk,
                        });
                    },
                });
                return;
            }

            logger.warn(
                { route: 'POST /api/chat', modalityRoute, imageInputs: lastUserSummary.imagePartCount },
                'vision route failed for all candidates, falling through to text_chat'
            );
        }

        // --- TEXT CHAT ROUTE ---
        const imageTools: ToolSet = {
            generate_image: tool({
                description: 'Generate an image for the user request and return a markdown image link.',
                parameters: z.object({
                    prompt: z.string().min(4),
                    width: z.number().int().min(256).max(2048).optional(),
                    height: z.number().int().min(256).max(2048).optional(),
                    model: z.string().optional(),
                }),
                execute: async ({ prompt, model }) => {
                    const ordered = resolveCategoryOrder('image_gen', profile?.modelPreferences, catalog);
                    logger.info(
                        { promptLen: prompt.length, model, candidates: ordered.length },
                        'generate_image tool called',
                    );
                    const generated = await generateImageMarkdown({
                        prompt,
                        preferredModel: model,
                        candidateModels: ordered,
                    });
                    if (generated) {
                        const url = generated.markdown.match(/\(([^)]+)\)/)?.[1] ?? '';
                        logger.info({ usedModel: generated.usedModel, url }, 'generate_image succeeded');
                        return `[img:${url}] Image generated and displayed to the user.`;
                    }
                    logger.warn({ candidates: ordered }, 'generate_image returned null — all candidates failed');
                    return 'Image generation failed — no image models available. Please try again later.';
                },
            }),
        };

        const audioTools: ToolSet = {
            generate_audio: tool({
                description:
                    'Text-to-Speech (TTS): converts written text into spoken audio. ' +
                    'This tool can ONLY synthesize speech from text. It CANNOT generate music, sound effects, or instrumental tracks. ' +
                    'Pass the exact text to be spoken aloud.',
                parameters: z.object({
                    text: z.string().min(1).describe('The exact text to be spoken aloud by the TTS engine'),
                    voice: z.string().optional().describe('Voice name (e.g. af_heart, tara, af_alloy)'),
                    model: z.string().optional().describe('TTS model override'),
                    language: z.string().optional().describe('Language code (en, ru, fr, etc.)'),
                }),
                execute: async ({ text, voice, model, language }) => {
                    const ordered = resolveCategoryOrder('audio', profile?.modelPreferences, catalog);
                    logger.info(
                        { textLen: text.length, voice, model, language, candidates: ordered.length },
                        'generate_audio tool called',
                    );
                    const result = await generateAudio({
                        text,
                        voice,
                        preferredModel: model,
                        language,
                        candidateModels: ordered,
                    });
                    if (result) {
                        logger.info({ url: result.url, usedModel: result.usedModel }, 'generate_audio succeeded');
                        return `[audio:${result.url}] Speech audio generated and player displayed to user.`;
                    }
                    logger.warn({ candidates: ordered }, 'generate_audio returned null — all candidates failed');
                    return 'Audio generation failed — no TTS models available. Please try again later.';
                },
            }),
        };

        let memoryToolDidWrite = false;

        const memoryTools: ToolSet = mem0UserId
            ? {
                  manage_memory: tool({
                      description:
                          'Manage the user\'s long-term memory — add, update, delete, or list memory entries. Use this when the user asks to remember, forget, or change rules/preferences/facts.',
                      parameters: z.object({
                          action: z
                              .enum(['list', 'add', 'update', 'delete'])
                              .describe('The memory operation to perform'),
                          text: z
                              .string()
                              .optional()
                              .describe('Text for add/update operations'),
                          memoryId: z
                              .string()
                              .optional()
                              .describe('Memory entry ID for update/delete operations'),
                      }),
                      execute: async ({ action, text, memoryId }) => {
                          try {
                              if (action === 'list') {
                                  const all = await memoryGetAll(mem0UserId!, 50);
                                  if (all.length === 0) return 'No memories stored yet.';
                                  return JSON.stringify(
                                      all.map((m) => ({ id: m.id, text: m.text })),
                                  );
                              }
                              if (action === 'add') {
                                  if (!text) return 'Error: text is required for add.';
                                  const m = await getMemoryInstance();
                                  if (!m) return 'Memory system unavailable.';
                                  await m.add([{ role: 'user', content: text }], {
                                      userId: mem0UserId!,
                                      infer: false,
                                  });
                                  memoryToolDidWrite = true;
                                  return `Memory added: "${text}"`;
                              }
                              if (action === 'update') {
                                  if (!memoryId || !text)
                                      return 'Error: memoryId and text are required for update.';
                                  await memoryUpdate(memoryId, text);
                                  memoryToolDidWrite = true;
                                  return `Memory ${memoryId} updated to: "${text}"`;
                              }
                              if (action === 'delete') {
                                  if (!memoryId)
                                      return 'Error: memoryId is required for delete.';
                                  await memoryDelete(memoryId);
                                  memoryToolDidWrite = true;
                                  return `Memory ${memoryId} deleted.`;
                              }
                              return 'Unknown action.';
                          } catch (e) {
                              logger.warn({ err: e, action, memoryId }, 'manage_memory tool error');
                              return `Memory operation failed: ${String(e)}`;
                          }
                      },
                  }),
              }
            : {};

        const delegateTool: ToolSet = {
            delegate_to_category: tool({
                description:
                    'Delegate a sub-task to a specialist model category (code_mcp, reasoning, vision, image_gen, audio, memory).',
                parameters: z.object({
                    category: z.enum([
                        'primary',
                        'code_mcp',
                        'reasoning',
                        'vision',
                        'image_gen',
                        'audio',
                        'memory',
                    ]),
                    task: z.string().min(1),
                }),
                execute: async ({ category, task }) => {
                    delegatedCategory = category;
                    const ordered = resolveCategoryOrder(category, profile?.modelPreferences, catalog);
                    const picked = pickFirstHealthyModel(ordered) ?? selectedModel;
                    try {
                        const recentMessages = uiMessages.slice(-6);
                        const conversationContext = recentMessages
                            .map((m) => {
                                const text = typeof m.content === 'string' ? m.content : '';
                                return `${m.role}: ${text.slice(0, 300)}`;
                            })
                            .join('\n');

                        const answer = await generateText({
                            model: togetherLlm(picked),
                            temperature: 0.1,
                            maxTokens: 2000,
                            prompt: `You are a specialist assistant for category "${category}".

Conversation context:
${conversationContext}

Memory context:
${memoryBlock || '(none)'}

User task:
${task}`,
                        });
                        return answer.text || '';
                    } catch (e) {
                        if (isModelNotAvailableError(e)) {
                            markModelUnhealthy(picked, String((e as { message?: string })?.message ?? e));
                        }
                        logger.warn({ err: e, category, picked }, 'delegate_to_category failed');

                        const fallbackModel =
                            pickFirstHealthyModel(
                                resolveCategoryOrder('primary', profile?.modelPreferences, catalog)
                            ) ?? config.togetherBaseModel;
                        if (fallbackModel !== picked) {
                            try {
                                const fallbackAnswer = await generateText({
                                    model: togetherLlm(fallbackModel),
                                    temperature: 0.1,
                                    maxTokens: 2000,
                                    prompt: `You are a helpful assistant. Answer this task:\n${task}`,
                                });
                                return fallbackAnswer.text || '';
                            } catch (e2) {
                                logger.warn(
                                    { err: e2, category, fallbackModel },
                                    'delegate_to_category fallback also failed'
                                );
                            }
                        }
                        return `Specialist execution failed for ${category}.`;
                    }
                },
            }),
        };

        const system = buildAgentSystemPrompt({
            memoryBlock,
            mcpToolNames: Object.keys(mcpTools),
            likelyImageRequest,
            likelyAudioRequest,
            hasPriorAssistantImage: !!priorAssistantImageUrl,
            date: new Date(),
            userLanguage: detectUserLanguage(lastUserText),
            profile: profile ?? null,
        });

        // Filter out assistant messages with incomplete tool invocations (state: "call" without result).
        // These appear when a previous request crashed mid-tool-call (e.g. InvalidToolArgumentsError).
        const cleanedUiMessages = uiMessages.filter((msg) => {
            if (msg.role !== 'assistant') return true;
            const invocations = (msg as unknown as { toolInvocations?: Array<{ state?: string }> }).toolInvocations;
            if (!invocations || invocations.length === 0) return true;
            const hasIncomplete = invocations.some((t) => t.state === 'call' || t.state === 'partial-call');
            if (hasIncomplete) {
                logger.warn({ toolInvocations: invocations.length }, 'filtering out assistant message with incomplete tool invocations');
                return false;
            }
            return true;
        });

        const rawCore = sanitizeCoreMessages(convertToCoreMessages(cleanedUiMessages));
        let effectiveModel = selectedModel;

        // When the user has a memory profile, ALWAYS upgrade to a capable model.
        // The base model (e.g. gemma-3n 4B) is too small to reliably follow
        // tool-use instructions, memory rules, and language preferences.
        // Fallback chain: config model → reasoning candidates → primary candidates.
        if (mem0UserId && effectiveModel === config.togetherBaseModel) {
            const memoryCandidates = [
                config.togetherMemoryModel,
                ...resolveCategoryOrder('reasoning', profile?.modelPreferences, catalog),
                ...primaryCandidates,
            ].filter((id) => id && id !== config.togetherBaseModel);
            const upgraded = pickFirstHealthyModel(memoryCandidates);
            if (upgraded) {
                logger.info(
                    { from: effectiveModel, to: upgraded, memoryChars: memoryBlock.length },
                    'upgrading to memory-capable model'
                );
                effectiveModel = upgraded;
                res.setHeader('x-helper-resolved-model', effectiveModel);
            }
        }

        let contextWindow = getModelContextWindow(effectiveModel, catalog.models);
        const systemTokenEstimate = Math.ceil(system.length / 3.5);

        const budgetResult = await trimToContextBudget({
            messages: rawCore,
            systemTokens: systemTokenEstimate,
            contextWindow,
        });

        // If >20 % of messages were dropped, try to escalate to a larger-context model
        if (budgetResult.dropRatio > 0.2) {
            const bigger = findLargerContextModel(
                effectiveModel,
                contextWindow,
                catalog.models,
                (id) => isModelHealthy(id)
            );
            if (bigger) {
                effectiveModel = bigger;
                contextWindow = getModelContextWindow(bigger, catalog.models);
                res.setHeader('x-helper-resolved-model', effectiveModel);
                // Re-trim with the larger window — may recover dropped messages
                const reBudget = await trimToContextBudget({
                    messages: rawCore,
                    systemTokens: systemTokenEstimate,
                    contextWindow,
                });
                logger.info(
                    {
                        escalatedTo: effectiveModel,
                        newCtx: contextWindow,
                        dropBefore: (budgetResult.dropRatio * 100).toFixed(0) + '%',
                        dropAfter: (reBudget.dropRatio * 100).toFixed(0) + '%',
                    },
                    'context overflow: escalated model'
                );
                budgetResult.messages = reBudget.messages;
                budgetResult.dropRatio = reBudget.dropRatio;
            }
        }
        const core = budgetResult.messages;

        // Build agent tool set (bash, file, web search, learning, wiki, todo)
        const toolContext: ToolContext = {
            profileId: mem0UserId ?? profileId ?? undefined,
            agentSessionId: undefined,
            emitProgress: () => {},
            io: getIO(),
            workingDirectory: config.agentWorkspace,
        };
        const builtToolMap = getToolMap();
        // Remove tools that are already defined inline (manage_memory, delegate_to_category)
        builtToolMap.delete('manage_memory');
        builtToolMap.delete('delegate_to_category');
        const agentTools = buildAIToolSet(builtToolMap, toolContext);

        // --- Agent Loop opt-in ---
        if (agentMode) {
            const agentSessionId = randomUUID();
            pipeDataStreamToResponse(res, {
                execute: async (dataStream) => {
                    const loopResult = await runAgentLoop({
                        sessionId: agentSessionId,
                        profileId: mem0UserId ?? profileId ?? undefined,
                        mem0UserId: mem0UserId ?? undefined,
                        model: effectiveModel,
                        system,
                        messages: cleanedUiMessages as Message[],
                        mcpServers: mcpRows,
                        catalogModels: catalog.models,
                        maxTurns: config.maxToolRounds ?? 16,
                        onText: (chunk) => {
                            dataStream.write(formatDataStreamPart('text', chunk));
                        },
                    });
                    if (loopResult.status === 'error' && !loopResult.text) {
                        dataStream.write(
                            formatDataStreamPart(
                                'text',
                                '\n\n⚠️ Agent loop завершился с ошибкой. Попробуйте повторить запрос или сменить модель.',
                            ),
                        );
                    }

                    // Write memory for agent mode (same as non-agent onFinish)
                    let memoryWriteLastOk: boolean | null = null;
                    if (mem0UserId && lastUserText && loopResult.text) {
                        try {
                            memoryWriteLastOk = await addConversationToMemory(mem0UserId, lastUserText, loopResult.text);
                        } catch (e) {
                            memoryWriteLastOk = false;
                            logger.warn({ err: e, mem0UserId }, 'mem0 addConversation failed (agent mode)');
                        }
                    }

                    finalizeUsage({
                        resolvedModel: effectiveModel,
                        promptTokens: null,
                        completionTokens: null,
                        totalTokens: loopResult.totalTokens || null,
                        memoryWriteLastOk,
                    });
                },
            });
            return;
        }

        const result = streamText({
            model: togetherLlm(effectiveModel),
            system,
            messages: core,
            maxSteps: config.maxToolRounds,
            tools: { ...agentTools, ...mcpTools, ...delegateTool, ...imageTools, ...audioTools, ...memoryTools },
            toolChoice:
                (likelyImageRequest || likelyImageEditRequest || likelyPriorImageFollowupEdit)
                    ? { type: 'tool', toolName: 'generate_image' }
                    : 'auto',
            experimental_repairToolCall: async ({ toolCall }) => {
                const mk = (args: Record<string, unknown>) => ({
                    toolCallType: 'function' as const,
                    toolCallId: toolCall.toolCallId,
                    toolName: toolCall.toolName,
                    args: JSON.stringify(args),
                });
                logger.warn(
                    { toolName: toolCall.toolName, args: toolCall.args },
                    'invalid tool call args — attempting repair',
                );
                try {
                    const raw = typeof toolCall.args === 'string' ? JSON.parse(toolCall.args) : toolCall.args;

                    if (toolCall.toolName === 'generate_image' && raw && !raw.prompt) {
                        if (raw.type === 'image' || raw.markdown || raw.url) {
                            logger.warn('model echoed previous image result as args — skipping duplicate call');
                            return null;
                        }
                    }

                    if (toolCall.toolName === 'manage_memory' && raw && !raw.action) {
                        if (Array.isArray(raw.memory)) {
                            const first = raw.memory[0];
                            if (first?.id && first?.text) return mk({ action: 'update', memoryId: first.id, text: first.text });
                            if (first?.text) return mk({ action: 'add', text: first.text });
                        }
                        if (raw.text) return mk({ action: 'add', text: raw.text });
                    }
                } catch {
                    // parse failed
                }
                logger.error({ toolName: toolCall.toolName }, 'tool call repair failed, skipping');
                return null;
            },
            onError: ({ error }) => {
                logger.error(
                    { err: error, model: effectiveModel },
                    'streamText error during tool execution or generation',
                );
            },
            onFinish: async ({ text, usage }) => {
                const usageSafe = usage as
                    | { promptTokens?: number; completionTokens?: number; totalTokens?: number }
                    | undefined;
                let memoryWriteLastOk: boolean | null = null;
                if (mem0UserId && lastUserText && text && !memoryToolDidWrite) {
                    try {
                        memoryWriteLastOk = await addConversationToMemory(mem0UserId, lastUserText, text);
                    } catch (e) {
                        memoryWriteLastOk = false;
                        logger.warn({ err: e, mem0UserId }, 'mem0 addConversation failed');
                    }
                }
                finalizeUsage({
                    resolvedModel: effectiveModel,
                    promptTokens: typeof usageSafe?.promptTokens === 'number' ? usageSafe.promptTokens : null,
                    completionTokens:
                        typeof usageSafe?.completionTokens === 'number' ? usageSafe.completionTokens : null,
                    totalTokens: typeof usageSafe?.totalTokens === 'number' ? usageSafe.totalTokens : null,
                    memoryWriteLastOk,
                });
            },
        });

        result.pipeDataStreamToResponse(res);
    } catch (e) {
        logger.error({ err: e, route: 'POST /api/chat' }, 'chat handler failed');
        if (!res.headersSent) {
            res.status(500).json({ error: String(e) });
        }
    }
});

export default router;
