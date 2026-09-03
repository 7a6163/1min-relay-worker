/**
 * Environment variables interface for Cloudflare Workers
 */
export interface Env {
  // API URLs for 1min.ai services
  ONE_MIN_CHAT_API_URL: string; // Chat endpoint (/api/chat-with-ai)
  ONE_MIN_API_URL: string; // Non-chat features: image generation, audio, etc. (/api/features)
  ONE_MIN_ASSET_URL: string;

  // Models API URL
  ONE_MIN_MODELS_API_URL: string;

  // Public CDN serving generated assets (optional; a constant is used if unset)
  ONE_MIN_ASSET_CDN_URL?: string;

  // KV Namespaces
  RATE_LIMIT_STORE?: KVNamespace;
  MODEL_CACHE?: KVNamespace;

  // Authentication token for API access
  AUTH_TOKEN?: string;

  // Web search configuration (optional)
  WEB_SEARCH_NUM_OF_SITE?: string;
  WEB_SEARCH_MAX_WORD?: string;
}
