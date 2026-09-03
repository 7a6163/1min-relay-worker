/**
 * Dynamic model registry that fetches model data from the 1min.ai API
 * with two-tier caching: in-memory (5min) + KV (1hr)
 */

import {
  AUDIO_TRANSLATION_MODEL_IDS,
  FALLBACK_SPEECH_MODEL_IDS,
  FALLBACK_TTS_MODEL_IDS,
} from "../constants/config";
import type { CachedModelData, Env, OneMinModelEntry } from "../types";
import { ApiError } from "../utils/errors";

const MEMORY_TTL_MS = 5 * 60 * 1000; // 5 minutes
const KV_TTL_SECONDS = 60 * 60; // 1 hour
// Bumped whenever the cached shape or the filtering changes, so entries written
// by an older version are not reused.
const KV_KEY = "model-data-v2";
const FETCH_TIMEOUT_MS = 5000;

// Module-level in-memory cache
let memoryCache: CachedModelData | null = null;
let memoryCacheExpiry = 0;

// Deduplication: single inflight fetch shared across concurrent callers
// Note: module-level state is per-isolate only; cross-isolate dedup relies on KV
let inflight: Promise<CachedModelData> | null = null;

function isValidCachedData(data: unknown): data is CachedModelData {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    Array.isArray(d.chatModelIds) &&
    Array.isArray(d.imageModelIds) &&
    Array.isArray(d.entries) &&
    d.entries.length > 0
  );
}

/**
 * The models API lists entries the account cannot actually use: `status` can be
 * "DISABLED", and `deprecationDate` can already be in the past. Requests for
 * those are rejected upstream with 400 UNSUPPORTED_MODEL, so they must not
 * reach the client model list or pass model validation.
 */
export function isUsableModel(
  model: OneMinModelEntry,
  now: number = Date.now(),
): boolean {
  if (model.status !== "ACTIVE") return false;
  if (model.deprecationDate) {
    const deprecatedAt = Date.parse(model.deprecationDate);
    if (!Number.isNaN(deprecatedAt) && deprecatedAt <= now) return false;
  }
  return true;
}

function processModels(
  chatModels: OneMinModelEntry[],
  imageModels: OneMinModelEntry[],
  speechModels: OneMinModelEntry[],
  ttsModels: OneMinModelEntry[],
): CachedModelData {
  const now = Date.now();
  const usableChat = chatModels.filter((m) => isUsableModel(m, now));
  const usableImage = imageModels.filter((m) => isUsableModel(m, now));
  const usableSpeech = speechModels.filter((m) => isUsableModel(m, now));
  const usableTts = ttsModels.filter((m) => isUsableModel(m, now));

  // Deduplicate by modelId (chat models take priority)
  const seen = new Set<string>();
  const allEntries: OneMinModelEntry[] = [];

  for (const group of [usableChat, usableImage, usableSpeech, usableTts]) {
    for (const model of group) {
      if (!seen.has(model.modelId)) {
        seen.add(model.modelId);
        allEntries.push(model);
      }
    }
  }

  const chatModelIds = usableChat.map((m) => m.modelId);
  const imageModelIds = usableImage.map((m) => m.modelId);

  const visionModelIds = usableChat
    .filter((m) => m.modality?.INPUT?.includes("image"))
    .map((m) => m.modelId);

  const codeInterpreterModelIds = usableChat
    .filter((m) => m.features.includes("CODE_GENERATOR"))
    .map((m) => m.modelId);

  // Use API-fetched models, falling back to hardcoded lists if empty
  const speechModelIds =
    usableSpeech.length > 0
      ? usableSpeech.map((m) => m.modelId)
      : [...FALLBACK_SPEECH_MODEL_IDS];

  const ttsModelIds =
    usableTts.length > 0
      ? usableTts.map((m) => m.modelId)
      : [...FALLBACK_TTS_MODEL_IDS];

  return {
    chatModelIds,
    imageModelIds,
    visionModelIds,
    codeInterpreterModelIds,
    speechModelIds,
    ttsModelIds,
    entries: allEntries,
    fetchedAt: Date.now(),
  };
}

