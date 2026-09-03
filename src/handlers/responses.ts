/**
 * Responses endpoint handler
 * Handles structured outputs and reasoning requests
 * Uses OpenAI Responses API format with output[] instead of choices[]
 */

import { DEFAULT_MODEL } from "../constants";
import type {
  Message,
  OneMinChatResponse,
  ResponseFormat,
  ResponseRequest,
  ResponsesAPIResponse,
  ResponsesOutputMessage,
} from "../types";
import {
  calculateTokens,
  convertInputToMessages,
  createSuccessResponse,
  estimateInputTokens,
  extractOneMinContent,
  ValidationError,
  validateModelAndMessages,
  type WebSearchConfig,
} from "../utils";
import { writeSSEDone, writeSSEEventWithType } from "../utils/sse";
import { executeStreamingPipeline } from "../utils/streaming";
import { BaseTextHandler } from "./base";

export class ResponseHandler extends BaseTextHandler {
  async handleResponsesWithBody(
    requestBody: ResponseRequest,
    apiKey: string,
  ): Promise<Response> {
    // Validate required fields - support both input and messages formats
    if (
      !requestBody.input &&
      (!requestBody.messages || !Array.isArray(requestBody.messages))
    ) {
      throw new ValidationError(
        'Either "input" field (string or array) or "messages" field (array) is required',
        "input",
      );
    }

    // Convert input format to messages format
    let messages: Message[];
    if (requestBody.input) {
      messages = convertInputToMessages(
        requestBody.input,
        requestBody.instructions,
      );
    } else {
      messages = requestBody.messages as Message[];
      // Add instructions as system message if provided
      if (requestBody.instructions) {
        messages = [
          { role: "system", content: requestBody.instructions },
          ...messages,
        ];
      }
    }

    const rawModel = requestBody.model || DEFAULT_MODEL;

    const { cleanModel, webSearchConfig, processedMessages } =
      await validateModelAndMessages(rawModel, messages, this.env);

    if (requestBody.stream) {
      return this.handleStreamingResponse(
        processedMessages,
        cleanModel,
        requestBody.response_format,
        requestBody.reasoning_effort,
        apiKey,
        webSearchConfig,
      );
    }

    return this.handleNonStreamingResponse(
      processedMessages,
      cleanModel,
      requestBody.response_format,
      requestBody.reasoning_effort,
      apiKey,
      webSearchConfig,
    );
  }

  private async handleNonStreamingResponse(
    messages: Message[],
    model: string,
    responseFormat?: ResponseFormat,
    reasoningEffort?: ResponseRequest["reasoning_effort"],
    apiKey?: string,
    webSearchConfig?: WebSearchConfig,
  ): Promise<Response> {
    const enhancedMessages = this.enhanceMessagesForStructuredResponse(
      messages,
      responseFormat,
      reasoningEffort,
    );

    const data = await this.sendNonStreamingRequest(
      enhancedMessages,
      model,
      apiKey || "",
      webSearchConfig,
    );

    const responsesAPIResponse = this.transformToResponsesFormat(
      data,
      model,
      responseFormat,
    );
    return createSuccessResponse(responsesAPIResponse);
  }

