/**
 * Shared test harness: a fake 1min.ai upstream plus the bindings and
 * ExecutionContext `app.request()` needs.
 */

import { vi } from "vitest";
import type { Env, OneMinModelEntry } from "../src/types";

export const UPSTREAM = {
  chat: "https://upstream.test/chat-with-ai",
  features: "https://upstream.test/features",
  asset: "https://upstream.test/assets",
  models: "https://upstream.test/models",
};

export const CHAT_MODEL = "open-mistral-nemo";
export const VISION_MODEL = "gpt-4o";
export const IMAGE_MODEL = "gpt-image-1-mini";
export const SPEECH_MODEL = "whisper-1";

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    ONE_MIN_CHAT_API_URL: UPSTREAM.chat,
    ONE_MIN_API_URL: UPSTREAM.features,
    ONE_MIN_ASSET_URL: UPSTREAM.asset,
    ONE_MIN_MODELS_API_URL: UPSTREAM.models,
    ...overrides,
  };
}

/** Hono needs an ExecutionContext for the cache-warmup `waitUntil`. */
export const testCtx = {
  waitUntil: (p: Promise<unknown>) => {
    void Promise.resolve(p).catch(() => {});
  },
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

export function modelEntry(
  overrides: Partial<OneMinModelEntry> = {},
): OneMinModelEntry {
  return {
    modelId: "some-model",
    name: "Some Model",
    provider: "someone",
    status: "ACTIVE",
    features: ["UNIFY_CHAT_WITH_AI"],
    modality: { INPUT: ["text"], OUTPUT: ["text"] },
    creditMetadata: {},
    ...overrides,
  };
}

export const MODELS_BY_FEATURE: Record<string, OneMinModelEntry[]> = {
  UNIFY_CHAT_WITH_AI: [
    modelEntry({ modelId: CHAT_MODEL, provider: "mistral" }),
    modelEntry({
      modelId: VISION_MODEL,
      provider: "openai",
      features: ["UNIFY_CHAT_WITH_AI", "CODE_GENERATOR"],
      modality: { INPUT: ["text", "image"], OUTPUT: ["text"] },
    }),
  ],
  IMAGE_GENERATOR: [
    modelEntry({
      modelId: IMAGE_MODEL,
      provider: "openai",
      features: ["IMAGE_GENERATOR"],
      modality: { INPUT: ["text"], OUTPUT: ["image"] },
    }),
  ],
  SPEECH_TO_TEXT: [
    modelEntry({
      modelId: SPEECH_MODEL,
      provider: "openai",
      features: ["SPEECH_TO_TEXT"],
      modality: { INPUT: ["audio"], OUTPUT: ["text"] },
    }),
  ],
};

export interface UpstreamCall {
  url: string;
  init: RequestInit;
  body: unknown;
}

type Handler = (
  url: string,
  init: RequestInit,
) => Response | undefined | Promise<Response | undefined>;

export interface FetchMock {
  calls: UpstreamCall[];
  /** Register a responder; first one to return a Response wins. */
  on(handler: Handler): void;
  /** Respond to every request whose URL starts with `prefix`. */
  reply(prefix: string, response: () => Response): void;
  callsTo(prefix: string): UpstreamCall[];
}

/** Replace global fetch with a router that serves the models API by default. */
export function installFetchMock(): FetchMock {
  const calls: UpstreamCall[] = [];
  const handlers: Handler[] = [];

  const impl = async (input: unknown, init: RequestInit = {}) => {
    const url =
      typeof input === "string"
        ? input
        : ((input as Request).url ?? String(input));
    let body: unknown;
    if (typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    } else {
      body = init.body;
    }
    calls.push({ url, init, body });

    for (const handler of handlers) {
      const response = await handler(url, init);
      if (response) return response;
    }

    if (url.startsWith(UPSTREAM.models)) {
      const feature = new URL(url).searchParams.get("feature") ?? "";
      return Response.json({ models: MODELS_BY_FEATURE[feature] ?? [] });
    }

    throw new Error(`unmocked fetch: ${url}`);
  };

  vi.stubGlobal("fetch", vi.fn(impl));

  return {
    calls,
    on: (handler) => handlers.push(handler),
    reply: (prefix, response) =>
      handlers.push((url) => (url.startsWith(prefix) ? response() : undefined)),
    callsTo: (prefix) => calls.filter((c) => c.url.startsWith(prefix)),
  };
}

/** A non-streaming chat/audio record as 1min.ai returns it. */
export function oneMinChatResponse(
  text: string,
  metadata?: Record<string, unknown>,
): Response {
  return Response.json({
    aiRecord: {
      aiRecordDetail: { resultObject: [text] },
      ...(metadata ? { metadata } : {}),
    },
  });
}

/** An SSE streaming response body in the upstream's wire format. */
export function sseResponse(blocks: string[]): Response {
  const body = blocks.map((b) => `${b}\n\n`).join("");
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
  );
}

export function contentBlock(text: string): string {
  return `event: content\ndata: ${JSON.stringify({ content: text })}`;
}

/** Read a streamed Response body to a string. */
export async function readAll(response: Response): Promise<string> {
  return await response.text();
}

/** Minimal in-memory KVNamespace stand-in. */
export function fakeKV(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    get: vi.fn(async (key: string, type?: string) => {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === "json" ? JSON.parse(raw) : raw;
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  } as unknown as KVNamespace & { store: Map<string, string> };
}
