/**
 * POST /v1/responses — OpenAI Responses API translation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import app from "../src/index";
import type { OneMinRequestBody } from "../src/types";
import {
  CHAT_MODEL,
  contentBlock,
  type FetchMock,
  installFetchMock,
  oneMinChatResponse,
  requestTo,
  sseResponse,
  testCtx,
  testEnv,
  UPSTREAM,
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

function post(body: unknown) {
  return app.request(
    "http://localhost/v1/responses",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    testEnv(),
    testCtx,
  );
}

const prompt = () =>
  (requestTo(upstream, UPSTREAM.chat).body as OneMinRequestBody).promptObject
    .prompt as string;

describe("input conversion", () => {
  it("accepts a bare input string", async () => {
    upstream.reply(UPSTREAM.chat, () =>
      oneMinChatResponse("answer", { inputToken: 3, outputToken: 2 }),
    );

    const res = await post({ model: CHAT_MODEL, input: "why is the sky blue" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      object: "response",
      status: "completed",
      model: CHAT_MODEL,
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "answer" }],
        },
      ],
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    });
    expect(prompt()).toBe("Human: why is the sky blue\n\n");
  });

  it("prepends instructions as a system turn", async () => {
    upstream.reply(UPSTREAM.chat, () => oneMinChatResponse("ok"));
    await post({
      model: CHAT_MODEL,
      instructions: "be terse",
      input: [
        { role: "user", content: [{ type: "input_text", text: "hello" }] },
      ],
    });
    expect(prompt()).toBe("System: be terse\n\nHuman: hello\n\n");
  });

  it("accepts a messages array with instructions", async () => {
    upstream.reply(UPSTREAM.chat, () => oneMinChatResponse("ok"));
    await post({
      model: CHAT_MODEL,
      instructions: "be terse",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(prompt()).toBe("System: be terse\n\nHuman: hello\n\n");
  });

  it("skips non-message input items", async () => {
    upstream.reply(UPSTREAM.chat, () => oneMinChatResponse("ok"));
    await post({
      model: CHAT_MODEL,
      input: [
        { type: "function_call", role: "assistant", content: "ignored" },
        { type: "message", role: "user", content: "kept" },
      ],
    });
    expect(prompt()).toBe("Human: kept\n\n");
  });

  it("requires input or messages", async () => {
    const res = await post({ model: CHAT_MODEL });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { param: "input", type: "invalid_request_error" },
    });
  });

  it("rejects non-text content parts", async () => {
    const res = await post({
      model: CHAT_MODEL,
      input: [
        {
          role: "user",
          content: [{ type: "input_image", image_url: "https://x/y.png" }],
        },
      ],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "unsupported_content_type" },
    });
  });

  it("rejects an input with no usable text", async () => {
    const res = await post({
      model: CHAT_MODEL,
      input: [{ role: "user", content: "   " }],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "empty_input" } });
  });
});

describe("structured output", () => {
  it("asks for JSON and re-serialises the parsed answer", async () => {
    upstream.reply(UPSTREAM.chat, () => oneMinChatResponse('{ "a" :  1 }'));

    const res = await post({
      model: CHAT_MODEL,
      input: "give me json",
      response_format: { type: "json_object" },
    });

    expect(prompt()).toContain("respond with a valid JSON object only");
    const body = (await res.json()) as {
      output: Array<{ content: Array<{ text: string }> }>;
    };
    expect(body.output[0]?.content[0]?.text).toBe('{"a":1}');
  });

  it("keeps unparseable JSON as-is", async () => {
    upstream.reply(UPSTREAM.chat, () => oneMinChatResponse("not json"));
    const res = await post({
      model: CHAT_MODEL,
      input: "give me json",
      response_format: { type: "json_object" },
    });
    const body = (await res.json()) as {
      output: Array<{ content: Array<{ text: string }> }>;
    };
    expect(body.output[0]?.content[0]?.text).toBe("not json");
  });

  it("inlines a json_schema and the reasoning effort", async () => {
    upstream.reply(UPSTREAM.chat, () => oneMinChatResponse("{}"));
    await post({
      model: CHAT_MODEL,
      input: "go",
      reasoning_effort: "high",
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "Answer",
          description: "the answer",
          schema: { type: "object" },
        },
      },
    });
    expect(prompt()).toContain('"type":"object"');
    expect(prompt()).toContain('named "Answer"');
    expect(prompt()).toContain("Carefully analyze all aspects");
  });

  it("applies reasoning_effort with no response_format", async () => {
    upstream.reply(UPSTREAM.chat, () => oneMinChatResponse("ok"));
    await post({
      model: CHAT_MODEL,
      input: "go",
      reasoning_effort: "low",
    });
    expect(prompt()).toBe(
      "System: Provide a direct and concise response.\n\nHuman: go\n\n",
    );
  });

  it("ignores a reasoning_effort outside the enum", async () => {
    upstream.reply(UPSTREAM.chat, () => oneMinChatResponse("ok"));
    await post({
      model: CHAT_MODEL,
      input: "go",
      reasoning_effort: "extreme",
    });
    expect(prompt()).toBe("Human: go\n\n");
    expect(prompt()).not.toContain("undefined");
  });

  it("leaves the prompt alone when neither field is set", async () => {
    upstream.reply(UPSTREAM.chat, () => oneMinChatResponse("ok"));
    await post({ model: CHAT_MODEL, input: "go" });
    expect(prompt()).toBe("Human: go\n\n");
  });

  it("appends the structure prompt to an existing system turn", async () => {
    upstream.reply(UPSTREAM.chat, () => oneMinChatResponse("{}"));
    await post({
      model: CHAT_MODEL,
      instructions: "be terse",
      input: "go",
      response_format: { type: "text" },
    });
    expect(prompt()).toContain(
      "System: be terse\n\nPlease provide a clear and structured text response.",
    );
  });
});

describe("streaming", () => {
  it("emits the full Responses event sequence", async () => {
    upstream.reply(UPSTREAM.chat, () =>
      sseResponse([contentBlock("Hi"), contentBlock(" there")]),
    );

    const res = await post({
      model: CHAT_MODEL,
      input: "hello",
      stream: true,
    });

    const text = await res.text();
    const events = [...text.matchAll(/^event: (.+)$/gm)].map((m) => m[1]);
    expect(events).toEqual([
      "response.created",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
      "response.output_text.delta",
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.completed",
    ]);
    expect(text).toContain('"text":"Hi there"');
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });
});
