import { describe, expect, it } from "vitest";
import type { OneMinChatResponse } from "../src/types/responses";
import {
  extractFinishReason,
  extractOneMinUsage,
} from "../src/utils/response";

// Shape captured from a live 1min.ai chat response.
const LIVE_METADATA = {
  credit: 45,
  inputToken: 98,
  totalToken: 101,
  inputCredit: 44,
  outputToken: 3,
  promptToken: 11,
  finishReason: "stop",
  outputCredit: 1,
  executionTime: 0.365,
};

function response(
  metadata?: Record<string, unknown>,
): OneMinChatResponse {
  return {
    aiRecord: {
      ...(metadata ? { metadata } : {}),
      aiRecordDetail: { resultObject: ["Pong"] },
    },
  } as OneMinChatResponse;
}

describe("extractOneMinUsage", () => {
  it("reads the upstream token counts", () => {
    expect(extractOneMinUsage(response(LIVE_METADATA))).toEqual({
      promptTokens: 98,
      completionTokens: 3,
      totalTokens: 101,
      finishReason: "stop",
    });
  });

  it("returns null when there is no aiRecord at all", () => {
    expect(extractOneMinUsage({} as OneMinChatResponse)).toBeNull();
  });

  it("returns null when metadata carries no token counts", () => {
    // Image records put moderation info here; TTS records leave it empty.
    expect(
      extractOneMinUsage(
        response({ resultModeration: { status: "unknown" } }),
      ),
    ).toBeNull();
    expect(extractOneMinUsage(response({}))).toBeNull();
  });

  it("derives the total when the upstream omits it", () => {
    expect(
      extractOneMinUsage(response({ inputToken: 10, outputToken: 4 })),
    ).toEqual({
      promptTokens: 10,
      completionTokens: 4,
      totalTokens: 14,
      finishReason: undefined,
    });
  });

  it("tolerates a partial count", () => {
    expect(extractOneMinUsage(response({ inputToken: 7 }))).toEqual({
      promptTokens: 7,
      completionTokens: 0,
      totalTokens: 7,
      finishReason: undefined,
    });
  });

  it("treats an all-zero count as unaccounted rather than free", () => {
    // Seen against the live upstream: metadata present, every count zero, for
    // a request that obviously consumed tokens. Reporting a confident 0 to a
    // client that meters on usage is worse than falling back to an estimate.
    expect(
      extractOneMinUsage(
        response({ inputToken: 0, outputToken: 0, totalToken: 0 }),
      ),
    ).toBeNull();
  });

  it("keeps a zero completion when the prompt was counted", () => {
    // An empty answer is legitimate; an uncounted prompt is not.
    expect(
      extractOneMinUsage(response({ inputToken: 12, outputToken: 0 })),
    ).toEqual({
      promptTokens: 12,
      completionTokens: 0,
      totalTokens: 12,
      finishReason: undefined,
    });
  });

  it("does not read a top-level usage field", () => {
    // The upstream never sends one; reading it is what produced 0/0/0 before.
    const withFakeUsage = {
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      aiRecord: { aiRecordDetail: { resultObject: ["x"] } },
    } as unknown as OneMinChatResponse;
    expect(extractOneMinUsage(withFakeUsage)).toBeNull();
  });
});

describe("extractFinishReason", () => {
  const withReason = (finishReason?: unknown) =>
    ({ aiRecord: { metadata: { finishReason } } }) as never;

  it("passes through the reasons OpenAI defines", () => {
    expect(extractFinishReason(withReason("stop"))).toBe("stop");
    expect(extractFinishReason(withReason("length"))).toBe("length");
    expect(extractFinishReason(withReason("content_filter"))).toBe(
      "content_filter",
    );
    expect(extractFinishReason(withReason("tool_calls"))).toBe("tool_calls");
  });

  it("maps a provider's own spelling onto the closed set", () => {
    // Measured: Cohere answers "complete" for an ordinary completion, and the
    // upstream forwards each provider's wording unchanged.
    expect(extractFinishReason(withReason("complete"))).toBe("stop");
    expect(extractFinishReason(withReason("MAX_TOKENS"))).toBe("length");
    expect(extractFinishReason(withReason(" Safety "))).toBe("content_filter");
    expect(extractFinishReason(withReason("tool_use"))).toBe("tool_calls");
  });

  it("falls back to stop when the upstream reports nothing usable", () => {
    // glm-5.3 omits finishReason entirely.
    expect(extractFinishReason(withReason(undefined))).toBe("stop");
    expect(extractFinishReason(withReason(42))).toBe("stop");
    expect(extractFinishReason({} as never)).toBe("stop");
  });

  it("survives token counts that would make extractOneMinUsage give up", () => {
    // The reason matters most exactly when the counts are absent or zero, so it
    // is read straight off the record instead of through the usage helper.
    const record = {
      aiRecord: { metadata: { inputToken: 0, outputToken: 0, finishReason: "length" } },
    } as never;
    expect(extractOneMinUsage(record)).toBeNull();
    expect(extractFinishReason(record)).toBe("length");
  });
});
