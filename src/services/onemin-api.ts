/**
 * 1min.ai API service layer
 */

import {
  DEFAULT_IMAGE_QUALITY,
  IMAGE_MODELS_REQUIRING_QUALITY,
  WHISPER_MODEL_IDS,
} from "../constants/config";
import type {
  Env,
  Message,
  OneMinChatResponse,
  OneMinImageResponse,
  OneMinPromptObject,
  OneMinRequestBody,
} from "../types";
import { ApiError } from "../utils/errors";
import { processImageUrl, uploadImageToAsset } from "../utils/image";
import { extractTextFromMessageContent } from "../utils/message-processing";
import type { WebSearchConfig } from "../utils/model-parser";
import { describeUpstreamError } from "../utils/upstream-error";
import { isVisionModel } from "./model-registry";

// Converts message array to a single prompt string for the 1min.ai API
function formatConversationHistory(
  messages: Message[],
  newInput: string = "",
): string {
  let formattedHistory = "";

  for (const message of messages) {
    const role = message.role;
    const content = extractTextFromMessageContent(message.content);

    if (role === "system") {
      formattedHistory += `System: ${content}\n\n`;
    } else if (role === "user") {
      formattedHistory += `Human: ${content}\n\n`;
    } else if (role === "assistant") {
      formattedHistory += `Assistant: ${content}\n\n`;
    } else if (role === "tool" || role === "function") {
      formattedHistory += `Tool: ${content}\n\n`;
    }
  }

  if (newInput) {
    formattedHistory += `Human: ${newInput}\n\n`;
  }

  return formattedHistory;
}

export class OneMinApiService {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  async sendChatRequest(
    requestBody: OneMinRequestBody,
    isStreaming: boolean = false,
    apiKey?: string,
  ): Promise<Response> {
    const apiUrl = isStreaming
      ? `${this.env.ONE_MIN_CHAT_API_URL}?isStreaming=true`
      : this.env.ONE_MIN_CHAT_API_URL;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (apiKey) {
      headers["API-KEY"] = apiKey;
    }

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const rawErrorBody = await response.text().catch(() => "(unreadable)");
        const errorBody = rawErrorBody.slice(0, 500);
        console.error(
          `1min.ai API error: ${response.status} ${response.statusText}`,
          {
            url: apiUrl,
            model: requestBody.model,
            errorBody,
          },
        );

        // If the error might be related to webSearch, try graceful degradation
        const webSearch =
          requestBody.promptObject?.settings?.webSearchSettings?.webSearch;
        if (response.status === 400 && webSearch) {
          console.warn(
            "Attempting graceful degradation: removing webSearch parameters",
          );
          const fallbackRequestBody =
            this.createFallbackRequestBody(requestBody);

          const fallbackResponse = await fetch(apiUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(fallbackRequestBody),
          });

          if (fallbackResponse.ok) {
            console.warn("Graceful degradation successful");
            return fallbackResponse;
          }
        }

