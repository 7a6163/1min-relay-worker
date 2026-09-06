/**
 * services/model-registry — the two-tier cache and its fallbacks.
 *
 * The cache is module-level, so every test re-imports the module fresh.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CachedModelData, Env } from "../src/types";
import {
  CHAT_MODEL,
  type FetchMock,
  fakeKV,
  IMAGE_MODEL,
  installFetchMock,
  modelEntry,
  SPEECH_MODEL,
  testEnv,
  UPSTREAM,
  VISION_MODEL,
} from "./helpers";

let upstream: FetchMock;

beforeEach(() => {
  vi.resetModules();
  upstream = installFetchMock();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const registry = () => import("../src/services/model-registry");

describe("getModelData", () => {
  it("fetches every feature and derives the id lists", async () => {
    const { getModelData } = await registry();
    const data = await getModelData(testEnv());

    expect(data.chatModelIds).toEqual([CHAT_MODEL, VISION_MODEL]);
    expect(data.imageModelIds).toEqual([IMAGE_MODEL]);
    expect(data.visionModelIds).toEqual([VISION_MODEL]);
    expect(data.codeInterpreterModelIds).toEqual([VISION_MODEL]);
    expect(data.speechModelIds).toEqual([SPEECH_MODEL]);
    expect(data.entries).toHaveLength(4);
    expect(upstream.callsTo(UPSTREAM.models)).toHaveLength(3);
  });

  it("serves the second call from the in-memory cache", async () => {
    const { getModelData } = await registry();
    await getModelData(testEnv());
    await getModelData(testEnv());
    expect(upstream.callsTo(UPSTREAM.models)).toHaveLength(3);
  });

  it("shares one inflight fetch between concurrent callers", async () => {
    const { getModelData } = await registry();
    const env = testEnv();
    await Promise.all([
      getModelData(env),
      getModelData(env),
      getModelData(env),
    ]);
    expect(upstream.callsTo(UPSTREAM.models)).toHaveLength(3);
  });

  it("writes to KV and reads it back on a cold isolate", async () => {
    const kv = fakeKV();
    const first = await registry();
    await first.getModelData(testEnv({ MODEL_CACHE: kv }));
    expect(kv.store.has("model-data-v2")).toBe(true);

    vi.resetModules();
    upstream = installFetchMock();
    const second = await registry();
    const data = await second.getModelData(testEnv({ MODEL_CACHE: kv }));
    expect(data.chatModelIds).toEqual([CHAT_MODEL, VISION_MODEL]);
    expect(upstream.callsTo(UPSTREAM.models)).toHaveLength(0);
  });

  it("ignores a KV entry of the wrong shape", async () => {
    const kv = fakeKV({ "model-data-v2": JSON.stringify({ entries: [] }) });
    const { getModelData } = await registry();
    await getModelData(testEnv({ MODEL_CACHE: kv }));
    expect(upstream.callsTo(UPSTREAM.models)).toHaveLength(3);
  });

  it("falls through to the API when the KV read throws", async () => {
    const kv = fakeKV();
    vi.mocked(kv.get).mockRejectedValue(new Error("KV down"));
    const { getModelData } = await registry();
    await getModelData(testEnv({ MODEL_CACHE: kv }));
    expect(upstream.callsTo(UPSTREAM.models)).toHaveLength(3);
  });

  it("survives a failing KV write", async () => {
    const kv = fakeKV();
    vi.mocked(kv.put).mockRejectedValue(new Error("KV full"));
    const { getModelData } = await registry();
    await expect(
      getModelData(testEnv({ MODEL_CACHE: kv })),
    ).resolves.toBeTruthy();
  });

  it("uses the hardcoded speech list when that feature call fails", async () => {
    upstream.on((url) =>
      url.includes("SPEECH_TO_TEXT")
        ? new Response("nope", { status: 500 })
        : undefined,
    );
    const { getModelData } = await registry();
    const data = await getModelData(testEnv());
    expect(data.speechModelIds).toContain("whisper-1");
    expect(data.speechModelIds).toContain("medical_dictation");
  });

  it("throws a 503 when the API fails and nothing is cached", async () => {
    upstream.on(() => new Response("down", { status: 502 }));
    const { getModelData } = await registry();
    await expect(getModelData(testEnv())).rejects.toMatchObject({
      status: 503,
      name: "ApiError",
    });
  });

  it("rejects a models payload that is not a list", async () => {
    upstream.on(() => Response.json({ nope: true }));
    const { getModelData } = await registry();
    await expect(getModelData(testEnv())).rejects.toMatchObject({
      status: 503,
    });
  });

  it("serves a stale in-memory cache when a refetch fails", async () => {
    const mod = await registry();
    const env = testEnv();
    const fresh = await mod.getModelData(env);

    // Expire the memory cache, then break the upstream.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10 * 60 * 1000);
    upstream.on(() => new Response("down", { status: 500 }));
    const stale = await mod.getModelData(env);
    vi.useRealTimers();

    expect(stale.chatModelIds).toEqual(fresh.chatModelIds);
  });
});

describe("capability probes", () => {
  it("answers from the cached lists", async () => {
    const { isVisionModel, isImageGenerationModel, isSpeechModel } =
      await registry();
    const env = testEnv();
    expect(await isVisionModel(VISION_MODEL, env)).toBe(true);
    expect(await isVisionModel(CHAT_MODEL, env)).toBe(false);
    expect(await isImageGenerationModel(IMAGE_MODEL, env)).toBe(true);
    expect(await isSpeechModel(SPEECH_MODEL, env)).toBe(true);
    expect(await isSpeechModel(CHAT_MODEL, env)).toBe(false);
  });

  it("falls back to the hardcoded speech list when the cache has none", async () => {
    const kv = fakeKV({
      "model-data-v2": JSON.stringify({
        chatModelIds: [CHAT_MODEL],
        imageModelIds: [],
        visionModelIds: [],
        codeInterpreterModelIds: [],
        entries: [modelEntry({ modelId: CHAT_MODEL })],
        fetchedAt: Date.now(),
      } satisfies CachedModelData),
    });
    const { isSpeechModel } = await registry();
    expect(await isSpeechModel("whisper-1", testEnv({ MODEL_CACHE: kv }))).toBe(
      true,
    );
  });

  it("only treats whisper-1 as translatable", async () => {
    const { isAudioTranslationModel } = await registry();
    expect(isAudioTranslationModel("whisper-1")).toBe(true);
    expect(isAudioTranslationModel("latest_long")).toBe(false);
  });
});

describe("processModels", () => {
  it("keeps the unfiltered list when every model is disabled", async () => {
    const disabled = [
      modelEntry({ modelId: "a", status: "DISABLED" }),
      modelEntry({ modelId: "b", status: "DISABLED" }),
    ];
    upstream.on((url) =>
      url.includes("UNIFY_CHAT_WITH_AI")
        ? Response.json({ models: disabled })
        : undefined,
    );
    const { getModelData } = await registry();
    const data = await getModelData(testEnv());
    expect(data.chatModelIds).toEqual(["a", "b"]);
  });

  it("deduplicates an id that appears under two features", async () => {
    const shared = modelEntry({ modelId: "dual" });
    upstream.on((url) =>
      url.includes("UNIFY_CHAT_WITH_AI") || url.includes("IMAGE_GENERATOR")
        ? Response.json({ models: [shared] })
        : undefined,
    );
    const { getModelData } = await registry();
    const data = await getModelData(testEnv());
    expect(data.entries.filter((e) => e.modelId === "dual")).toHaveLength(1);
    expect(data.chatModelIds).toEqual(["dual"]);
    expect(data.imageModelIds).toEqual(["dual"]);
  });
});

describe("the models API call itself", () => {
  it("aborts a request that hangs past the timeout", async () => {
    vi.useFakeTimers();
    upstream.on(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          (init.signal as AbortSignal).addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const { getModelData } = await registry();
    const pending = getModelData(testEnv() as Env);
    const assertion = expect(pending).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(6000);
    await assertion;
    vi.useRealTimers();
  });
});
