/**
 * Shared streaming pipeline infrastructure
 * Eliminates duplicated TransformStream/reader/writer boilerplate across handlers
 */

import { ApiError } from "./errors";
import { createSSEResponse } from "./sse";
import { SimpleUTF8Decoder } from "./utf8-decoder";

const encoder = new TextEncoder();

export interface StreamingCallbacks {
  onStart?: (writer: WritableStreamDefaultWriter<Uint8Array>) => Promise<void>;
  onChunk: (
    writer: WritableStreamDefaultWriter<Uint8Array>,
    chunk: string,
  ) => Promise<void>;
  onEnd: (
    writer: WritableStreamDefaultWriter<Uint8Array>,
    accumulatedContent: string,
  ) => Promise<void>;
}

/**
 * Check if text looks like SSE format (line-anchored check for "data: " or "event: ").
 * Issue #4: anchored to line start to avoid false positives from response content.
 */
const SSE_LINE_PATTERN = /(^|\n)(data|event): /;
function isSSEFormat(text: string): boolean {
  return SSE_LINE_PATTERN.test(text);
}

export interface ParsedSSEBlock {
  /** Delta text extracted from `event: content` events. */
  chunks: string[];
  /** Message from an `event: error` event, if the upstream reported a failure. */
  error?: string;
}

/**
 * Pull a human-readable message out of an `event: error` data payload.
 * 1min.ai sends `{"error":"..."}`; be tolerant of other shapes.
 */
function extractStreamErrorMessage(dataStr: string): string {
  try {
    const parsed = JSON.parse(dataStr) as Record<string, unknown>;
    if (typeof parsed.error === "string" && parsed.error) {
      return parsed.error;
    }
    if (parsed.error && typeof parsed.error === "object") {
      const nested = (parsed.error as Record<string, unknown>).message;
      if (typeof nested === "string" && nested) return nested;
    }
    if (typeof parsed.message === "string" && parsed.message) {
      return parsed.message;
    }
  } catch {
    // Not JSON — fall through and use the raw payload
  }
  return dataStr.trim() || "Upstream stream reported an error";
}

/**
 * Parse SSE events from a 1min.ai streaming response block.
 *
 * Extracts delta text from `event: content`, and surfaces `event: error` so the
 * caller can abort. The upstream answers a failed streaming request with
 * HTTP 200 and an `event: error` payload, so treating it as a normal end of
 * stream would report a truncated (often empty) success to the client.
 *
 * `event: result` (full record) and `event: done` (terminator) are ignored.
 * Returns null if no SSE structure was found (caller should use raw text).
 *
 * Issue #6: eventType persists across multiple data lines within the same event block,
 * only reset on empty line or next event: line.
 */
export function parseSSEChunks(text: string): ParsedSSEBlock | null {
  const chunks: string[] = [];
  const lines = text.split("\n");
  let hasSSEStructure = false;
  let currentEventType = "";
  let error: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();

    // Empty line marks end of an SSE event block — reset event type
    if (!line) {
      currentEventType = "";
      continue;
    }

    // Track event type
    if (line.startsWith("event: ")) {
      hasSSEStructure = true;
      currentEventType = line.slice(7).trim();
      continue;
    }

    // Process data lines
    if (line.startsWith("data: ")) {
      hasSSEStructure = true;
      const dataStr = line.slice(6);
      if (dataStr === "[DONE]") continue;

      // Upstream failure: HTTP 200 with an in-stream error event
      if (currentEventType === "error") {
        error ??= extractStreamErrorMessage(dataStr);
        continue;
      }

      // Skip other non-content events (result, done)
      if (currentEventType && currentEventType !== "content") {
        continue;
      }

      try {
        const parsed = JSON.parse(dataStr) as Record<string, unknown>;
        if (typeof parsed.content === "string" && parsed.content) {
          chunks.push(parsed.content);
        }
      } catch {
        // Not JSON — treat as raw text content if from a content event
        if (dataStr.trim()) {
          chunks.push(dataStr);
        }
      }
    }
  }

  return hasSSEStructure ? { chunks, error } : null;
}