        const upstream = describeUpstreamError(response.status, rawErrorBody);
        throw new ApiError(upstream.message, response.status, upstream.code);
      }

      return response;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error("Network error in sendChatRequest:", error);
      throw error;
    }
  }

  private createFallbackRequestBody(
    originalRequestBody: OneMinRequestBody,
  ): OneMinRequestBody {
    const { settings, ...restPrompt } = originalRequestBody.promptObject;
    return {
      ...originalRequestBody,
      promptObject: {
        ...restPrompt,
        settings: settings
          ? {
              ...settings,
              webSearchSettings: { webSearch: false },
            }
          : undefined,
      },
    };
  }

  async sendImageRequest(
    requestBody: OneMinRequestBody,
    apiKey?: string,
  ): Promise<OneMinImageResponse> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (apiKey) {
      headers["API-KEY"] = apiKey;
    }

    const response = await fetch(
      `${this.env.ONE_MIN_API_URL}?isStreaming=false`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      },
    );

    if (!response.ok) {
      const rawErrorBody = await response.text().catch(() => "(unreadable)");
      const errorBody = rawErrorBody.slice(0, 500);
      console.error("1min.ai image API error:", errorBody);
      const upstream = describeUpstreamError(response.status, rawErrorBody);
      throw new ApiError(upstream.message, response.status, upstream.code);
    }

    const data = await response.json();
    return data as OneMinImageResponse;
  }

  // Note: the 1min.ai Chat with AI API has no sampling parameters
  // (temperature/max_tokens) — see docs.1min.ai/docs/api/chat-with-ai-api.
  async buildChatRequestBody(
    messages: Message[],
    model: string,
    apiKey: string,
    webSearchConfig?: WebSearchConfig,
  ): Promise<OneMinRequestBody> {
    // Process images from the latest user message
    const imagePaths: string[] = [];
    const latestMessage =
      messages && messages.length > 0 ? messages[messages.length - 1] : null;

    if (latestMessage && Array.isArray(latestMessage.content)) {
      for (const item of latestMessage.content) {
        if (item.type === "image_url" && item.image_url?.url) {
          if (!(await isVisionModel(model, this.env))) {
            throw new ApiError(
              `Model '${model}' does not support image inputs`,
              400,
            );
          }

          try {
            const imageData = await processImageUrl(item.image_url.url);
            const imagePath = await uploadImageToAsset(
              imageData,
              apiKey,
              this.env.ONE_MIN_ASSET_URL,
            );
            imagePaths.push(imagePath);
          } catch (error) {
            console.error("Error processing image:", error);
            throw new ApiError("Failed to process image attachment", 422);
          }
        }
      }
    }

    const formattedHistory = formatConversationHistory(messages, "");

    const promptObject: OneMinPromptObject = {
      prompt: formattedHistory,
      settings: {
        historySettings: {
          isMixed: false,
        },
        withMemories: false,
      },
    };

    // Add web search settings if enabled
    if (webSearchConfig?.webSearch) {
      promptObject.settings = {
        ...promptObject.settings,
        webSearchSettings: {
          webSearch: true,
          numOfSite: webSearchConfig.numOfSite,
          maxWord: webSearchConfig.maxWord,
        },
      };
    }

    // Add image attachments if any were uploaded
    if (imagePaths.length > 0) {
      promptObject.attachments = {
        images: imagePaths,
      };
    }

    return {
      type: "UNIFY_CHAT_WITH_AI",
      model: model,
      promptObject,
    };
  }

  buildImageRequestBody(
    prompt: string,
    model: string,
    n?: number,
    size?: string,
    quality?: string,
  ): OneMinRequestBody {
    const promptObject: OneMinPromptObject = {
      prompt: prompt,
      n: n ?? 1,
      size: size ?? "1024x1024",
    };

    // Some models reject a request that omits `quality`. Forward the client's
    // value when given, and supply a default for the models that require one —
    // dropping it silently made those models unusable through the relay.
    const effectiveQuality =
      quality ??
      (IMAGE_MODELS_REQUIRING_QUALITY.has(model)
        ? DEFAULT_IMAGE_QUALITY
        : undefined);
    if (effectiveQuality) {
      promptObject.quality = effectiveQuality;
    }

    return {
      type: "IMAGE_GENERATOR",
      model: model,
      promptObject,
    };
  }

  buildTextToSpeechRequestBody(
    text: string,
    model: string,
    voice: string,
    responseFormat: string,
    speed?: number,
  ): OneMinRequestBody {
    const promptObject: OneMinPromptObject = {
      text,
      voice,
      response_format: responseFormat,
    };

    if (speed !== undefined) {
      promptObject.speed = speed;
    }

    return {
      type: "TEXT_TO_SPEECH",
      model,
      promptObject,
    };
  }

  /**
   * Google Speech models use `language` in promptObject;
   * Whisper-1 uses `response_format` instead.
   */
  buildSpeechToTextRequestBody(
    audioUrl: string,
    model: string,
    language?: string,
    responseFormat?: string,
    prompt?: string,
    temperature?: number,
  ): OneMinRequestBody {
    const isWhisperModel = WHISPER_MODEL_IDS.has(model);

    const promptObject: OneMinPromptObject = {
      prompt: prompt ?? "",
      audioUrl,
    };

    if (isWhisperModel) {
      promptObject.response_format = responseFormat ?? "text";
      if (language) {
        promptObject.language = language;
      }
      if (temperature !== undefined) {
        promptObject.temperature = temperature;
      }
    } else {
      // Google Speech models use language instead of response_format/temperature
      if (language) {
        promptObject.language = language;
      }
    }

    return {
      type: "SPEECH_TO_TEXT",
      model,
      promptObject,
    };
  }

  buildAudioTranslatorRequestBody(
    audioUrl: string,
    model: string,
    responseFormat?: string,
    temperature?: number,
    prompt?: string,
  ): OneMinRequestBody {
    const promptObject: OneMinPromptObject = {
      prompt: prompt ?? "",
      audioUrl,
    };

    // Only Whisper models support response_format and temperature
    if (WHISPER_MODEL_IDS.has(model)) {
      promptObject.response_format = responseFormat ?? "text";
      if (temperature !== undefined) {
        promptObject.temperature = temperature;
      }
    }

    return {
      type: "AUDIO_TRANSLATOR",
      model,
      promptObject,
    };
  }

  async sendAudioRequest(
    requestBody: OneMinRequestBody,
    apiKey?: string,
  ): Promise<OneMinChatResponse> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (apiKey) {
      headers["API-KEY"] = apiKey;
    }

    const response = await fetch(
      `${this.env.ONE_MIN_API_URL}?isStreaming=false`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      },
    );

    if (!response.ok) {
      const rawError = await response.text().catch(() => "(unreadable)");
      console.error("1min.ai audio API error:", rawError.slice(0, 500));
      const upstream = describeUpstreamError(response.status, rawError);
      throw new ApiError(upstream.message, response.status, upstream.code);
    }

    return (await response.json()) as OneMinChatResponse;
  }
}
