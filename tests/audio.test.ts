/**
 * POST /v1/audio/transcriptions and /v1/audio/translations, plus the
 * form-data parsing and file validation behind them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import type { OneMinRequestBody } from "../src/types";
import {
  audioMimeToExtension,
  parseAudioFormData,
  validateAudioFile,
} from "../src/utils/audio";
import {
  CHAT_MODEL,
  type FetchMock,
  installFetchMock,
  oneMinChatResponse,
  SPEECH_MODEL,
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

function mp3File(name = "clip.mp3"): File {
  // "ID3" header so the magic-byte path recognises it too.
  const bytes = new Uint8Array([
    0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  return new File([bytes], name, { type: "audio/mpeg" });
}

function form(fields: Record<string, string | File>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
  return fd;
}

function post(path: string, body: FormData) {
  return app.request(
    `http://localhost/v1/audio/${path}`,
    { method: "POST", headers: { Authorization: "Bearer test-key" }, body },
    testEnv(),
    testCtx,
  );
}

function mockUpload(path = "audio/clip.mp3") {
  upstream.reply(UPSTREAM.asset, () =>
    Response.json({ fileContent: { path } }),
  );
}

const sentBody = () =>
  upstream.callsTo(UPSTREAM.features)[0]?.body as OneMinRequestBody;

describe("transcription", () => {
  it("uploads the file and returns JSON text", async () => {
    mockUpload();
    upstream.reply(UPSTREAM.features, () => oneMinChatResponse("hello world"));

    const res = await post(
      "transcriptions",
      form({ file: mp3File(), model: SPEECH_MODEL }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "hello world" });
    expect(sentBody()).toMatchObject({
      type: "SPEECH_TO_TEXT",
      model: SPEECH_MODEL,
      promptObject: { audioUrl: "audio/clip.mp3", response_format: "json" },
    });
  });

  it("passes whisper language, prompt and temperature through", async () => {
    mockUpload();
    upstream.reply(UPSTREAM.features, () => oneMinChatResponse("bonjour"));

    await post(
      "transcriptions",
      form({
        file: mp3File(),
        model: SPEECH_MODEL,
        language: "fr",
        prompt: "a greeting",
        temperature: "0.4",
        response_format: "json",
      }),
    );

    expect(sentBody().promptObject).toMatchObject({
      language: "fr",
      prompt: "a greeting",
      temperature: 0.4,
      response_format: "json",
    });
  });

  it("returns plain text for text and srt formats", async () => {
    mockUpload();
    upstream.reply(UPSTREAM.features, () => oneMinChatResponse("subtitles"));

    const res = await post(
      "transcriptions",
      form({ file: mp3File(), model: SPEECH_MODEL, response_format: "srt" }),
    );
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("subtitles");
  });

  it("returns text/vtt for vtt", async () => {
    mockUpload();
    upstream.reply(UPSTREAM.features, () => oneMinChatResponse("WEBVTT"));

    const res = await post(
      "transcriptions",
      form({ file: mp3File(), model: SPEECH_MODEL, response_format: "vtt" }),
    );
    expect(res.headers.get("Content-Type")).toBe("text/vtt; charset=utf-8");
  });

  it("returns a best-effort verbose_json", async () => {
    mockUpload();
    upstream.reply(UPSTREAM.features, () => oneMinChatResponse("hi"));

    const res = await post(
      "transcriptions",
      form({
        file: mp3File(),
        model: SPEECH_MODEL,
        response_format: "verbose_json",
      }),
    );
    expect(await res.json()).toEqual({
      task: "transcribe",
      language: "",
      duration: 0,
      text: "hi",
      segments: [],
    });
  });

  it("rejects a model that does not do speech-to-text", async () => {
    const res = await post(
      "transcriptions",
      form({ file: mp3File(), model: CHAT_MODEL }),
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain(
      "does not support speech-to-text",
    );
  });

  it("reports a failed asset upload", async () => {
    upstream.reply(
      UPSTREAM.asset,
      () => new Response("too big", { status: 413 }),
    );
    const res = await post(
      "transcriptions",
      form({ file: mp3File(), model: SPEECH_MODEL }),
    );
    expect(res.status).toBe(413);
    expect(JSON.stringify(await res.json())).toContain(
      "Failed to upload audio file",
    );
  });

  it("errors when the asset API returns no path", async () => {
    upstream.reply(UPSTREAM.asset, () => Response.json({}));
    const res = await post(
      "transcriptions",
      form({ file: mp3File(), model: SPEECH_MODEL }),
    );
    expect(res.status).toBe(500);
  });
});

describe("translation", () => {
  it("uses the AUDIO_TRANSLATOR feature", async () => {
    mockUpload();
    upstream.reply(UPSTREAM.features, () => oneMinChatResponse("hello"));

    const res = await post(
      "translations",
      form({ file: mp3File(), model: "whisper-1", temperature: "0.2" }),
    );

    expect(res.status).toBe(200);
    expect(sentBody()).toMatchObject({
      type: "AUDIO_TRANSLATOR",
      promptObject: { response_format: "json", temperature: 0.2 },
    });
  });

  it("only allows whisper-1", async () => {
    const res = await post(
      "translations",
      form({ file: mp3File(), model: "latest_long" }),
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain(
      "does not support audio translation",
    );
  });
});

describe("form data validation", () => {
  const request = (body: BodyInit, headers: HeadersInit = {}) =>
    new Request("http://localhost/v1/audio/transcriptions", {
      method: "POST",
      body,
      headers,
    });

  it("requires multipart/form-data", async () => {
    await expect(
      parseAudioFormData(
        request("not a form", { "Content-Type": "application/json" }),
      ),
    ).rejects.toThrow("multipart/form-data");
  });

  it("requires a file", async () => {
    await expect(
      parseAudioFormData(request(form({ model: SPEECH_MODEL }))),
    ).rejects.toThrow("file is required");
  });

  it("requires a model", async () => {
    await expect(
      parseAudioFormData(request(form({ file: mp3File() }))),
    ).rejects.toThrow("model is required");
  });

  it("rejects an unknown response_format", async () => {
    await expect(
      parseAudioFormData(
        request(
          form({
            file: mp3File(),
            model: SPEECH_MODEL,
            response_format: "mp3",
          }),
        ),
      ),
    ).rejects.toThrow("Invalid response_format");
  });

  it.each([
    "nope",
    "-1",
    "2",
  ])("rejects temperature %s", async (temperature) => {
    await expect(
      parseAudioFormData(
        request(form({ file: mp3File(), model: SPEECH_MODEL, temperature })),
      ),
    ).rejects.toThrow("temperature must be a number");
  });

  it("treats an empty temperature as absent", async () => {
    const parsed = await parseAudioFormData(
      request(form({ file: mp3File(), model: SPEECH_MODEL, temperature: "" })),
    );
    expect(parsed.temperature).toBeUndefined();
    expect(parsed.responseFormat).toBe("json");
  });
});

describe("validateAudioFile", () => {
  it("accepts a known audio MIME type", async () => {
    await expect(validateAudioFile(mp3File())).resolves.toBeUndefined();
  });

  it("accepts an unknown MIME with a known extension", async () => {
    const file = new File(["x"], "clip.flac", {
      type: "application/octet-stream",
    });
    await expect(validateAudioFile(file)).resolves.toBeUndefined();
  });

  it("falls back to magic bytes when MIME and name say nothing", async () => {
    const bytes = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0]);
    const file = new File([bytes], "clip", {
      type: "application/octet-stream",
    });
    await expect(validateAudioFile(file)).resolves.toBeUndefined();
  });

  it("rejects an explicit non-audio MIME type", async () => {
    const file = new File(["x"], "doc.pdf", { type: "application/pdf" });
    await expect(validateAudioFile(file)).rejects.toThrow(
      "Unsupported audio format",
    );
  });

  it("rejects a file it cannot identify at all", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "mystery", {
      type: "",
    });
    await expect(validateAudioFile(file)).rejects.toThrow(
      "Could not determine audio format",
    );
  });

  it("rejects a file over 25MB", async () => {
    const file = mp3File();
    Object.defineProperty(file, "size", { value: 26 * 1024 * 1024 });
    await expect(validateAudioFile(file)).rejects.toThrow("exceeds maximum");
  });
});

describe("audioMimeToExtension", () => {
  it("maps known types", () => {
    expect(audioMimeToExtension("audio/wav")).toBe(".wav");
    expect(audioMimeToExtension("audio/x-m4a")).toBe(".m4a");
  });

  it("defaults to .mp3", () => {
    expect(audioMimeToExtension("audio/unknown")).toBe(".mp3");
  });
});
