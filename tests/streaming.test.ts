import { describe, expect, it } from "vitest";
import { parseSSEChunks } from "../src/utils/streaming";

// Wire format captured from a live 1min.ai streaming response.
const CONTENT_BLOCK = 'event: content\ndata: {"content":"Hello"}';
const ERROR_BLOCK =
  'event: error\ndata: {"error":"Model this-model-does-not-exist is not supported"}';
const DONE_BLOCK = 'event: done\ndata: {"message":"Stream completed"}';

describe("parseSSEChunks", () => {
  it("extracts delta text from content events", () => {
    expect(parseSSEChunks(CONTENT_BLOCK)).toEqual({
      chunks: ["Hello"],
      error: undefined,
    });
  });

  it("returns null when the text is not SSE at all", () => {
    expect(parseSSEChunks("just a plain response body")).toBeNull();
  });

  it("ignores result and done events", () => {
    const result = parseSSEChunks(
      'event: result\ndata: {"aiRecord":{"uuid":"x"}}',
    );
    expect(result).toEqual({ chunks: [], error: undefined });
    expect(parseSSEChunks(DONE_BLOCK)).toEqual({
      chunks: [],
      error: undefined,
    });
  });

  it("surfaces an upstream error event", () => {
    // The upstream answers a bad streaming request with HTTP 200 and this
    // event; without surfacing it the client sees an empty success.
    const result = parseSSEChunks(ERROR_BLOCK);
    expect(result?.error).toBe(
      "Model this-model-does-not-exist is not supported",
    );
    expect(result?.chunks).toEqual([]);
  });

  it("surfaces an error that arrives after content has streamed", () => {
    const result = parseSSEChunks(`${CONTENT_BLOCK}\n\n${ERROR_BLOCK}`);
    expect(result?.chunks).toEqual(["Hello"]);
    expect(result?.error).toBe(
      "Model this-model-does-not-exist is not supported",
    );
  });

  it("keeps the first error when several arrive in one block", () => {
    const result = parseSSEChunks(
      'event: error\ndata: {"error":"first"}\n\nevent: error\ndata: {"error":"second"}',
    );
    expect(result?.error).toBe("first");
  });

  it("accepts a nested error object shape", () => {
    const result = parseSSEChunks(
      'event: error\ndata: {"error":{"message":"nested message"}}',
    );
    expect(result?.error).toBe("nested message");
  });

  it("accepts a top-level message field", () => {
    const result = parseSSEChunks(
      'event: error\ndata: {"message":"plain message"}',
    );
    expect(result?.error).toBe("plain message");
  });

  it("falls back to the raw payload for a non-JSON error event", () => {
    const result = parseSSEChunks("event: error\ndata: something broke");
    expect(result?.error).toBe("something broke");
  });

  it("never reports an error for a healthy stream", () => {
    const stream = [
      'event: content\ndata: {"content":""}',
      'event: content\ndata: {"content":"P"}',
      'event: content\ndata: {"content":"ong"}',
      'event: result\ndata: {"aiRecord":{"status":"SUCCESS"}}',
      DONE_BLOCK,
    ].join("\n\n");

    const result = parseSSEChunks(stream);
    expect(result?.error).toBeUndefined();
    // The empty first delta is dropped by the truthiness check
    expect(result?.chunks).toEqual(["P", "ong"]);
  });

  it("keeps the event type across multiple data lines in one block", () => {
    const result = parseSSEChunks(
      'event: content\ndata: {"content":"a"}\ndata: {"content":"b"}',
    );
    expect(result?.chunks).toEqual(["a", "b"]);
  });
});
