import crypto from "node:crypto";
import { logger } from "../logger.js";
import {
  togetherClient,
  isModelNotAvailableError,
  isModelTemporarilyUnavailable,
} from "./chatHelpers.js";
import { markModelUnhealthy, isModelHealthy } from "../modelHealth.js";

type CachedAudio = { buffer: Buffer; mime: string; createdAt: number };

const audioFileCache = new Map<string, CachedAudio>();
const CACHE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_VOICE = "af_heart";

function cleanupAudioCache() {
  const cutoff = Date.now() - CACHE_TTL_MS;
  for (const [id, entry] of audioFileCache) {
    if (entry.createdAt < cutoff) audioFileCache.delete(id);
  }
}

setInterval(cleanupAudioCache, 5 * 60 * 1000).unref();

export function getAudioFile(
  id: string,
): { buffer: Buffer; mime: string } | null {
  const entry = audioFileCache.get(id);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    audioFileCache.delete(id);
    return null;
  }
  return { buffer: entry.buffer, mime: entry.mime };
}

export async function generateAudio(params: {
  text: string;
  voice?: string;
  preferredModel?: string;
  language?: string;
  candidateModels: string[];
}): Promise<{ url: string; usedModel: string } | null> {
  const prioritized = params.preferredModel?.trim()
    ? [params.preferredModel.trim(), ...params.candidateModels]
    : params.candidateModels;

  // Filter by both temporary unavailability AND health snapshot
  const candidates = [...new Set(prioritized)].filter(
    (id) => !isModelTemporarilyUnavailable(id) && isModelHealthy(id),
  );

  if (candidates.length === 0) {
    logger.warn(
      { totalCandidates: prioritized.length },
      "TTS: no healthy candidates available",
    );
    return null;
  }

  const voice = params.voice?.trim() || DEFAULT_VOICE;
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const response = await togetherClient.audio.create({
        model: candidate,
        input: params.text,
        voice,
        response_format: "mp3",
        ...(params.language ? { language: params.language as any } : {}),
      });

      const raw = response as unknown as Response;
      const arrayBuf = await raw.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      if (buffer.length < 100) {
        logger.warn(
          { model: candidate, bytes: buffer.length },
          "TTS returned suspiciously small response",
        );
        errors.push(`${candidate}: empty response (${buffer.length}b)`);
        continue;
      }

      const id = crypto.randomUUID();
      audioFileCache.set(id, {
        buffer,
        mime: "audio/mpeg",
        createdAt: Date.now(),
      });

      logger.info(
        { model: candidate, voice, bytes: buffer.length, cacheId: id },
        "audio generated successfully",
      );

      return { url: `/api/audio/file/${id}`, usedModel: candidate };
    } catch (e) {
      const errMsg = String(
        (e as { message?: string })?.message ?? e,
      ).slice(0, 200);

      if (isModelNotAvailableError(e)) {
        markModelUnhealthy(candidate, errMsg);
      }

      errors.push(`${candidate}: ${errMsg}`);
      logger.warn(
        { model: candidate, error: errMsg },
        "TTS generation failed, trying next candidate",
      );
    }
  }

  logger.error(
    { candidates, errors },
    "TTS: all candidates exhausted",
  );
  return null;
}