/**
 * Handle one parsed SSE block: abort on an upstream error event, otherwise
 * forward its content deltas. Returns the updated accumulated content.
 */
async function processSSEBlock(
  part: string,
  accumulatedContent: string,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  callbacks: StreamingCallbacks,
): Promise<string> {
  const parsed = parseSSEChunks(part);
  if (!parsed) return accumulatedContent;

  if (parsed.error) {
    // Do not call onEnd: reporting a completed response here would tell the
    // client the (possibly empty) partial answer was the whole answer.
    throw new ApiError(parsed.error, 502, "upstream_stream_error");
  }

  let content = accumulatedContent;
  for (const chunk of parsed.chunks) {
    // Issue #1: dedup using running accumulated string (O(1) per check)
    // Guards against an upstream that repeats the full text as its last event
    if (content && chunk === content) continue;

    content += chunk;
    await callbacks.onChunk(writer, chunk);
  }
  return content;
}

/**
 * Execute a streaming pipeline that parses SSE events from 1min.ai.
 * The upstream response is SSE-formatted; we extract content chunks
 * and pass them to the callbacks for re-formatting into client SSE.
 */
export function executeStreamingPipeline(
  response: Response,
  callbacks: StreamingCallbacks,
): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const reader = response.body?.getReader();
  if (!reader) {
    writer.close().catch(() => {});
    return createSSEResponse(readable);
  }

  (async () => {
    try {
      const utf8Decoder = new SimpleUTF8Decoder();
      let accumulatedContent = "";
      let buffer = "";
      // Issue #5: defer SSE detection until first double-newline boundary
      let detectedSSE: boolean | null = null;

      if (callbacks.onStart) {
        await callbacks.onStart(writer);
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const decoded = utf8Decoder.decode(value, done);
        if (!decoded) continue;

        // Accumulate into buffer first; detect format once we have a complete event
        buffer += decoded;

        // Issue #5: defer detection until we see a double-newline (complete SSE event)
        if (detectedSSE === null) {
          if (buffer.includes("\n\n")) {
            detectedSSE = isSSEFormat(buffer);
            if (!detectedSSE) {
              // Issue #9: use console.warn instead of console.log
              console.warn(
                "Streaming: raw text mode (upstream is not SSE-formatted)",
              );
              // Flush entire buffer as raw text
              accumulatedContent += buffer;
              await callbacks.onChunk(writer, buffer);
              buffer = "";
            }
          }
          // If no double-newline yet, keep buffering
          if (detectedSSE === null) continue;
        }

        if (!detectedSSE) {
          // Raw text mode (legacy/fallback)
          accumulatedContent += buffer;
          await callbacks.onChunk(writer, buffer);
          buffer = "";
          continue;
        }

        // SSE mode: split on double newlines
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          accumulatedContent = await processSSEBlock(
            part,
            accumulatedContent,
            writer,
            callbacks,
          );
        }
      }

      // Process any remaining buffer (SSE mode only)
      if (detectedSSE && buffer.trim()) {
        accumulatedContent = await processSSEBlock(
          buffer,
          accumulatedContent,
          writer,
          callbacks,
        );
      }

      await callbacks.onEnd(writer, accumulatedContent);
      await writer.close();
    } catch (error) {
      console.error("Streaming pipeline error:", error);
      try {
        const errorMessage =
          error instanceof Error ? error.message : "Stream interrupted";
        const errorType =
          error instanceof ApiError ? error.type : "server_error";
        const errorCode = error instanceof ApiError ? error.code : null;
        await writer.write(
          encoder.encode(
            `data: ${JSON.stringify({ error: { message: errorMessage, type: errorType, code: errorCode } })}\n\n`,
          ),
        );
        await writer.close();
      } catch {
        await writer.abort(error).catch(() => {});
      }
    }
  })();

  return createSSEResponse(readable);
}
