import { describe, expect, it } from "vitest";
import {
  collectDetailMessages,
  describeUpstreamError,
} from "../src/utils/upstream-error";

// Bodies captured from live 1min.ai error responses.
const UNSUPPORTED_MODEL = JSON.stringify({
  errorCode: "UNSUPPORTED_MODEL",
  message: "Model this-model-does-not-exist is not supported",
});

const MISSING_FIELDS = JSON.stringify({
  errorCode: "MISSING_REQUIRED_FIELDS",
  message:
    "Missing required fields for gpt-image-1-mini model: quality. Please provide all required parameters.",
  details:
    '[{"field":"quality","message":"Field \'quality\' is required for gpt-image-1-mini model with type IMAGE_GENERATOR"}]',
});

const MISLEADING_PROVIDER_ERROR = JSON.stringify({
  errorCode: "EXTERNAL_API_RESPONSE_WITH_ERROR",
  message:
    "The alibaba service is a bit busy right now or facing a temporary issue. Please try again shortly. We appreciate your patience!",
  context: { service: "alibaba" },
  details:
    '{"response":{"status":400,"data":{"request_id":"0645484e","code":"InvalidParameter","message":"The size does not match the allowed size 1664*928,1472*1104."}},"request":{"method":"post","url":"/api/v1/services/aigc/multimodal-generation/generation"}}',
});

describe("describeUpstreamError", () => {
  it("keeps the upstream message and error code for a 400", () => {
    const result = describeUpstreamError(400, UNSUPPORTED_MODEL);
    expect(result.code).toBe("UNSUPPORTED_MODEL");
    expect(result.message).toBe(
      "Model this-model-does-not-exist is not supported",
    );
  });

  it("appends the field-level detail that names what is missing", () => {
    const result = describeUpstreamError(400, MISSING_FIELDS);
    expect(result.code).toBe("MISSING_REQUIRED_FIELDS");
    expect(result.message).toContain("quality");
    expect(result.message).toContain("is required for gpt-image-1-mini");
  });

  it("surfaces the real cause behind a misleading canned message", () => {
    // The upstream says "service is busy… try again shortly", but retrying
    // never helps: it is a parameter error, and only `details` says so.
    const result = describeUpstreamError(400, MISLEADING_PROVIDER_ERROR);
    expect(result.message).toContain("The size does not match");
  });

  it("does not echo upstream internal request paths", () => {
    const result = describeUpstreamError(400, MISLEADING_PROVIDER_ERROR);
    expect(result.message).not.toContain("/api/v1/services/aigc");
    expect(result.message).not.toContain("request_id");
  });

  it("stays generic for credential failures", () => {
    expect(describeUpstreamError(401, UNSUPPORTED_MODEL).message).toBe(
      "Authentication failed with upstream provider",
    );
    expect(describeUpstreamError(403, UNSUPPORTED_MODEL).message).toBe(
      "Access denied by upstream provider",
    );
  });

  it("stays generic for upstream server errors", () => {
    const body = JSON.stringify({ message: "internal stack trace here" });
    expect(describeUpstreamError(500, body).message).toBe(
      "Upstream provider returned an internal error",
    );
    expect(describeUpstreamError(503, body).message).not.toContain("stack");
  });

  it("falls back to a generic message for an unreadable body", () => {
    expect(describeUpstreamError(400, "<html>gateway</html>").message).toBe(
      "Upstream request failed",
    );
    expect(describeUpstreamError(429, "").message).toBe(
      "Rate limited by upstream provider",
    );
  });

  it("truncates a very long message", () => {
    const body = JSON.stringify({ message: "x".repeat(2000) });
    const result = describeUpstreamError(400, body);
    expect(result.message.length).toBeLessThanOrEqual(500);
    expect(result.message.endsWith("…")).toBe(true);
  });
});

describe("collectDetailMessages", () => {
  it("reads an array of field errors", () => {
    expect(
      collectDetailMessages('[{"field":"quality","message":"needs quality"}]'),
    ).toEqual(["needs quality"]);
  });

  it("reads a nested provider payload", () => {
    expect(
      collectDetailMessages('{"response":{"data":{"message":"deep reason"}}}'),
    ).toEqual(["deep reason"]);
  });

  it("de-duplicates repeated messages", () => {
    expect(
      collectDetailMessages('[{"message":"same"},{"message":"same"}]'),
    ).toEqual(["same"]);
  });

  it("returns nothing for junk", () => {
    expect(collectDetailMessages(undefined)).toEqual([]);
    expect(collectDetailMessages("not json")).toEqual([]);
    expect(collectDetailMessages(42)).toEqual([]);
  });
});
