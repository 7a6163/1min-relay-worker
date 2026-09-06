/**
 * POST /v1/images/generations.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import type { OneMinRequestBody } from "../src/types";
import {
  CHAT_MODEL,
  type FetchMock,
  IMAGE_MODEL,
  installFetchMock,
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

function post(body: unknown, env = testEnv()) {
  return app.request(
    "http://localhost/v1/images/generations",
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

function imageResult(paths: string[]) {
  return Response.json({
    aiRecord: { aiRecordDetail: { resultObject: paths } },
  });
}

const sentBody = () =>
  upstream.callsTo(UPSTREAM.features)[0]?.body as OneMinRequestBody;

describe("generation", () => {
  it("turns result paths into CDN URLs", async () => {
    upstream.reply(UPSTREAM.features, () =>
      imageResult(["images/a.png", "images/b.png"]),
    );

    const res = await post({ model: IMAGE_MODEL, prompt: "a cat", n: 2 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: [
        { url: "https://asset.1min.ai/images/a.png" },
        { url: "https://asset.1min.ai/images/b.png" },
      ],
    });
  });

  it("uses the configured CDN base when present", async () => {
    upstream.reply(UPSTREAM.features, () => imageResult(["images/a.png"]));
    const res = await post(
      { model: IMAGE_MODEL, prompt: "a cat" },
      testEnv({ ONE_MIN_ASSET_CDN_URL: "https://cdn.test/" }),
    );
    expect(await res.json()).toMatchObject({
      data: [{ url: "https://cdn.test/images/a.png" }],
    });
  });

  it("defaults n, size and the quality some models require", async () => {
    upstream.reply(UPSTREAM.features, () => imageResult(["images/a.png"]));
    await post({ model: IMAGE_MODEL, prompt: "a cat" });
    expect(sentBody()).toMatchObject({
      type: "IMAGE_GENERATOR",
      model: IMAGE_MODEL,
      promptObject: {
        prompt: "a cat",
        n: 1,
        size: "1024x1024",
        quality: "low",
      },
    });
  });

  it("forwards an explicit quality and size", async () => {
    upstream.reply(UPSTREAM.features, () => imageResult(["images/a.png"]));
    await post({
      model: IMAGE_MODEL,
      prompt: "a cat",
      size: "512x512",
      quality: "high",
    });
    expect(sentBody().promptObject).toMatchObject({
      size: "512x512",
      quality: "high",
    });
  });

  it("errors when the upstream returns no results", async () => {
    upstream.reply(UPSTREAM.features, () => imageResult([]));
    const res = await post({ model: IMAGE_MODEL, prompt: "a cat" });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).toContain(
      "No image results found",
    );
  });

  it("sanitises an upstream 500", async () => {
    upstream.reply(
      UPSTREAM.features,
      () => new Response("stack trace with internals", { status: 500 }),
    );
    const res = await post({ model: IMAGE_MODEL, prompt: "a cat" });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: { message: "Upstream provider returned an internal error" },
    });
  });
});

describe("validation", () => {
  it("requires a prompt", async () => {
    const res = await post({ model: IMAGE_MODEL });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { message: "Prompt field is required", param: "prompt" },
    });
  });

  it("rejects b64_json with an explanation", async () => {
    const res = await post({
      model: IMAGE_MODEL,
      prompt: "a cat",
      response_format: "b64_json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "unsupported_response_format" },
    });
  });

  it("rejects an unknown response_format", async () => {
    const res = await post({
      model: IMAGE_MODEL,
      prompt: "a cat",
      response_format: "webp",
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain(
      "Unsupported response_format",
    );
  });

  it("rejects a chat model", async () => {
    const res = await post({ model: CHAT_MODEL, prompt: "a cat" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "model_not_supported" },
    });
  });
});
