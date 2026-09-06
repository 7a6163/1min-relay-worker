/**
 * Whole-app plumbing: routing, CORS, auth, rate limiting, error shaping.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import app from "../src/index";
import {
  CHAT_MODEL,
  type FetchMock,
  fakeKV,
  IMAGE_MODEL,
  installFetchMock,
  oneMinChatResponse,
  SPEECH_MODEL,
  testCtx,
  testEnv,
  UPSTREAM,
  VISION_MODEL,
} from "./helpers";

let upstream: FetchMock;

beforeEach(() => {
  upstream = installFetchMock();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const call = (path: string, init?: RequestInit, env = testEnv()) =>
  app.request(path, init, env, testCtx);

const authed = (extra: RequestInit = {}): RequestInit => ({
  ...extra,
  headers: {
    Authorization: "Bearer test-key",
    "Content-Type": "application/json",
    ...(extra.headers as Record<string, string>),
  },
});

describe("root and 404", () => {
  it("serves the endpoint listing", async () => {
    const res = await call("http://localhost/");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("http://localhost/v1/chat/completions");
    expect(text).toContain("http://localhost/v1/models");
  });

  it("returns a JSON 404 for unknown paths", async () => {
    const res = await call("http://localhost/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not Found" });
  });
});

describe("CORS", () => {
  it("answers a preflight with the allowed headers", async () => {
    const res = await call("http://localhost/v1/chat/completions", {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain(
      "x-api-key",
    );
  });
});

describe("auth", () => {
  it("rejects a request with no key in OpenAI shape", async () => {
    const res = await call("http://localhost/v1/models");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: {
        message: "API key is required",
        type: "authentication_error",
        param: "authorization",
        code: "invalid_api_key",
      },
    });
  });

  it("rejects a request with no key in Anthropic shape on /v1/messages", async () => {
    const res = await call("http://localhost/v1/messages", { method: "POST" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      type: "error",
      error: { type: "authentication_error", message: "API key is required" },
    });
  });

  it("accepts x-api-key", async () => {
    const res = await call("http://localhost/v1/models", {
      headers: { "x-api-key": "test-key" },
    });
    expect(res.status).toBe(200);
  });

  it("enforces AUTH_TOKEN when configured", async () => {
    const env = testEnv({ AUTH_TOKEN: "secret" });
    const bad = await call("http://localhost/v1/models", authed(), env);
    expect(bad.status).toBe(401);
    expect((await bad.json()) as { error: { message: string } }).toMatchObject({
      error: { message: "Invalid API key" },
    });

    const good = await call(
      "http://localhost/v1/models",
      { headers: { Authorization: "Bearer secret" } },
      env,
    );
    expect(good.status).toBe(200);
  });
});

describe("GET /v1/models", () => {
  it("lists models with derived capabilities", async () => {
    const res = await call("http://localhost/v1/models", authed());
    const body = (await res.json()) as {
      object: string;
      data: Array<{
        id: string;
        owned_by: string;
        capabilities: Record<string, boolean>;
      }>;
    };

    expect(body.object).toBe("list");
    expect(body.data.map((m) => m.id)).toEqual([
      CHAT_MODEL,
      VISION_MODEL,
      IMAGE_MODEL,
      SPEECH_MODEL,
    ]);

    const vision = body.data.find((m) => m.id === VISION_MODEL);
    expect(vision?.owned_by).toBe("openai");
    expect(vision?.capabilities).toEqual({
      vision: true,
      code_interpreter: true,
      retrieval: true,
    });

    const image = body.data.find((m) => m.id === IMAGE_MODEL);
    expect(image?.capabilities.retrieval).toBe(false);
  });
});

describe("request body parsing", () => {
  for (const path of [
    "/v1/chat/completions",
    "/v1/responses",
    "/v1/messages",
  ]) {
    it(`rejects invalid JSON on ${path}`, async () => {
      const res = await call(
        `http://localhost${path}`,
        authed({ method: "POST", body: "{not json" }),
      );
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).toContain(
        "Invalid JSON in request body",
      );
    });
  }
});

describe("rate limiting", () => {
  const chatBody = JSON.stringify({
    model: CHAT_MODEL,
    messages: [{ role: "user", content: "hi" }],
  });

  it("allows and records a request when under the limit", async () => {
    upstream.reply(UPSTREAM.chat, () => oneMinChatResponse("ok"));
    const kv = fakeKV();
    const res = await call(
      "http://localhost/v1/chat/completions",
      authed({ method: "POST", body: chatBody }),
      testEnv({ RATE_LIMIT_STORE: kv }),
    );

    expect(res.status).toBe(200);
    const [entry] = [...kv.store.entries()];
    expect(entry?.[0]).toMatch(/^auth:[0-9a-f]{16}$/);
    expect(JSON.parse(entry?.[1] as string)).toMatchObject({
      requestCount: 1,
    });
  });

  it("rejects once the request count is spent", async () => {
    const kv = fakeKV();
    const clientId = [...(await primeClientId(kv, chatBody))][0] as string;
    kv.store.set(
      clientId,
      JSON.stringify({
        requestCount: 180,
        tokenCount: 0,
        windowStart: Date.now(),
      }),
    );

    const res = await call(
      "http://localhost/v1/chat/completions",
      authed({ method: "POST", body: chatBody }),
      testEnv({ RATE_LIMIT_STORE: kv }),
    );
    expect(res.status).toBe(429);
    expect(JSON.stringify(await res.json())).toContain("Rate limit exceeded");
  });

  it("rejects once the token budget is spent", async () => {
    const kv = fakeKV();
    const clientId = [...(await primeClientId(kv, chatBody))][0] as string;
    kv.store.set(
      clientId,
      JSON.stringify({
        requestCount: 1,
        tokenCount: 100_000,
        windowStart: Date.now(),
      }),
    );

    const res = await call(
      "http://localhost/v1/chat/completions",
      authed({ method: "POST", body: chatBody }),
      testEnv({ RATE_LIMIT_STORE: kv }),
    );
    expect(res.status).toBe(429);
  });

  it("starts a fresh window once the old one expired", async () => {
    upstream.reply(UPSTREAM.chat, () => oneMinChatResponse("ok"));
    const kv = fakeKV();
    const clientId = [...(await primeClientId(kv, chatBody))][0] as string;
    kv.store.set(
      clientId,
      JSON.stringify({
        requestCount: 180,
        tokenCount: 0,
        windowStart: Date.now() - 120_000,
      }),
    );

    const res = await call(
      "http://localhost/v1/chat/completions",
      authed({ method: "POST", body: chatBody }),
      testEnv({ RATE_LIMIT_STORE: kv }),
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(kv.store.get(clientId) as string)).toMatchObject({
      requestCount: 1,
    });
  });

  it("fails open when KV throws", async () => {
    upstream.reply(UPSTREAM.chat, () => oneMinChatResponse("ok"));
    const kv = fakeKV();
    vi.mocked(kv.get).mockRejectedValue(new Error("KV down"));

    const res = await call(
      "http://localhost/v1/chat/completions",
      authed({ method: "POST", body: chatBody }),
      testEnv({ RATE_LIMIT_STORE: kv }),
    );
    expect(res.status).toBe(200);
  });

  /** Run one allowed request so the KV key (a hash of the auth header) is known. */
  async function primeClientId(kv: KVNamespace, body: string) {
    upstream.reply(UPSTREAM.chat, () => oneMinChatResponse("ok"));
    await call(
      "http://localhost/v1/chat/completions",
      authed({ method: "POST", body }),
      testEnv({ RATE_LIMIT_STORE: kv }),
    );
    return (kv as unknown as { store: Map<string, string> }).store.keys();
  }
});

describe("unexpected errors", () => {
  it("collapses an unknown error to a generic 500", async () => {
    upstream.reply(UPSTREAM.chat, () => {
      throw new TypeError("socket exploded");
    });

    const res = await call(
      "http://localhost/v1/chat/completions",
      authed({
        method: "POST",
        body: JSON.stringify({
          model: CHAT_MODEL,
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: {
        message: "An internal error occurred",
        type: "api_error",
        param: null,
        code: null,
      },
    });
  });
});