async function fetchModelsFromAPI(
  apiUrl: string,
  feature: string,
): Promise<OneMinModelEntry[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${apiUrl}?feature=${feature}`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Models API returned ${response.status} for feature=${feature}`,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    if (!Array.isArray(data.models)) {
      throw new Error(
        `Unexpected API response shape for feature=${feature}: missing models array`,
      );
    }
    return data.models as OneMinModelEntry[];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAndProcess(env: Env): Promise<CachedModelData> {
  const [chatModels, imageModels, speechModels, ttsModels] = await Promise.all([
    fetchModelsFromAPI(env.ONE_MIN_MODELS_API_URL, "UNIFY_CHAT_WITH_AI"),
    fetchModelsFromAPI(env.ONE_MIN_MODELS_API_URL, "IMAGE_GENERATOR"),
    fetchModelsFromAPI(env.ONE_MIN_MODELS_API_URL, "SPEECH_TO_TEXT").catch(
      () => [] as OneMinModelEntry[],
    ),
    fetchModelsFromAPI(env.ONE_MIN_MODELS_API_URL, "TEXT_TO_SPEECH").catch(
      () => [] as OneMinModelEntry[],
    ),
  ]);

  return processModels(chatModels, imageModels, speechModels, ttsModels);
}

/**
 * Get model data with two-tier cache: in-memory (5min) → KV (1hr) → API
 * Concurrent callers share a single inflight fetch (thundering herd protection).
 */
export async function getModelData(env: Env): Promise<CachedModelData> {
  // 1. Check in-memory cache
  if (memoryCache && Date.now() < memoryCacheExpiry) {
    return memoryCache;
  }

  // 2. Check KV cache
  if (env.MODEL_CACHE) {
    try {
      const kvData = await env.MODEL_CACHE.get(KV_KEY, "json");
      if (isValidCachedData(kvData)) {
        memoryCache = kvData;
        memoryCacheExpiry = Date.now() + MEMORY_TTL_MS;
        return kvData;
      }
    } catch (e) {
      console.error("KV read error:", e);
    }
  }

  // 3. Deduplicate concurrent API fetches
  if (inflight) {
    return inflight;
  }

  inflight = fetchAndProcess(env)
    .then((data) => {
      // Store in memory
      memoryCache = data;
      memoryCacheExpiry = Date.now() + MEMORY_TTL_MS;

      // Store in KV (non-blocking)
      if (env.MODEL_CACHE) {
        env.MODEL_CACHE.put(KV_KEY, JSON.stringify(data), {
          expirationTtl: KV_TTL_SECONDS,
        }).catch((e: unknown) => console.error("KV write error:", e));
      }

      return data;
    })
    .catch((e) => {
      console.error("Failed to fetch models from API:", e);

      // Return stale in-memory cache if available (better than nothing)
      if (memoryCache) {
        console.warn("Using stale in-memory cache as fallback");
        memoryCacheExpiry = Date.now() + MEMORY_TTL_MS;
        return memoryCache;
      }

      throw new ApiError(
        "Unable to fetch model list from upstream API. Please try again shortly.",
        503,
      );
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/**
 * Check if a model exists in chat or image models
 */
export async function isValidModel(model: string, env: Env): Promise<boolean> {
  const data = await getModelData(env);
  const speechIds = data.speechModelIds ?? FALLBACK_SPEECH_MODEL_IDS;
  return (
    data.chatModelIds.includes(model) ||
    data.imageModelIds.includes(model) ||
    speechIds.includes(model)
  );
}

/**
 * Check if a model supports vision (modality.INPUT includes "image")
 */
export async function isVisionModel(model: string, env: Env): Promise<boolean> {
  const data = await getModelData(env);
  return data.visionModelIds.includes(model);
}

/**
 * Check if a model supports code interpreter (CODE_GENERATOR feature)
 */
export async function isCodeInterpreterModel(
  model: string,
  env: Env,
): Promise<boolean> {
  const data = await getModelData(env);
  return data.codeInterpreterModelIds.includes(model);
}

/**
 * Check if a model supports image generation
 */
export async function isImageGenerationModel(
  model: string,
  env: Env,
): Promise<boolean> {
  const data = await getModelData(env);
  return data.imageModelIds.includes(model);
}

/**
 * Check if a model is a chat model (all chat models support web search)
 */
export async function isChatModel(model: string, env: Env): Promise<boolean> {
  const data = await getModelData(env);
  return data.chatModelIds.includes(model);
}

/**
 * Check if a model supports speech-to-text
 */
export async function isSpeechModel(model: string, env: Env): Promise<boolean> {
  const data = await getModelData(env);
  const speechIds = data.speechModelIds ?? FALLBACK_SPEECH_MODEL_IDS;
  return speechIds.includes(model);
}

/**
 * Check if a model supports text-to-speech (TEXT_TO_SPEECH feature)
 */
export async function isTextToSpeechModel(
  model: string,
  env: Env,
): Promise<boolean> {
  const data = await getModelData(env);
  const ttsIds = data.ttsModelIds ?? FALLBACK_TTS_MODEL_IDS;
  return ttsIds.includes(model);
}

/**
 * Check if a model supports audio translation (translate to English).
 * Currently only whisper-1 supports this via 1min.ai's AUDIO_TRANSLATOR.
 */
export function isAudioTranslationModel(model: string): boolean {
  return AUDIO_TRANSLATION_MODEL_IDS.has(model);
}
