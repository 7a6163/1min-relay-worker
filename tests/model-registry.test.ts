import { describe, expect, it } from "vitest";
import { isUsableModel, usableModels } from "../src/services/model-registry";
import type { OneMinModelEntry } from "../src/types/onemin-models";

function model(overrides: Partial<OneMinModelEntry>): OneMinModelEntry {
  return {
    modelId: "some-model",
    name: "Some Model",
    provider: "someone",
    status: "ACTIVE",
    features: ["IMAGE_GENERATOR"],
    modality: { INPUT: ["text"], OUTPUT: ["image"] },
    creditMetadata: {},
    ...overrides,
  };
}

describe("isUsableModel", () => {
  it("accepts an active model", () => {
    expect(isUsableModel(model({}))).toBe(true);
  });

  it("rejects a DISABLED model", () => {
    // The upstream lists these but answers 400 UNSUPPORTED_MODEL for them —
    // e.g. black-forest-labs/flux-schnell, the relay's previous image default.
    expect(
      isUsableModel(
        model({
          modelId: "black-forest-labs/flux-schnell",
          status: "DISABLED",
        }),
      ),
    ).toBe(false);
  });

  it("keeps a model that carries a deprecation date, past or future", () => {
    // Measured against the live API: dated entries are ACTIVE, answer normally,
    // and share batch dates a few weeks out — a renewal marker, not an end of
    // life. Filtering on the date would drop 14 working models, the gpt-5
    // family among them, on days the upstream still serves them.
    expect(
      isUsableModel(model({ deprecationDate: "2026-12-10T17:00:00.000Z" })),
    ).toBe(true);
    expect(
      isUsableModel(model({ deprecationDate: "2020-01-01T00:00:00.000Z" })),
    ).toBe(true);
  });
});

describe("usableModels", () => {
  it("drops the unusable entries", () => {
    const kept = usableModels([
      model({ modelId: "good" }),
      model({ modelId: "gone", status: "DISABLED" }),
    ]);
    expect(kept.map((m) => m.modelId)).toEqual(["good"]);
  });

  it("keeps the whole list when the filter would empty it", () => {
    // An empty result means the upstream renamed or recased `status`, not that
    // the account lost every model. Serving a stale list beats answering
    // model_not_found for every request until the cache expires.
    const all = [
      model({ modelId: "a", status: "active" }),
      model({ modelId: "b", status: "active" }),
    ];
    expect(usableModels(all).map((m) => m.modelId)).toEqual(["a", "b"]);
  });

  it("returns an empty list for an empty input", () => {
    expect(usableModels([])).toEqual([]);
  });
});
