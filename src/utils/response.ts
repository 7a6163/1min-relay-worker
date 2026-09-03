/**
 * Response utilities for consistent API responses
 *
 * CORS headers are handled globally by the Hono CORS middleware (src/middleware/cors.ts).
 * Response utilities should NOT add CORS headers manually.
 */

import type { OneMinChatResponse } from "../types";

/**
 * Extract text content from a 1min.ai response, with consistent fallback logic.
 */
export function extractOneMinContent(data: OneMinChatResponse): string {
  const content =
    data.aiRecord?.aiRecordDetail?.resultObject?.[0] || data.content;
  if (!content) {
    console.warn(
      "Empty response from 1min.ai — no resultObject or content field",
    );
    return "";
  }
  return content;
}

export interface OneMinUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  finishReason?: string;
}

/**
 * Read token accounting out of a 1min.ai response.
 *
 * The upstream reports usage as `aiRecord.metadata.{inputToken,outputToken,
 * totalToken}` and has no OpenAI-style `usage` object at all, so reading
 * `data.usage` (as this relay used to) always yielded zeroes.
 *
 * Returns null when the record carries no token counts — image and
 * text-to-speech records, for instance, put other things in `metadata` — so
 * callers can fall back to a local estimate.
 */
export function extractOneMinUsage(
  data: OneMinChatResponse,
): OneMinUsage | null {
  const metadata = data.aiRecord?.metadata;
  if (!metadata) return null;

  const { inputToken, outputToken, totalToken, finishReason } = metadata;
  if (typeof inputToken !== "number" && typeof outputToken !== "number") {
    return null;
  }

  const promptTokens = inputToken ?? 0;
  const completionTokens = outputToken ?? 0;

  return {
    promptTokens,
    completionTokens,
    totalTokens: totalToken ?? promptTokens + completionTokens,
    finishReason,
  };
}

export function createSuccessResponse<T = unknown>(
  data: T,
  status: number = 200,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
