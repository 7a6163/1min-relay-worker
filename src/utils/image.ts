/**
 * Image processing utilities
 */

import type { ImageContent, MessageContent, TextContent } from "../types";

/**
 * Checks if URL is an image URL
 * @param url - URL to check
 * @returns boolean - True if URL is an image URL
 */
export function isImageUrl(url: string): boolean {
  const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"];
  const lowerUrl = url.toLowerCase();
  return (
    imageExtensions.some((ext) => lowerUrl.includes(ext)) ||
    lowerUrl.includes("data:image/") ||
    lowerUrl.includes("base64")
  );
}

/**
 * Extracts image URL from message content
 * @param content - Message content that may contain images
 * @returns Image URL if found, null otherwise
 */
export function extractImageFromContent(
  content: MessageContent,
): string | null {
  if (typeof content === "string") {
    return null;
  }

  if (Array.isArray(content)) {
    for (const item of content) {
      if (item.type === "image_url" && item.image_url?.url) {
        return item.image_url.url;
      }
    }
  }

  return null;
}

export interface ImageData {
  data: ArrayBuffer;
  mimeType: string;
}

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const SUPPORTED_MIME_TYPES = new Set(Object.keys(MIME_TO_EXT));

export function mimeToExtension(mimeType: string): string {
  const ext = MIME_TO_EXT[mimeType];
  if (!ext) {
    console.warn(`Unsupported MIME type "${mimeType}", defaulting to .png`);
  }
  return ext ?? ".png";
}

/**
 * Processes image URL (base64 or HTTP URL) and returns binary data with MIME type
 */
export async function processImageUrl(imageUrl: string): Promise<ImageData> {
  if (imageUrl.startsWith("data:image/")) {
    // Extract MIME type from data URI: data:image/jpeg;base64,...
    const mimeType = /^data:([^;,]+)/.exec(imageUrl)?.[1] ?? "image/png";
    const base64Data = imageUrl.split(",")[1];
    if (!base64Data) {
      throw new Error("Invalid base64 image format");
    }

    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return { data: bytes.buffer, mimeType };
  } else {
    // Handle HTTP URL
    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; 1min-relay-worker/1.0; +https://1min.ai)",
      },
    });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch image: ${response.status} ${response.statusText}`,
      );
    }
    const rawMime = response.headers.get("content-type")?.split(";")[0]?.trim();
    const mimeType =
      rawMime && SUPPORTED_MIME_TYPES.has(rawMime) ? rawMime : "image/png";
    return { data: await response.arrayBuffer(), mimeType };
  }
}

/**
 * Uploads image to 1min.ai asset API
 * @param imageData - Image data with binary content and MIME type
 * @param apiKey - API key for authentication
 * @param assetUrl - Asset API URL
 * @returns Promise<string> - Image path from API response
 */
export async function uploadImageToAsset(
  imageData: ImageData,
  apiKey: string,
  assetUrl: string,
): Promise<string> {
  const formData = new FormData();
  const ext = mimeToExtension(imageData.mimeType);
  const filename = `relay${crypto.randomUUID()}${ext}`;
  const blob = new Blob([imageData.data], { type: imageData.mimeType });

  formData.append("asset", blob, filename);

  const response = await fetch(assetUrl, {
    method: "POST",
    headers: {
      "API-KEY": apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to upload image: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  const result = (await response.json()) as { fileContent?: { path: string } };

  if (!result.fileContent?.path) {
    throw new Error("No image path returned from asset API");
  }

  return result.fileContent.path;
}

/**
 * Extracts text content from mixed content array
 * @param content - Mixed content array
 * @returns Combined text content
 */
export function extractTextFromContent(
  content: (TextContent | ImageContent)[],
): string {
  return content
    .filter((item): item is TextContent => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}
