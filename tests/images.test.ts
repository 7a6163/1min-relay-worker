import { describe, expect, it } from "vitest";
import { ONE_MIN_ASSET_CDN_URL } from "../src/constants/config";
import { toAssetUrl } from "../src/handlers/images";

describe("toAssetUrl", () => {
  it("turns an upstream result path into a fetchable URL", () => {
    // resultObject entries look like this — they are paths, not URLs.
    expect(
      toAssetUrl("images/2026_09_03_08_53_47_947_456329.png", "https://cdn.test"),
    ).toBe("https://cdn.test/images/2026_09_03_08_53_47_947_456329.png");
  });

  it("leaves an absolute URL untouched", () => {
    const signed = "https://s3.amazonaws.com/bucket/a.png?X-Amz-Signature=abc";
    expect(toAssetUrl(signed, "https://cdn.test")).toBe(signed);
    expect(toAssetUrl("HTTP://example.com/a.png", "https://cdn.test")).toBe(
      "HTTP://example.com/a.png",
    );
  });

  it("does not double up slashes", () => {
    expect(toAssetUrl("/images/a.png", "https://cdn.test/")).toBe(
      "https://cdn.test/images/a.png",
    );
  });

  it("handles every path of a multi-image result", () => {
    // The signed temporaryUrl only ever covers the first result, so n > 1
    // depends on building URLs for the rest.
    const paths = ["images/first.png", "images/second.png"];
    expect(paths.map((p) => toAssetUrl(p, ONE_MIN_ASSET_CDN_URL))).toEqual([
      "https://asset.1min.ai/images/first.png",
      "https://asset.1min.ai/images/second.png",
    ]);
  });
});
