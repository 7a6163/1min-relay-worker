/**
 * Input conversion for the OpenAI Responses API (/v1/responses)
 *
 * Turns the `input` field of a Responses API request into the internal
 * `Message[]` format. Kept separate from the handler so the conversion can be
 * unit tested without a Worker runtime.
 */

import type { Message, ResponseInputItem } from "../types";
import { ValidationError } from "./errors";

/**
 * Content part types that carry plain text.
 *
 * The Responses API names text parts differently depending on direction:
 * `input_text` for what the client sends, `output_text` for assistant turns
 * echoed back into a follow-up request. Some clients simply send `text`.
 */
const TEXT_PART_TYPES = new Set(["text", "input_text", "output_text"]);

/**
 * Extract the text of a single input item's content.
 *
 * Non-text parts (`input_image`, `input_file`, ...) are rejected rather than
 * silently dropped: dropping them would send a truncated prompt upstream and
 * produce a confidently wrong answer.
 */
function extractInputItemText(
  content: string | Array<{ type: string; text?: string }>,
): string {
  if (typeof content === "string") {
    return content;
  }

  const textParts: string[] = [];
  const unsupportedTypes = new Set<string>();

  for (const part of content) {
    if (TEXT_PART_TYPES.has(part.type)) {
      if (part.text) {
        textParts.push(part.text);
      }
    } else {
      unsupportedTypes.add(part.type);
    }
  }

  if (unsupportedTypes.size > 0) {
    const listed = Array.from(unsupportedTypes).sort().join(", ");
    throw new ValidationError(
      `Unsupported content part type(s) in "input": ${listed}. ` +
        "Only text parts (text, input_text, output_text) are supported by " +
        "/v1/responses. Use the OpenAI Chat Completions API " +
        "(/v1/chat/completions) for vision requests.",
      "input",
      "unsupported_content_type",
    );
  }

  return textParts.join("\n");
}

/**
 * Convert a Responses API `input` field into internal messages.
 *
 * @param input      Either a bare prompt string or an array of input items.
 * @param instructions Optional system prompt, prepended as a system message.
 */
export function convertInputToMessages(
  input: string | ResponseInputItem[],
  instructions?: string,
): Message[] {
  const messages: Message[] = [];

  // Instructions map onto a leading system message
  if (instructions) {
    messages.push({ role: "system", content: instructions });
  }

  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
  } else {
    for (const item of input) {
      // `type` is optional in the Responses API spec: an item carrying only
      // `role` + `content` is a message item. Items of any other type
      // (function_call, item_reference, ...) are not supported and skipped.
      if (item.type && item.type !== "message") {
        continue;
      }
      messages.push({
        role: item.role,
        content: extractInputItemText(item.content),
      });
    }
  }

  // Guard against silently forwarding an empty prompt: upstream would answer
  // with a generic greeting instead of an error, which is very hard to debug.
  const hasPrompt = messages.some(
    (message) =>
      message.role !== "system" &&
      typeof message.content === "string" &&
      message.content.trim() !== "",
  );
  if (!hasPrompt) {
    throw new ValidationError(
      'No usable message content found in "input". Provide at least one ' +
        "message item with non-empty text content.",
      "input",
      "empty_input",
    );
  }

  return messages;
}
