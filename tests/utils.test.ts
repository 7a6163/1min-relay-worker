/**
 * Unit coverage for the utility layer that the endpoint tests only reach
 * through the happy path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getClientId, RateLimiter } from "../src/middleware/rate-limit";
import type { Message, OneMinChatResponse } from "../src/types";
import {
  ApiError,
  AuthenticationError,
  ModelNotFoundError,
  RateLimitError,
  toAnthropicError,
  toOpenAIError,
  ValidationError,
} from "../src/utils/errors";
import {
  extractImageFromContent,
  mimeToExtension,
  processImageUrl,
  uploadImageToAsset,
} from "../src/utils/image";
import {
  extractAllMessageText,
  extractTextFromMessageContent,
  processMessagesWithImageCheck,
} from "../src/utils/message-processing";
import {
  getWebSearchConfig,
  parseAndGetConfig,
  parseModelName,
} from "../src/utils/model-parser";
import {
  createSuccessResponse,
  extractFinishReason,
  extractOneMinContent,
} from "../src/utils/response";
import {
  createOpenAISSEChunk,
  createSSEResponse,
  writeSSEDone,
  writeSSEEvent,
  writeSSEEventWithType,
} from "../src/utils/sse";
import {
  calculateAnthropicRequestTokens,
  calculateChatRequestTokens,
  calculateResponseRequestTokens,
  calculateTokens,
  estimateInputTokens,
} from "../src/utils/tokens";
import { SimpleUTF8Decoder } from "../src/utils/utf8-decoder";
import { fakeKV } from "./helpers";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("errors", () => {
  it("maps every typed error to OpenAI shape", () => {
    expect(toOpenAIError(new ValidationError("bad", "field", "code"))).toEqual({
      message: "bad",
      type: "invalid_request_error",
      param: "field",
      code: "code",
      status: 400,
    });
    expect(toOpenAIError(new AuthenticationError())).toMatchObject({
      status: 401,
      message: "Invalid or missing API key",
    });
    expect(toOpenAIError(new RateLimitError("slow down"))).toMatchObject({
      status: 429,
      code: "rate_limit_exceeded",
    });
    expect(toOpenAIError(new ModelNotFoundError("m"))).toMatchObject({
      status: 404,
      message: "The model 'm' does not exist",
    });
    expect(
      toOpenAIError(new ApiError("upstream", 502, "bad_gateway")),
    ).toMatchObject({ status: 502, code: "bad_gateway" });
  });

  it("hides unknown failures", () => {
    expect(toOpenAIError(new TypeError("internal detail"))).toMatchObject({
      message: "An internal error occurred",
      status: 500,
    });
    expect(toOpenAIError("a string")).toMatchObject({
      message: "An unknown error occurred",
      status: 500,
    });
  });

  it("maps every typed error to Anthropic shape", () => {
    expect(toAnthropicError(new AuthenticationError("no key"))).toEqual({
      type: "authentication_error",
      message: "no key",
      status: 401,
    });
    expect(toAnthropicError(new RateLimitError("slow"))).toMatchObject({
      type: "rate_limit_error",
    });
    expect(toAnthropicError(new ModelNotFoundError("m"))).toMatchObject({
      type: "not_found_error",
      status: 404,
    });
    expect(toAnthropicError(new ValidationError("bad"))).toMatchObject({
      type: "invalid_request_error",
      status: 400,
    });
    expect(toAnthropicError(new ApiError("boom", 502))).toMatchObject({
      type: "api_error",
      status: 502,
    });
    expect(toAnthropicError(new Error("leak"))).toMatchObject({
      message: "An internal error occurred",
    });
    expect(toAnthropicError(null)).toMatchObject({
      message: "An unknown error occurred",
    });
  });
});

describe("model-parser", () => {
  it("accepts a plain model name", () => {
    expect(parseModelName("  gpt-4o  ")).toEqual({
      originalModel: "gpt-4o",
      hasOnlineSuffix: false,
      isValid: true,
    });
  });

  it("accepts the :online suffix", () => {
    expect(parseModelName("gpt-4o:online")).toEqual({
      originalModel: "gpt-4o",
      hasOnlineSuffix: true,
      isValid: true,
    });
  });

  it("rejects an empty name", () => {
    expect(parseModelName("")).toMatchObject({ isValid: false });
    expect(parseModelName(":online")).toMatchObject({
      isValid: false,
      hasOnlineSuffix: true,
    });
  });

  it("rejects any other colon suffix", () => {
    expect(parseModelName("gpt-4o:fast")).toMatchObject({
      isValid: false,
      error: "Invalid model name format. Only ':online' suffix is supported",
    });
  });

  it("defaults and clamps the web search config", () => {
    expect(getWebSearchConfig()).toEqual({
      webSearch: true,
      numOfSite: 1,
      maxWord: 500,
    });
    expect(
      getWebSearchConfig({
        WEB_SEARCH_NUM_OF_SITE: "not a number",
        WEB_SEARCH_MAX_WORD: "0",
      }),
    ).toEqual({ webSearch: true, numOfSite: 1, maxWord: 500 });
  });

  it("returns the parse error through parseAndGetConfig", () => {
    expect(parseAndGetConfig("a:b")).toMatchObject({ cleanModel: "" });
    expect(parseAndGetConfig("a")).toEqual({ cleanModel: "a" });
    expect(parseAndGetConfig("a:online")).toMatchObject({
      cleanModel: "a",
      webSearchConfig: { webSearch: true },
    });
  });
});

describe("message processing", () => {
  it("extracts text from both content shapes", () => {
    expect(extractTextFromMessageContent("plain")).toBe("plain");
    expect(
      extractTextFromMessageContent([
        { type: "text", text: "one" },
        { type: "image_url", image_url: { url: "https://x/y.png" } },
        { type: "text", text: "two" },
      ]),
    ).toBe("one\ntwo");
  });

  it("collects all message text for token counting", () => {
    expect(
      extractAllMessageText([
        { content: "a" },
        { content: undefined },
        { content: [{ type: "text", text: "b" }, { type: "image" }, null] },
      ]),
    ).toBe("a b");
  });

  it("flags and normalises image messages", () => {
    const messages: Message[] = [
      { role: "user", content: "no image" },
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image_url", image_url: { url: "https://x/y.png" } },
        ],
      },
    ];
    const { processedMessages, hasImages } =
      processMessagesWithImageCheck(messages);
    expect(hasImages).toBe(true);
    expect(processedMessages[1]?.content).toEqual([
      { type: "text", text: "look" },
      { type: "image_url", image_url: { url: "https://x/y.png" } },
    ]);
  });

  it("leaves image-free messages untouched", () => {
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ];
    const { hasImages, processedMessages } =
      processMessagesWithImageCheck(messages);
    expect(hasImages).toBe(false);
    expect(processedMessages[0]).toBe(messages[0]);
  });

  it("finds an image url in mixed content", () => {
    expect(extractImageFromContent("text only")).toBeNull();
    expect(extractImageFromContent([{ type: "text", text: "x" }])).toBeNull();
    expect(
      extractImageFromContent([
        { type: "image_url", image_url: { url: "https://x/y.png" } },
      ]),
    ).toBe("https://x/y.png");
  });
});

describe("tokens", () => {
  it("counts text", () => {
    expect(calculateTokens("hello world")).toBeGreaterThan(0);
    expect(calculateTokens("")).toBe(0);
  });

  it("counts each request body shape", () => {
    expect(estimateInputTokens([{ role: "user", content: "hi" }])).toBe(1);
    expect(
      calculateChatRequestTokens({
        messages: [{ role: "user", content: "hi" }],
      }),
    ).toBe(1);
    expect(calculateChatRequestTokens({} as never)).toBe(0);
    expect(calculateResponseRequestTokens({ input: "hi there" })).toBe(2);
    expect(
      calculateResponseRequestTokens({
        messages: [{ role: "user", content: "hi there" }],
      }),
    ).toBe(2);
    expect(calculateResponseRequestTokens({})).toBe(0);
    expect(
      calculateAnthropicRequestTokens({
        model: "m",
        max_tokens: 1,
        system: "be nice",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).toBeGreaterThan(1);
    expect(
      calculateAnthropicRequestTokens({
        model: "m",
        max_tokens: 1,
        system: [{ type: "text", text: "be nice" }],
        messages: [],
      }),
    ).toBeGreaterThan(0);
  });
});

describe("image utils", () => {
  it("maps MIME types to extensions", () => {
    expect(mimeToExtension("image/jpeg")).toBe(".jpg");
    expect(mimeToExtension("image/tiff")).toBe(".png");
  });

  it("decodes a base64 data URI", async () => {
    const { data, mimeType } = await processImageUrl(
      "data:image/jpeg;base64,aGk=",
    );
    expect(mimeType).toBe("image/jpeg");
    expect(new TextDecoder().decode(data)).toBe("hi");
  });

  it("rejects a malformed data URI", async () => {
    await expect(processImageUrl("data:image/png;base64,")).rejects.toThrow(
      "Invalid base64 image format",
    );
  });

  it("refuses a non-HTTPS URL", async () => {
    await expect(processImageUrl("http://x/y.png")).rejects.toThrow(
      "Only HTTPS image URLs are supported",
    );
  });

  it("fetches an https image and normalises an odd content-type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2]), {
            headers: { "content-type": "image/svg+xml; charset=utf-8" },
          }),
      ),
    );
    const { mimeType } = await processImageUrl("https://x/y.svg");
    expect(mimeType).toBe("image/png");
  });

  it("reports a failed image fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("gone", { status: 404 })),
    );
    await expect(processImageUrl("https://x/y.png")).rejects.toThrow(
      "Failed to fetch image: 404",
    );
  });

  it("reports a failed upload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("denied", { status: 403 })),
    );
    await expect(
      uploadImageToAsset(
        { data: new ArrayBuffer(2), mimeType: "image/png" },
        "key",
        "https://assets.test",
      ),
    ).rejects.toThrow("Failed to upload image: 403");
  });

  it("reports an upload response with no path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({})),
    );
    await expect(
      uploadImageToAsset(
        { data: new ArrayBuffer(2), mimeType: "image/png" },
        "key",
        "https://assets.test",
      ),
    ).rejects.toThrow("No image path returned");
  });
});

describe("response helpers", () => {
  it("prefers resultObject and warns on an empty record", () => {
    expect(
      extractOneMinContent({
        aiRecord: { aiRecordDetail: { resultObject: ["from record"] } },
      }),
    ).toBe("from record");
    expect(extractOneMinContent({ content: "from content" })).toBe(
      "from content",
    );
    expect(extractOneMinContent({})).toBe("");
  });

  it("normalises finish reasons", () => {
    const withReason = (finishReason: unknown) =>
      ({
        aiRecord: {
          aiRecordDetail: { resultObject: [] },
          metadata: { finishReason },
        },
      }) as OneMinChatResponse;
    expect(extractFinishReason(withReason("  MAX_TOKENS "))).toBe("length");
    expect(extractFinishReason(withReason("tool_use"))).toBe("tool_calls");
    expect(extractFinishReason(withReason("safety"))).toBe("content_filter");
    expect(extractFinishReason(withReason("complete"))).toBe("stop");
    expect(extractFinishReason(withReason(undefined))).toBe("stop");
    expect(extractFinishReason({})).toBe("stop");
  });

  it("builds a JSON success response", async () => {
    const res = createSuccessResponse({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("sse writers", () => {
  it("writes data, typed and done frames", async () => {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    // Read concurrently: the stream's write buffer only holds one chunk.
    const collected = new Response(readable).text();

    await writeSSEEvent(writer, createOpenAISSEChunk("m", { content: "hi" }));
    await writeSSEEventWithType(writer, "ping", { type: "ping" });
    await writeSSEDone(writer);
    await writer.close();

    const text = await collected;
    expect(text).toContain('"content":"hi"');
    expect(text).toContain("event: ping");
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("uses a supplied chunk id and finish reason", () => {
    const chunk = createOpenAISSEChunk("m", {}, "stop", "chatcmpl-fixed");
    expect(chunk.id).toBe("chatcmpl-fixed");
    expect(chunk.choices[0]?.finish_reason).toBe("stop");
  });

  it("sets the SSE response headers", () => {
    const res = createSSEResponse(new ReadableStream());
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
  });
});

describe("SimpleUTF8Decoder", () => {
  it("holds back a split multi-byte sequence until it completes", () => {
    const decoder = new SimpleUTF8Decoder();
    // "€" is e2 82 ac
    expect(decoder.decode(new Uint8Array([0xe2, 0x82]))).toBe("");
    expect(decoder.decode(new Uint8Array([0xac]))).toBe("€");
  });
});

describe("getClientId", () => {
  const req = (headers: Record<string, string>) =>
    new Request("https://x/", { headers });

  it("hashes the Authorization header", async () => {
    const id = await getClientId(req({ Authorization: "Bearer k" }));
    expect(id).toMatch(/^auth:[0-9a-f]{16}$/);
    expect(await getClientId(req({ Authorization: "Bearer k" }))).toBe(id);
    expect(await getClientId(req({ Authorization: "Bearer other" }))).not.toBe(
      id,
    );
  });

  it("falls back through the IP headers", async () => {
    expect(await getClientId(req({ "CF-Connecting-IP": "1.2.3.4" }))).toBe(
      "ip:1.2.3.4",
    );
    expect(
      await getClientId(req({ "X-Forwarded-For": "5.6.7.8, 9.9.9.9" })),
    ).toBe("ip:5.6.7.8");
    expect(await getClientId(req({}))).toBe("anonymous");
  });
});

describe("RateLimiter", () => {
  it("allows everything when no KV namespace is bound", async () => {
    const limiter = new RateLimiter({} as never);
    expect(await limiter.checkRateLimit("client", 10)).toEqual({
      allowed: true,
    });
  });

  it("honours a custom config", async () => {
    const kv = fakeKV();
    const limiter = new RateLimiter({ RATE_LIMIT_STORE: kv } as never, {
      windowMs: 1000,
      maxRequests: 1,
      maxTokens: 0,
    });
    expect(await limiter.checkRateLimit("c")).toEqual({ allowed: true });
    expect(await limiter.checkRateLimit("c")).toEqual({ allowed: false });
  });
});
