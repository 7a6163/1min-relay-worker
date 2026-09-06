/**
 * POST /v1/chat/completions — OpenAI protocol translation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import type { OneMinRequestBody } from "../src/types";
import {
  CHAT_MODEL,
  contentBlock,
  type FetchMock,
  IMAGE_MODEL,
  installFetchMock,
  oneMinChatResponse,
  sseResponse,
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

function post(body: unknown, env = testEnv()) {
  return app.request(
    "http://localhost/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    env,
    testCtx,
  );
}

const chatBody = () =>
  upstream.callsTo(UPSTREAM.chat)[0]?.body as OneMinRequestBody | undefined;

describe("non-streaming", () => {
  it("translates a completion into OpenAI shape", async () => {
    upstream.reply(UPSTREAM.chat, () =>
      oneMinChatResponse("Hello there", {
        inputToken: 11,
        outputToken: 4,
        totalToken: 15,
      }),
    );

    const res = await post({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: "be nice" },
        { role: "user", content: "hi" },
      ],
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, never>;
    expect(body).toMatchObject({
      object: "chat.completion",
      model: CHAT_MODEL,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello there" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 },
    });

    expect(chatBody()).toMatchObject({
      type: "UNIFY_CHAT_WITH_AI",
      model: CHAT_MODEL,
      promptObject: { prompt: "System: be nice\n\nHuman: hi\n\n" },
    });
    const call = upstream.callsTo(UPSTREAM.chat)[0];
    expect((call?.init.headers as Record<string, string>)["API-KEY"]).toBe(
      "test-key",
    );
  });

  it("estimates usage locally when the upstream reports none", async () => {
    upstream.reply(UPSTREAM.chat, () => oneMinChatResponse("some answer"));

    const res = await post({
      model: CHAT_MODEL,
      messages: [{ role: "user", content: "count my tokens please" }],
    });

    const { usage } = (await res.json()) as {
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };
    expect(usage.prompt_tokens).toBeGreaterThan(0);
    expect(usage.completion_tokens).toBeGreaterThan(0);
    expect(usage.total_tokens).toBe(
      usage.prompt_tokens + usage.completion_tokens,
    );
  });

  it("maps a provider finish reason onto OpenAI's closed set", async () => {
    upstream.reply(UPSTREAM.chat, () =>
      oneMinChatResponse("cut off", {
        inputToken: 1,
        outputToken: 1,
        finishReason: "MAX_TOKENS",
      }),
    );

    const res = await post({
      model: CHAT_MODEL,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(
      ((await res.json()) as { choices: Array<{ finish_reason: string }> })
        .choices[0]?.finish_reason,
    ).toBe("length");
  });

  it("falls back to the default model when none is given", async () => {
    upstream.reply(UPSTREAM.chat, () => oneMinChatResponse("ok"));
    await post({ messages: [{ role: "user", content: "hi" }] });
    expect(chatBody()?.model).toBe(CHAT_MODEL);
  });

  it("flattens tool and assistant turns into the prompt", async () => {
    upstream.reply(UPSTREAM.chat, () => oneMinChatResponse("ok"));
    await post({
      model: CHAT_MODEL,
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "tool", content: "42" },
      ],
    });
    expect(chatBody()?.promptObject.prompt).toBe(
      "Human: hi\n\nAssistant: hello\n\nTool: 42\n\n",
    );
  });
});

describe("validation", () => {
  it("requires a messages array", async () => {
    const res = await post({ model: CHAT_MODEL });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: {
        message: "Messages field is required and must be an array",
        param: "messages",
      },
    });
  });

  it("404s an unknown model", async () => {
    const res = await post({
      model: "no-such-model",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: {
        message: "The model 'no-such-model' does not exist",
        code: "model_not_found",
      },
    });
  });

  it("points image models at the images endpoint", async () => {
    const res = await post({
      model: IMAGE_MODEL,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain(
      "/v1/images/generations",
    );
  });

  it("rejects a colon suffix other than :online", async () => {
    const res = await post({
      model: `${CHAT_MODEL}:turbo`,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain(
      "Only ':online' suffix is supported",
    );
  });
});

describe("web search", () => {
  it("enables webSearch for a :online model", async () => {
    upstream.reply(UPSTREAM.chat, () => oneMinChatResponse("ok"));
    await post({
      model: `${CHAT_MODEL}:online`,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(chatBody()?.promptObject.settings?.webSearchSettings).toEqual({
      webSearch: true,
      numOfSite: 1,
      maxWord: 500,
    });
  });

  it("honours the web search env overrides", async () => {
    upstream.reply(UPSTREAM.chat, () => oneMinChatResponse("ok"));
    await post(
      {
        model: `${CHAT_MODEL}:online`,
        messages: [{ role: "user", content: "hi" }],
      },
      testEnv({ WEB_SEARCH_NUM_OF_SITE: "3", WEB_SEARCH_MAX_WORD: "900" }),
    );
    expect(chatBody()?.promptObject.settings?.webSearchSettings).toMatchObject({
      numOfSite: 3,
      maxWord: 900,
    });
  });

  it("retries without web search after an upstream 400", async () => {
    let attempt = 0;
    upstream.reply(UPSTREAM.chat, () => {
      attempt += 1;
      return attempt === 1
        ? new Response("bad request", { status: 400 })
        : oneMinChatResponse("degraded answer");
    });

    const res = await post({
      model: `${CHAT_MODEL}:online`,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(res.status).toBe(200);
    const retry = upstream.callsTo(UPSTREAM.chat)[1]?.body as OneMinRequestBody;
    expect(retry.promptObject.settings?.webSearchSettings).toEqual({
      webSearch: false,
    });
  });

  it("surfaces the original error when degradation also fails", async () => {
    upstream.reply(
      UPSTREAM.chat,
      () =>
        new Response(
          JSON.stringify({ errorCode: "BAD_INPUT", message: "nope" }),
          { status: 400 },
        ),
    );

    const res = await post({
      model: `${CHAT_MODEL}:online`,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { message: "nope", code: "BAD_INPUT" },
    });
  });
});

describe("vision", () => {
  const imageMessage = (model: string) => ({
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          {
            type: "image_url",
            image_url: {
              url: "data:image/png;base64,aGVsbG8=",
            },
          },
        ],
      },
    ],
  });

  it("uploads the image and attaches its path", async () => {
    upstream.reply(UPSTREAM.asset, () =>
      Response.json({ fileContent: { path: "images/abc.png" } }),
    );
    upstream.reply(UPSTREAM.chat, () => oneMinChatResponse("a cat"));

    const res = await post(imageMessage(VISION_MODEL));
    expect(res.status).toBe(200);
    expect(chatBody()?.promptObject.attachments).toEqual({
      images: ["images/abc.png"],
    });
    expect(upstream.callsTo(UPSTREAM.asset)).toHaveLength(1);
  });

  it("rejects images for a non-vision model", async () => {
    const res = await post(imageMessage(CHAT_MODEL));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain(
      "does not support image inputs",
    );
  });

  it("reports a failed upload as a 422", async () => {
    upstream.reply(UPSTREAM.asset, () => new Response("nope", { status: 500 }));
    const res = await post(imageMessage(VISION_MODEL));
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain(
      "Failed to process image attachment",
    );
  });
});

describe("streaming", () => {
  it("re-emits upstream deltas as OpenAI SSE chunks", async () => {
    upstream.reply(UPSTREAM.chat, () =>
      sseResponse([
        contentBlock("Hel"),
        contentBlock("lo"),
        'event: done\ndata: {"message":"Stream completed"}',
      ]),
    );

    const res = await post({
      model: CHAT_MODEL,
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    const text = await res.text();
    const deltas = [...text.matchAll(/"content":"([^"]*)"/g)].map((m) => m[1]);
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(text).toContain('"finish_reason":"stop"');
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
    expect(upstream.callsTo(`${UPSTREAM.chat}?isStreaming=true`)).toHaveLength(
      1,
    );
  });

  it("writes an OpenAI-shaped error frame when the stream fails", async () => {
    upstream.reply(UPSTREAM.chat, () =>
      sseResponse([
        contentBlock("partial"),
        'event: error\ndata: {"error":"model exploded"}',
      ]),
    );

    const res = await post({
      model: CHAT_MODEL,
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    });

    const text = await res.text();
    expect(text).toContain('"message":"model exploded"');
    expect(text).toContain('"code":"upstream_stream_error"');
    expect(text).not.toContain("[DONE]");
  });

  it("passes through a non-SSE body that never sends a blank line", async () => {
    upstream.reply(UPSTREAM.chat, () => new Response("plain text answer"));

    const res = await post({
      model: CHAT_MODEL,
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(await res.text()).toContain('"content":"plain text answer"');
  });

  it("handles an upstream response with no body", async () => {
    upstream.reply(UPSTREAM.chat, () => new Response(null, { status: 204 }));

    const res = await post({
      model: CHAT_MODEL,
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });
});
