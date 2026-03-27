import { config } from "./config.js";

export type Tier = "low" | "med" | "high";

export function tierToModel(tier: Tier): string {
  void tier;
  return config.togetherBaseModel;
}

export async function resolveChatModel(
  requested: string | undefined,
  lastUserText: string
): Promise<{ model: string; tier?: Tier; skippedClassifier?: boolean; candidates: string[] }> {
  void lastUserText;
  if (requested && requested !== "auto") {
    return { model: requested, candidates: [requested] };
  }
  return { model: config.togetherBaseModel, candidates: [config.togetherBaseModel], skippedClassifier: true };
}
