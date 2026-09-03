import { describe, expect, it } from "vitest";
import { isUsableModel } from "../src/services/model-registry";
import type { OneMinModelEntry } from "../src/types/onemin-models";

const NOW = Date.parse("2026-09-03T00:00:00.000Z");

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
  it("accepts an active model with no deprecation date", () => {
    expect(isUsableModel(model({}), NOW)).toBe(true);
  });

  it("rejects a DISABLED model", () => {
    // The upstream lists these but answers 400 UNSUPPORTED_MODEL for them —
    // e.g. black-forest-labs/flux-schnell, the relay's previous image default.
    expect(
      isUsableModel(
        model({ modelId: "black-forest-labs/flux-schnell", status: "DISABLED" }),
        NOW,
      ),
    ).toBe(false);
  });

  it("accepts a model whose deprecation date is still in the future", () => {
    expect(
      isUsableModel(model({ deprecationDate: "2026-12-10T17:00:00.000Z" }), NOW),
    ).toBe(true);
  });

  it("rejects a model whose deprecation date has passed", () => {
    expect(
      isUsableModel(model({ deprecationDate: "2026-01-01T00:00:00.000Z" }), NOW),
    ).toBe(false);
  });

  it("ignores a null or unparseable deprecation date", () => {
    expect(isUsableModel(model({ deprecationDate: null }), NOW)).toBe(true);
    expect(isUsableModel(model({ deprecationDate: "not a date" }), NOW)).toBe(
      true,
    );
  });
});
