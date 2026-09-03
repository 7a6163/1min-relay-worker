/**
 * Configuration constants
 */

// Rate limiting configuration
export const RATE_LIMIT_CONFIG = {
  windowMs: 60 * 1000, // 1 minute window
  maxRequests: 180, // Maximum 180 requests per minute
  maxTokens: 100000, // Maximum 100k tokens per minute
};

// Default model configuration
export const DEFAULT_MODEL = "open-mistral-nemo";
// NOTE: black-forest-labs/flux-schnell used to be the default, but the upstream
// models API reports it as status "DISABLED" and rejects requests for it with
// 400 UNSUPPORTED_MODEL.
export const DEFAULT_IMAGE_MODEL = "gpt-image-1-mini";

// Public CDN serving the assets that `resultObject` paths refer to.
// An upstream response's `temporaryUrl` is a signed URL for the *first* result
// only, so multi-image responses need a URL we can build for the rest.
export const ONE_MIN_ASSET_CDN_URL = "https://asset.1min.ai";

// Some image models reject a request that omits `quality`
export const IMAGE_MODELS_REQUIRING_QUALITY = new Set([
  "gpt-image-1",
  "gpt-image-1-mini",
  "gpt-image-2",
]);
export const DEFAULT_IMAGE_QUALITY = "low";

// Fixed token estimate for non-text requests (audio, image) in rate limiting
export const MEDIA_REQUEST_TOKEN_ESTIMATE = 1000;

// Audio file constraints (matching OpenAI's limits)
export const MAX_AUDIO_FILE_SIZE = 25 * 1024 * 1024; // 25MB

export const SUPPORTED_AUDIO_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
  "audio/x-m4a",
  "audio/x-wav",
]);

// Whisper model IDs (uses response_format/temperature in promptObject)
export const WHISPER_MODEL_IDS = new Set(["whisper-1"]);

// Models that support audio translation (AUDIO_TRANSLATOR feature)
// Currently only whisper-1 supports translation to English
export const AUDIO_TRANSLATION_MODEL_IDS = new Set(["whisper-1"]);

// Hardcoded fallback for speech models (in case the API doesn't return them)
export const FALLBACK_SPEECH_MODEL_IDS = [
  "whisper-1",
  "latest_long",
  "latest_short",
  "phone_call",
  "telephony",
  "telephony_short",
  "medical_dictation",
  "medical_conversation",
];

// Hardcoded fallback for text-to-speech models (if the API doesn't return them)
export const FALLBACK_TTS_MODEL_IDS = [
  "tts-1",
  "tts-1-hd",
  "elevenlabs-tts",
  "google-tts",
  "qwen3-tts-flash",
];

// Text-to-speech constraints (matching OpenAI's limits)
export const DEFAULT_TTS_MODEL = "tts-1";
export const MAX_TTS_INPUT_LENGTH = 4096;
export const DEFAULT_TTS_VOICE = "alloy";
export const DEFAULT_TTS_RESPONSE_FORMAT = "mp3";
export const TTS_CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  opus: "audio/opus",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/pcm",
};

// API endpoints
export const API_ENDPOINTS = {
  CHAT_COMPLETIONS: "/v1/chat/completions",
  RESPONSES: "/v1/responses",
  MESSAGES: "/v1/messages",
  IMAGES_GENERATIONS: "/v1/images/generations",
  AUDIO_TRANSCRIPTIONS: "/v1/audio/transcriptions",
  AUDIO_TRANSLATIONS: "/v1/audio/translations",
  AUDIO_SPEECH: "/v1/audio/speech",
  MODELS: "/v1/models",
} as const;
