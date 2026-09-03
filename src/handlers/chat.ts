/**
 * Chat completions endpoint handler
 */

import { DEFAULT_MODEL } from "../constants";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  Message,
  OneMinChatResponse,
} from "../types";
import {
  assertToolsUnsupported,
  calculateTokens,
  createSuccessResponse,
  estimateInputTokens,
  extractOneMinContent,
  extractOneMinUsage,
  ValidationError,
  validateModelAndMessages,
  type WebSearchConfig,
} from "../utils";
import {
  createOpenAISSEChunk,
  writeSSEDone,
  writeSSEEvent,
} from "../utils/sse";
import { executeStreamingPipeline } from "../utils/streaming";
import { BaseTextHandler } from "./base";

export class ChatHandler extends BaseTextHandler {
  async handleChatCompletionsWithBody(
    requestBody: ChatCompletionRequest,
    apiKey: string,
  ): Promise<Response> {
    assertToolsUnsupported(requestBody.tools);

    if (!requestBody.messages || !Array.isArray(requestBody.messages)) {
      throw new ValidationError(
        "Messages field is required and must be an array",
        "messages",
      );
    }

    const rawModel = requestBody.model || DEFAULT_MODEL;

    const { cleanModel, webSearchConfig, processedMessages } =
      await validateModelAndMessages(
        rawModel,
        requestBody.messages as Message[],
        this.env,
      );

    if (requestBody.stream) {
      return this.handleStreamingChat(
        processedMessages,
        cleanModel,
        apiKey,
        webSearchConfig,
      );
    } else {
      return this.handleNonStreamingChat(
        processedMessages,
        cleanModel,
        apiKey,
        webSearchConfig,
      );
    }
  }

  private async handleNonStreamingChat(
    messages: Message[],
    model: string,
    apiKey: string,
    webSearchConfig?: WebSearchConfig,
  ): Promise<Response> {
    const data = await this.sendNonStreamingRequest(
      messages,
      model,
      apiKey,
      webSearchConfig,
    );

    const openAIResponse = this.transformToOpenAIFormat(data, model, messages);
    return createSuccessResponse(openAIResponse);
  }

  private async handleStreamingChat(
    messages: Message[],
    model: string,
    apiKey: string,
    webSearchConfig?: WebSearchConfig,
  ): Promise<Response> {
    const response = await this.sendStreamingRequest(
      messages,
      model,
      apiKey,
      webSearchConfig,
    );

    return executeStreamingPipeline(response, {
      onChunk: async (writer, chunk) => {
        const returnChunk = createOpenAISSEChunk(
          model,
          { content: chunk },
          null,
        );
        await writeSSEEvent(writer, returnChunk);
      },
      onEnd: async (writer) => {
        const finalChunk = createOpenAISSEChunk(model, {}, "stop");
        await writeSSEEvent(writer, finalChunk);
        await writeSSEDone(writer);
      },
    });
  }

  private transformToOpenAIFormat(
    data: OneMinChatResponse,
    model: string,
    messages: Message[],
  ): ChatCompletionResponse {
    const content = extractOneMinContent(data);

    // The upstream reports usage under aiRecord.metadata; fall back to a local
    // estimate only when it is missing.
    const usage = extractOneMinUsage(data);
    const promptTokens = usage?.promptTokens ?? estimateInputTokens(messages);
    const completionTokens =
      usage?.completionTokens ?? calculateTokens(content, model);

    return {
      id: `chatcmpl-${crypto.randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content,
          },
          finish_reason: usage?.finishReason ?? "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: usage?.totalTokens ?? promptTokens + completionTokens,
      },
    };
  }
}
