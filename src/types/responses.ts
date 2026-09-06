/**
 * Response type definitions for API endpoints
 */

/**
 * Token accounting reported by 1min.ai.
 *
 * Note the upstream has no OpenAI-style `usage` object — the real numbers live
 * here, under `aiRecord.metadata`, and are named differently.
 */
export interface OneMinRecordMetadata {
  /** Total prompt tokens charged, including replayed history */
  inputToken?: number;
  outputToken?: number;
  totalToken?: number;
  /** Tokens of the current prompt only, excluding history */
  promptToken?: number;
  finishReason?: string;
  credit?: number;
  executionTime?: number;
}

export interface OneMinChatResponse {
  requestId?: string;
  content?: string;
  aiRecord?: {
    metadata?: OneMinRecordMetadata;
    /** Signed URL for the first stored result (audio, image, ...) */
    temporaryUrl?: string;
    aiRecordDetail: {
      resultObject: string[];
    };
  };
}

export interface OneMinImageResponse {
  aiRecord: {
    temporaryUrl?: string;
    aiRecordDetail: {
      resultObject: string[];
    };
  };
}

export interface RateLimitRecord {
  requestCount: number;
  tokenCount: number;
  windowStart: number;
}

export interface RateLimitConfig {
  windowMs: number; // Time window (milliseconds)
  maxRequests: number; // Maximum requests
  maxTokens?: number; // Maximum tokens (optional)
}