  private async handleStreamingResponse(
    messages: Message[],
    model: string,
    responseFormat?: ResponseFormat,
    reasoningEffort?: ResponseRequest["reasoning_effort"],
    apiKey?: string,
    webSearchConfig?: WebSearchConfig,
  ): Promise<Response> {
    const enhancedMessages = this.enhanceMessagesForStructuredResponse(
      messages,
      responseFormat,
      reasoningEffort,
    );

    const response = await this.sendStreamingRequest(
      enhancedMessages,
      model,
      apiKey || "",
      webSearchConfig,
    );

    const responseId = `resp-${crypto.randomUUID()}`;
    const messageId = `msg-${crypto.randomUUID()}`;

    return executeStreamingPipeline(response, {
      onStart: async (writer) => {
        // Send response.created
        const initialResponse: ResponsesAPIResponse = {
          id: responseId,
          object: "response",
          created_at: Math.floor(Date.now() / 1000),
          model,
          output: [],
          status: "in_progress",
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        };
        await writeSSEEventWithType(writer, "response.created", {
          type: "response.created",
          response: initialResponse,
        });

        // Send output_item.added
        const outputItem: ResponsesOutputMessage = {
          type: "message",
          id: messageId,
          role: "assistant",
          content: [{ type: "output_text", text: "" }],
          status: "in_progress",
        };
        await writeSSEEventWithType(writer, "response.output_item.added", {
          type: "response.output_item.added",
          output_index: 0,
          item: outputItem,
        });

        // Send content_part.added
        await writeSSEEventWithType(writer, "response.content_part.added", {
          type: "response.content_part.added",
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "" },
        });
      },
      onChunk: async (writer, chunk) => {
        await writeSSEEventWithType(writer, "response.output_text.delta", {
          type: "response.output_text.delta",
          output_index: 0,
          content_index: 0,
          delta: chunk,
        });
      },
      onEnd: async (writer, accumulatedContent) => {
        // Send text done
        await writeSSEEventWithType(writer, "response.output_text.done", {
          type: "response.output_text.done",
          output_index: 0,
          content_index: 0,
          text: accumulatedContent,
        });

        // Send content_part.done
        await writeSSEEventWithType(writer, "response.content_part.done", {
          type: "response.content_part.done",
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: accumulatedContent },
        });

        // Send output_item.done
        const completedItem: ResponsesOutputMessage = {
          type: "message",
          id: messageId,
          role: "assistant",
          content: [{ type: "output_text", text: accumulatedContent }],
          status: "completed",
        };
        await writeSSEEventWithType(writer, "response.output_item.done", {
          type: "response.output_item.done",
          output_index: 0,
          item: completedItem,
        });

        // Send response.done
        const outputTokens = calculateTokens(accumulatedContent, model);
        const inputTokens = estimateInputTokens(messages);
        const finalResponse: ResponsesAPIResponse = {
          id: responseId,
          object: "response",
          created_at: Math.floor(Date.now() / 1000),
          model,
          output: [completedItem],
          status: "completed",
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens,
          },
        };
        await writeSSEEventWithType(writer, "response.completed", {
          type: "response.completed",
          response: finalResponse,
        });

        await writeSSEDone(writer);
      },
    });
  }

  private enhanceMessagesForStructuredResponse(
    messages: Message[],
    responseFormat?: ResponseFormat,
    reasoningEffort?: ResponseRequest["reasoning_effort"],
  ): Message[] {
    const enhancedMessages = [...messages];

    if (responseFormat) {
      let structurePrompt = "";

      switch (responseFormat.type) {
        case "json_object":
          structurePrompt =
            "Please respond with a valid JSON object only. Do not include any text outside the JSON structure.";
          break;
        case "json_schema":
          if (responseFormat.json_schema) {
            structurePrompt = `Please respond with a valid JSON object that strictly follows this schema: ${JSON.stringify(responseFormat.json_schema.schema)}. The response should be named "${responseFormat.json_schema.name}". ${responseFormat.json_schema.description || ""}`;
          }
          break;
        default:
          structurePrompt =
            "Please provide a clear and structured text response.";
          break;
      }

      if (reasoningEffort) {
        const effortInstructions: Record<string, string> = {
          low: "Provide a direct and concise response.",
          medium:
            "Think through the problem step by step and provide a well-reasoned response.",
          high: "Carefully analyze all aspects of the problem, consider multiple perspectives, and provide a thoroughly reasoned response with detailed explanations.",
        };
        structurePrompt += ` ${effortInstructions[reasoningEffort]}`;
      }

      const systemMessageIndex = enhancedMessages.findIndex(
        (msg) => msg.role === "system",
      );
      const existing = enhancedMessages[systemMessageIndex];
      if (systemMessageIndex >= 0 && existing) {
        const existingText =
          typeof existing.content === "string"
            ? existing.content
            : Array.isArray(existing.content)
              ? existing.content
                  .filter(
                    (c): c is { type: "text"; text: string } =>
                      c.type === "text",
                  )
                  .map((c) => c.text)
                  .join("\n")
              : "";
        enhancedMessages[systemMessageIndex] = {
          role: existing.role,
          content: `${existingText}\n\n${structurePrompt}`,
        };
      } else {
        enhancedMessages.unshift({
          role: "system",
          content: structurePrompt,
        });
      }
    }

    return enhancedMessages;
  }

  private transformToResponsesFormat(
    data: OneMinChatResponse,
    model: string,
    responseFormat?: ResponseFormat,
  ): ResponsesAPIResponse {
    let content = extractOneMinContent(data);

    // Try to parse JSON if response format is JSON
    if (
      responseFormat?.type === "json_object" ||
      responseFormat?.type === "json_schema"
    ) {
      try {
        const parsed = JSON.parse(content);
        content = JSON.stringify(parsed);
      } catch {
        // If parsing fails, keep as string
        console.warn("Failed to parse response as JSON");
      }
    }

    const messageId = `msg-${crypto.randomUUID()}`;

    return {
      id: `resp-${crypto.randomUUID()}`,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      model,
      output: [
        {
          type: "message",
          id: messageId,
          role: "assistant",
          content: [{ type: "output_text", text: content }],
          status: "completed",
        },
      ],
      status: "completed",
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0,
        total_tokens: data.usage?.total_tokens || 0,
      },
    };
  }
}
