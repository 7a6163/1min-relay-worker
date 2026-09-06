/**
 * Token calculation utility
 */

import { encode } from "gpt-tokenizer";

import type {
  AnthropicMessageRequest,
  ChatCompletionRequest,
  Message,
  ResponseRequest,
} from "../types";
import { extractAllMessageText } from "./message-processing";

const CHAR_TO_TOKEN_RATIO = 4;

export function calculateTokens(text: string, _model?: string): number {
  try {
    return encode(text).length;
  } catch (error) {
    console.error("Token calculation failed:", error);
    return estimateTokenCount(text);
  }
}

/**
 * Estimate input tokens from a messages array
 */
export function estimateInputTokens(messages: Message[]): number {
  return calculateTokens(extractAllMessageText(messages));
}

/**
 * Calculate token count for a Chat Completions request body.
 */
export function calculateChatRequestTokens(
  body: ChatCompletionRequest,
): number {
  const text = extractAllMessageText(body.messages ?? []);
  return calculateTokens(text, body.model);
}

/**
 * Calculate token count for a Responses API request body.
 */
export function calculateResponseRequestTokens(body: ResponseRequest): number {
  let text = "";
  if (typeof body.input === "string") {
    text = body.input;
  } else if (body.messages) {
    text = extractAllMessageText(body.messages);
  }
  return calculateTokens(text, body.model);
}

/**
 * Calculate token count for an Anthropic Messages request body.
 */
export function calculateAnthropicRequestTokens(
  body: AnthropicMessageRequest,
): number {
  const messageText = extractAllMessageText(body.messages ?? []);

  let systemText = "";
  if (typeof body.system === "string") {
    systemText = body.system;
  } else if (Array.isArray(body.system)) {
    systemText = body.system.map((b) => b.text).join(" ");
  }

  return calculateTokens(`${systemText} ${messageText}`.trim(), body.model);
}

function estimateTokenCount(text: string): number {
  // More sophisticated estimation than simple division
  // Account for whitespace, punctuation, and common patterns
  const words = text.trim().split(/\s+/).length;
  const chars = text.length;

  // Heuristic: average English word is ~4-5 characters + space
  // Tokens are roughly 0.75 words on average
  const wordBasedEstimate = Math.ceil(words * 0.75);
  const charBasedEstimate = Math.ceil(chars / CHAR_TO_TOKEN_RATIO);

  // Use the higher estimate for safety in rate limiting
  return Math.max(wordBasedEstimate, charBasedEstimate);
}
