/**
 * Image generation endpoint handler
 */

import { DEFAULT_IMAGE_MODEL, ONE_MIN_ASSET_CDN_URL } from "../constants";
import { isImageGenerationModel } from "../services/model-registry";
import type {
  ImageGenerationRequest,
  ImageGenerationResponse,
  OneMinImageResponse,
} from "../types";
import { ApiError, createSuccessResponse, ValidationError } from "../utils";
import { BaseTextHandler } from "./base";

/**
 * Turn an upstream result entry into a URL the client can actually fetch.
 *
 * `resultObject` holds S3 *paths* (e.g. "images/2026_09_03_..._.png"), not
 * URLs — returning them verbatim handed clients a broken `url`. The signed
 * `temporaryUrl` on the response covers only the first result, so for n > 1
 * the remaining paths have no signed URL at all; the public asset CDN serves
 * every path.
 */
export function toAssetUrl(path: string, cdnBaseUrl: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${cdnBaseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export class ImageHandler extends BaseTextHandler {
  async handleImageGeneration(
    request: Request,
    apiKey?: string,
  ): Promise<Response> {
    const requestBody: ImageGenerationRequest = await request.json();

    if (!requestBody.prompt) {
      throw new ValidationError("Prompt field is required", "prompt");
    }

    // Only URL responses are supported: the upstream returns stored assets,
    // not inline image data. Say so instead of silently returning URLs.
    if (
      requestBody.response_format &&
      requestBody.response_format !== "url" &&
      requestBody.response_format !== "b64_json"
    ) {
      throw new ValidationError(
        `Unsupported response_format '${requestBody.response_format}'. Only 'url' is supported.`,
        "response_format",
      );
    }
    if (requestBody.response_format === "b64_json") {
      throw new ValidationError(
        "response_format 'b64_json' is not supported by this relay; the upstream API returns stored image assets. Use 'url'.",
        "response_format",
        "unsupported_response_format",
      );
    }

    const model = requestBody.model || DEFAULT_IMAGE_MODEL;

    if (!(await isImageGenerationModel(model, this.env))) {
      throw new ValidationError(
        `Model '${model}' does not support image generation`,
        "model",
        "model_not_supported",
      );
    }

    const requestBodyForAPI = this.apiService.buildImageRequestBody(
      requestBody.prompt,
      model,
      requestBody.n,
      requestBody.size,
      requestBody.quality,
    );

    const data = await this.apiService.sendImageRequest(
      requestBodyForAPI,
      apiKey,
    );

    const openAIResponse = this.transformToOpenAIFormat(data);
    return createSuccessResponse(openAIResponse);
  }

  private transformToOpenAIFormat(
    data: OneMinImageResponse,
  ): ImageGenerationResponse {
    const resultPaths = data.aiRecord?.aiRecordDetail?.resultObject;

    if (
      !resultPaths ||
      !Array.isArray(resultPaths) ||
      resultPaths.length === 0
    ) {
      throw new ApiError("No image results found in API response", 500);
    }

    const cdnBaseUrl = this.env.ONE_MIN_ASSET_CDN_URL || ONE_MIN_ASSET_CDN_URL;

    return {
      created: Math.floor(Date.now() / 1000),
      data: resultPaths.map((path: string) => ({
        url: toAssetUrl(path, cdnBaseUrl),
      })),
    };
  }
}
